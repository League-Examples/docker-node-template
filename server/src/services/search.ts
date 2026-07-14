/**
 * Vector + keyword search over the Catalog & Knowledge Store
 * (architecture-001 §Vector Index; ticket 002-005).
 *
 * This module is the *only* place in the codebase that knows both index
 * implementations exist:
 *
 *  - `nearestNeighbors` uses the `sqlite-vec` loadable extension (a `vec0`
 *    virtual table, cosine distance) when it's available on this platform.
 *  - If the extension fails to load (confirmed on this repo's actual Docker
 *    base image, `node:20-alpine` -- see the Testing Notes in ticket
 *    002-005: sqlite-vec's prebuilt `linux-x64` binary is built against
 *    glibc and fails to `dlopen` under musl libc), it falls back to an
 *    in-memory brute-force cosine-similarity scan over the `Embedding`
 *    table. Same interface, same return shape -- callers never know which
 *    path answered the query (architecture-001 D1).
 *  - `keywordSearch` always uses `FTS5` (compiled into SQLite core, no
 *    extension needed) over the `SearchIndex` virtual table created by this
 *    sprint's migration.
 *
 * This module does not populate the index with real embeddings/descriptions
 * from actual assets -- that's Sprint 004's Description & Embedding
 * Pipeline. It proves the indexing mechanics: `indexKnowledgeEntry` /
 * `indexAssetDescription` write into the keyword index, and
 * `nearestNeighbors` reads from the `Embedding` table (syncing the vec0
 * mirror table first when that path is active) so vector search works as
 * soon as callers write `Embedding` rows through the normal Prisma client,
 * with no separate "index write" step required for the vector path.
 */
import Database from 'better-sqlite3';

export type OwnerType = 'asset' | 'knowledge_entry';

export interface NearestNeighborResult {
  ownerType: string;
  ownerId: number;
  /** Cosine similarity in [-1, 1] -- higher means closer, on both paths. */
  score: number;
}

export interface KeywordSearchResult {
  ownerType: string;
  ownerId: number;
}

const VEC_TABLE = 'VecEmbeddings';
const BYTES_PER_FLOAT32 = 4;

let _db: Database.Database | undefined;
let _vecAvailable: boolean | undefined;
let _vecDimension: number | undefined;

/**
 * Lazily opens a dedicated better-sqlite3 connection to the same SQLite file
 * Prisma writes to (via `DATABASE_URL`). A separate connection is used
 * (rather than reaching into the Prisma client) because `vec0`/`FTS5`
 * virtual tables and `loadExtension` are outside what Prisma's query API
 * models -- this mirrors the pattern `tests/server/global-setup.ts` already
 * uses for the same reason.
 */
function getDb(): Database.Database {
  if (!_db) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('search.ts: DATABASE_URL is not set');
    const dbPath = databaseUrl.replace(/^file:/, '');
    _db = new Database(dbPath);
    _db.pragma('busy_timeout = 5000');
  }
  return _db;
}

/**
 * Runtime capability check: attempts to load the `sqlite-vec` extension on
 * this connection, caching the result for the lifetime of the process.
 *
 * `FORCE_VECTOR_FALLBACK=1` (test-only, see ticket 002-005 Testing Plan)
 * forces this to report unavailable without even attempting the load, so
 * the brute-force path can be exercised deterministically regardless of
 * whether the real extension loads in the current environment.
 */
export async function isVectorPathActive(): Promise<boolean> {
  if (_vecAvailable !== undefined) return _vecAvailable;
  if (process.env.FORCE_VECTOR_FALLBACK === '1') {
    _vecAvailable = false;
    return false;
  }
  try {
    const sqliteVec = await import('sqlite-vec');
    sqliteVec.load(getDb());
    _vecAvailable = true;
  } catch {
    // Extension not present for this platform/arch, or failed to dlopen
    // (e.g. a glibc-built binary under musl libc) -- either way, the
    // brute-force fallback below takes over transparently.
    _vecAvailable = false;
  }
  return _vecAvailable;
}

/** Test-only: clears the cached capability decision so a test can toggle
 * `FORCE_VECTOR_FALLBACK` and observe the effect within the same process. */
export function __resetCapabilityCacheForTests(): void {
  _vecAvailable = undefined;
}

/** Closes the dedicated connection this module owns. Test teardown only --
 * mirrors `disconnectPrisma()` in `server/src/services/prisma.ts`. */
export function closeSearchDb(): void {
  if (_db) {
    _db.close();
    _db = undefined;
  }
  _vecAvailable = undefined;
  _vecDimension = undefined;
}

function ensureVecTable(db: Database.Database, dimension: number): void {
  if (_vecDimension !== undefined) {
    if (_vecDimension !== dimension) {
      throw new Error(
        `search.ts: VecEmbeddings was created for ${_vecDimension}-dimension vectors; ` +
          `got a ${dimension}-dimension query vector. Mixed-dimension embeddings across ` +
          'models are not supported by this proof-of-mechanics implementation (ticket ' +
          '002-005) -- a later ticket populating real, possibly multi-model embeddings ' +
          'will need to partition the index by model.'
      );
    }
    return;
  }
  // `IF NOT EXISTS` only guards against re-creating the table within this
  // process's lifetime; it does not validate that a table left over from a
  // prior process (e.g. an earlier test file, each of which forks its own
  // process -- see tests/server/setup.ts) was created with this same fixed
  // dimension. Not a concern at this ticket's scope (one process ever
  // populates real vectors), but a future multi-model ticket populating
  // different-dimension embeddings across process boundaries would need a
  // per-dimension (or per-model) table name instead of one fixed name.
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS "${VEC_TABLE}" USING vec0(` +
      `embedding_id INTEGER PRIMARY KEY, vector float[${dimension}] distance_metric=cosine)`
  );
  _vecDimension = dimension;
}

/**
 * Rebuilds the `VecEmbeddings` mirror table from the authoritative
 * `Embedding` table. `Embedding` rows are effectively append-only at this
 * ticket's scale (Sprint 004's pipeline is the only future writer), so a
 * full clear-and-reinsert on each query is simple and correct; it is not
 * the design for production-scale corpora (same caveat as the brute-force
 * fallback below -- flagged in ticket 002-005 as a fallback/proof path, not
 * the primary-scale design).
 */
function syncVecTable(db: Database.Database, dimension: number): void {
  ensureVecTable(db, dimension);
  const expectedBytes = dimension * BYTES_PER_FLOAT32;
  const rows = db.prepare(`SELECT id, vector FROM "Embedding"`).all() as { id: number; vector: Buffer }[];
  const insert = db.prepare(`INSERT INTO "${VEC_TABLE}" (embedding_id, vector) VALUES (?, ?)`);
  const rebuild = db.transaction((allRows: typeof rows) => {
    db.exec(`DELETE FROM "${VEC_TABLE}"`);
    for (const row of allRows) {
      // Skip embeddings whose stored vector doesn't match the dimension this
      // table was created for (e.g. a different embedding model) -- they
      // simply don't participate in the fast path; see ensureVecTable's note.
      if (row.vector.length !== expectedBytes) continue;
      insert.run(BigInt(row.id), row.vector);
    }
  });
  rebuild(rows);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function toFloat32Buffer(vector: number[] | Float32Array): Buffer {
  const arr = vector instanceof Float32Array ? vector : Float32Array.from(vector);
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

function nearestNeighborsVec(
  db: Database.Database,
  queryVector: Float32Array,
  k: number,
  ownerType?: OwnerType
): NearestNeighborResult[] {
  syncVecTable(db, queryVector.length);
  const totalIndexed = (db.prepare(`SELECT count(*) as c FROM "${VEC_TABLE}"`).get() as { c: number }).c;
  if (totalIndexed === 0) return [];
  // Over-fetch every indexed row rather than just `k`: vec0's `k =` clause
  // limits *before* the ownerType filter below is applied (a plain SQL
  // predicate on the joined Embedding row, not a vec0 partition key), so
  // requesting only `k` could drop matches of the requested ownerType that
  // rank outside the top `k` overall. Fine at this ticket's seed-data scale;
  // a production-scale version would use vec0's partition-key feature to
  // filter before the KNN cutoff instead.
  const rows = db
    .prepare(
      `SELECT v.embedding_id as embeddingId, v.distance as distance, e.ownerType as ownerType, e.ownerId as ownerId
       FROM "${VEC_TABLE}" v
       JOIN "Embedding" e ON e.id = v.embedding_id
       WHERE v.vector MATCH ? AND k = ?
       ORDER BY v.distance ASC`
    )
    .all(toFloat32Buffer(queryVector), totalIndexed) as {
    embeddingId: number;
    distance: number;
    ownerType: string;
    ownerId: number;
  }[];
  const filtered = ownerType ? rows.filter((r) => r.ownerType === ownerType) : rows;
  return filtered.slice(0, k).map((r) => ({
    ownerType: r.ownerType,
    ownerId: r.ownerId,
    score: 1 - r.distance, // vec0 cosine distance -> cosine similarity
  }));
}

function nearestNeighborsBruteForce(
  db: Database.Database,
  queryVector: Float32Array,
  k: number,
  ownerType?: OwnerType
): NearestNeighborResult[] {
  const rows = (
    ownerType
      ? db.prepare(`SELECT ownerType, ownerId, vector FROM "Embedding" WHERE ownerType = ?`).all(ownerType)
      : db.prepare(`SELECT ownerType, ownerId, vector FROM "Embedding"`).all()
  ) as { ownerType: string; ownerId: number; vector: Buffer }[];

  const scored: NearestNeighborResult[] = [];
  for (const row of rows) {
    if (row.vector.length !== queryVector.length * BYTES_PER_FLOAT32) continue;
    const vec = new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / BYTES_PER_FLOAT32);
    scored.push({ ownerType: row.ownerType, ownerId: row.ownerId, score: cosineSimilarity(queryVector, vec) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/**
 * K-nearest-neighbor search over `Embedding` rows by cosine similarity.
 * Branches internally on `isVectorPathActive()` -- the only branch point in
 * the codebase that knows both `sqlite-vec` and the brute-force fallback
 * exist. Returns the `k` closest rows, highest similarity first.
 */
export async function nearestNeighbors(
  vector: number[] | Float32Array,
  k: number,
  options?: { ownerType?: OwnerType }
): Promise<NearestNeighborResult[]> {
  const queryVector = vector instanceof Float32Array ? vector : Float32Array.from(vector);
  const db = getDb();
  const useVec = await isVectorPathActive();
  return useVec
    ? nearestNeighborsVec(db, queryVector, k, options?.ownerType)
    : nearestNeighborsBruteForce(db, queryVector, k, options?.ownerType);
}

/** Upserts a `KnowledgeEntry` row into the FTS5 keyword index. */
export function indexKnowledgeEntry(entry: { id: number; name: string; bodyText: string }): void {
  const db = getDb();
  db.prepare(`DELETE FROM "SearchIndex" WHERE ownerType = 'knowledge_entry' AND ownerId = ?`).run(entry.id);
  db.prepare(
    `INSERT INTO "SearchIndex" (ownerType, ownerId, name, body, tags) VALUES ('knowledge_entry', ?, ?, ?, '')`
  ).run(entry.id, entry.name, entry.bodyText);
}

/** Upserts an `AssetDescription` row into the FTS5 keyword index. */
export function indexAssetDescription(desc: { assetId: number; description: string; tags?: string[] | null }): void {
  const db = getDb();
  db.prepare(`DELETE FROM "SearchIndex" WHERE ownerType = 'asset' AND ownerId = ?`).run(desc.assetId);
  const tagsText = (desc.tags ?? []).join(' ');
  db.prepare(
    `INSERT INTO "SearchIndex" (ownerType, ownerId, name, body, tags) VALUES ('asset', ?, '', ?, ?)`
  ).run(desc.assetId, desc.description, tagsText);
}

/** Removes a row from the FTS5 keyword index (e.g. when its owner is deleted). */
export function removeFromKeywordIndex(ownerType: OwnerType, ownerId: number): void {
  const db = getDb();
  db.prepare(`DELETE FROM "SearchIndex" WHERE ownerType = ? AND ownerId = ?`).run(ownerType, ownerId);
}

/**
 * FTS5 keyword/tag search over `AssetDescription.description`,
 * `AssetDescription.tags`, `KnowledgeEntry.bodyText`, and
 * `KnowledgeEntry.name`, ranked by FTS5's built-in relevance rank.
 */
export function keywordSearch(query: string, options?: { ownerType?: OwnerType; limit?: number }): KeywordSearchResult[] {
  const db = getDb();
  const limit = options?.limit ?? 20;
  const rows = (
    options?.ownerType
      ? db
          .prepare(
            `SELECT ownerType, ownerId FROM "SearchIndex" WHERE "SearchIndex" MATCH ? AND ownerType = ? ORDER BY rank LIMIT ?`
          )
          .all(query, options.ownerType, limit)
      : db
          .prepare(`SELECT ownerType, ownerId FROM "SearchIndex" WHERE "SearchIndex" MATCH ? ORDER BY rank LIMIT ?`)
          .all(query, limit)
  ) as KeywordSearchResult[];
  return rows;
}

import fs from 'fs/promises';
import path from 'path';
import { prisma as defaultPrisma } from './prisma';
import { classifyAndDescribe } from './imaging';
import type { ClassifyAndDescribeInput, ImagingCallOptions, AssetClassification } from './imaging';
import { indexAssetDescription } from './search';
import { resolveWorkspacePath } from './workspaceDirectorySync';
import type { AssetModel } from '../generated/prisma/models/Asset';
import type { AssetDescriptionModel } from '../generated/prisma/models/AssetDescription';
import type { EmbeddingModel } from '../generated/prisma/models/Embedding';

/**
 * Description & Embedding Pipeline (architecture-001 Module 8;
 * architecture-update.md Step 3's "first real implementation" of it;
 * ticket 004-003). Turns a newly committed `Asset` into a classification
 * + rich description + tag set (`AssetDescription`) and a retrieval
 * embedding (`Embedding`), then makes it FTS5-searchable via `search.ts`'s
 * existing `indexAssetDescription` -- all through the normal Prisma
 * client, no new write path.
 *
 * **Filesystem boundary (architecture-001 Module 8, unchanged)**: "writes
 * only to the Catalog & Knowledge Store and the Vector Index -- never
 * touches the Workspace Filesystem directly (the asset file itself was
 * already placed there by the MCP tool that triggered this pipeline)."
 * `describeAsset` itself never calls `fs`. The asset's image bytes/URL are
 * supplied by the caller as `options.input` -- in production that caller is
 * `agent-mcp/catalogTools.ts`'s `addAssetToCollection`, which already
 * does filesystem I/O for its other tools (`create_agent_page`) and reads
 * the asset's bytes off the Workspace Filesystem itself before invoking
 * `describeAsset`. Tests inject `options.input` directly (fixture bytes,
 * or simply omitted since the fixture-backed `classifyAndDescribe` stub
 * never actually decodes them), so no real file ever needs to exist on
 * disk for this module's own tests. `retryPendingDescriptions` below is the
 * one exception: unlike the original commit, no caller is holding fresh
 * bytes for a retry pass, so its default `loadInput` reads the asset's file
 * off the Workspace Filesystem itself -- test-injectable, so this module's
 * own tests still never touch a real file.
 *
 * **Pending/retry model (architecture-update.md Step 6 R2, ticket
 * 004-004)**: an `Asset` row with no `AssetDescription` row *is* the
 * pending-retry state -- there is no separate status column or queue
 * table. `retryPendingDescriptions` queries exactly that state
 * (`AssetDescription` absent, optionally scoped to one `Collection`) and
 * re-invokes `describeAsset` for each match, so a previously-failed asset
 * is retried through the identical happy path as a brand-new commit. Two
 * retry triggers call it: an opportunistic best-effort pass from
 * `addAssetToCollection` (piggybacking on the next asset committed into
 * the same collection) and a `ScheduledJob` named `description-retry`
 * (`registerDescriptionRetryJob` below), registered at app startup on an
 * hourly cadence -- coarse-grained is acceptable per R2's rationale, since
 * a pending asset is already fully usable via filename/path search (UC-014
 * E3) while it waits to be described.
 *
 * **Failure containment (architecture-update.md Step 6 R2,
 * "pending-description-as-absent-row")**: `describeAsset` lets any
 * failure -- a `classifyAndDescribe` network/timeout/parse error
 * (`ImagingServiceError`), or a Prisma write error -- propagate to its
 * caller; it does not swallow anything itself. `addAssetToCollection` is
 * the one that catches, logs, and swallows it, *after* its directory
 * lock is already released, so the vision-model call never holds up
 * other writers to that directory (UC-008 E4). An `Asset` row left with
 * no `AssetDescription` row *is* the pending-retry state R2 defines --
 * no new status column, no queue table -- so a failed `describeAsset`
 * call simply leaves that state in place for ticket 004's retry path
 * (which re-invokes this same function against exactly that "asset with
 * no description" query) to pick up later.
 *
 * **Embedding-vector convention (established here)**: as of this ticket,
 * nothing in the codebase has ever populated a real `Embedding` row --
 * `search.ts`'s own tests only ever seed fixture vectors, and no
 * text-embedding API is named anywhere in spec/architecture-001/this
 * sprint's architecture-update.md (`imaging.ts` exposes only
 * `generateImage`/`classifyAndDescribe`, no embedding endpoint). Rather
 * than block this ticket on choosing and wiring up a real embedding
 * provider, `embedText` below computes a deterministic, dependency-free
 * "hashing trick" bag-of-words vector (fixed `EMBEDDING_DIMENSION`,
 * L2-normalized so cosine similarity behaves sensibly) over the
 * classification's `description` + `tags` text -- enough to exercise the
 * Vector Index's real KNN mechanics end to end (text sharing more words
 * embeds closer together) with zero network calls and zero API keys,
 * matching this ticket's "no live network call in tests" requirement by
 * construction rather than by mocking. `Embedding.model` is recorded as
 * `EMBEDDING_MODEL` (`'local-hash-embed-v1'`) precisely so this is
 * trivially distinguishable, in the same column, from a future real
 * embedding-API model -- a future ticket (this sprint's ticket 004, and
 * any future knowledge-entry embedding work) that wants real semantic
 * embeddings should replace `embedText`'s body and bump `EMBEDDING_MODEL`,
 * while keeping the same fixed-dimension, Float32 little-endian
 * `Buffer.from(Float32Array.buffer)` encoding `search.ts`'s own test
 * fixtures already use -- so mixed-model rows stay distinguishable via
 * `Embedding.model` per `search.ts`'s `ensureVecTable` dimension-mismatch
 * handling.
 */

// ---------------------------------------------------------------------------
// Embedding convention (local, dependency-free -- see module header)
// ---------------------------------------------------------------------------

/** `Embedding.model` value for every vector this module writes until a
 * real embedding API replaces `embedText` (see module header). */
export const EMBEDDING_MODEL = 'local-hash-embed-v1';

/** Fixed vector width for `EMBEDDING_MODEL`. Every `Embedding` row this
 * module writes has exactly this many Float32 components. */
export const EMBEDDING_DIMENSION = 64;

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** FNV-1a, a small well-known non-cryptographic hash -- deterministic
 * across runs/platforms, which is all this "hashing trick" embedding
 * needs. */
function hashToken(token: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic "hashing trick" bag-of-words embedding (see module header
 * for why this exists instead of a real embedding-API call). Each token
 * hashes into one of `EMBEDDING_DIMENSION` buckets with a pseudo-random
 * sign (spreading collisions' bias across +/-), then the whole vector is
 * L2-normalized so cosine similarity between two texts reflects shared
 * vocabulary. An empty/all-punctuation input yields the zero vector
 * (never normalized, since dividing by a zero norm would produce NaNs).
 */
export function embedText(text: string): Float32Array {
  const vector = new Float32Array(EMBEDDING_DIMENSION);
  for (const token of tokenize(text)) {
    const h = hashToken(token);
    const index = h % EMBEDDING_DIMENSION;
    const sign = (h & 1) === 0 ? 1 : -1;
    vector[index] += sign;
  }

  let normSq = 0;
  for (let i = 0; i < vector.length; i += 1) normSq += vector[i] * vector[i];
  if (normSq === 0) return vector;

  const norm = Math.sqrt(normSq);
  for (let i = 0; i < vector.length; i += 1) vector[i] /= norm;
  return vector;
}

/** Packs a Float32Array into the little-endian `Bytes` encoding
 * `Embedding.vector` and `search.ts` (`toFloat32Buffer`,
 * `nearestNeighborsBruteForce`, `syncVecTable`) already assume. */
function toEmbeddingBytes(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

// ---------------------------------------------------------------------------
// describeAsset
// ---------------------------------------------------------------------------

export interface DescribeAssetOptions {
  /** Prisma client used for the `AssetDescription`/`Embedding` writes.
   * Defaults to the shared app singleton; test-injectable. */
  prismaClient?: any;
  /** The asset's image bytes/URL, forwarded as-is to
   * `imaging.classifyAndDescribe` -- see module header on why this
   * module never reads it off the filesystem itself. Required: there is
   * no filesystem fallback here. */
  input: ClassifyAndDescribeInput;
  /** Forwarded to `imaging.classifyAndDescribe` -- `fetchImpl`/
   * `openrouterApiKey`/`openrouterModel`/`logger` overrides. Tests always
   * supply `fetchImpl` (and a dummy `openrouterApiKey`), so no real
   * network call is ever attempted in the suite. */
  imagingOptions?: ImagingCallOptions;
}

export interface DescribeAssetResult {
  description: AssetDescriptionModel;
  embedding: EmbeddingModel;
  classification: AssetClassification;
}

/**
 * Runs the full Description & Embedding Pipeline for one already-committed
 * `Asset`: classify/describe/tag via the Image & Vision Service, write the
 * `AssetDescription` and `Embedding` rows, then index the description/tags
 * into the FTS5 keyword index. Throws on any failure (see module header on
 * why this function itself never catches) -- callers that must not let a
 * vision-model failure propagate (`addAssetToCollection`) wrap this call
 * in their own try/catch.
 */
export async function describeAsset(
  asset: Pick<AssetModel, 'id'>,
  options: DescribeAssetOptions
): Promise<DescribeAssetResult> {
  const prismaClient = options.prismaClient ?? defaultPrisma;

  const classification = await classifyAndDescribe(options.input, options.imagingOptions);

  const description = await prismaClient.assetDescription.create({
    data: {
      assetId: asset.id,
      isPhotograph: classification.isPhotograph,
      isLogo: classification.isLogo,
      style: classification.style,
      peopleReal: classification.peopleReal,
      description: classification.description,
      tags: classification.tags,
    },
  });

  const embeddingSourceText = [classification.description, ...classification.tags].join(' ');
  const vector = embedText(embeddingSourceText);
  const embedding = await prismaClient.embedding.create({
    data: {
      ownerType: 'asset',
      ownerId: asset.id,
      vector: toEmbeddingBytes(vector),
      model: EMBEDDING_MODEL,
    },
  });

  indexAssetDescription({
    assetId: asset.id,
    description: classification.description,
    tags: classification.tags,
  });

  return { description, embedding, classification };
}

// ---------------------------------------------------------------------------
// retryPendingDescriptions (ticket 004-004 -- see module header)
// ---------------------------------------------------------------------------

/** Best-effort MIME type for a pending asset's stored path, used only by
 * `defaultLoadInput` below -- mirrors `catalogTools.ts`'s own
 * `mimeTypeForAssetPath` (not imported from there: that one is private to
 * `catalogTools.ts`, and duplicating this small lookup avoids a dependency
 * from this module back onto the agent-mcp layer). */
const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
};

function mimeTypeForAssetPath(assetPath: string): string {
  return MIME_BY_EXTENSION[path.extname(assetPath).toLowerCase()] ?? 'image/png';
}

/** Default `loadInput` for `retryPendingDescriptions`: reads the pending
 * asset's bytes off the Workspace Filesystem itself, the same fallback
 * `addAssetToCollection` uses when no fixture `input` is supplied. */
async function defaultLoadInput(asset: Pick<AssetModel, 'path'>): Promise<ClassifyAndDescribeInput> {
  return {
    imageBytes: await fs.readFile(resolveWorkspacePath(asset.path)),
    mimeType: mimeTypeForAssetPath(asset.path),
  };
}

/** The minimal logger shape `retryPendingDescriptions` depends on for a
 * still-failing asset -- mirrors `catalogTools.ts`'s `CatalogToolsLogger`. */
export interface DescriptionRetryLogger {
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface RetryPendingDescriptionsOptions {
  /** Prisma client used for the pending-asset query and every retried
   * `describeAsset` call. Defaults to the shared app singleton;
   * test-injectable. */
  prismaClient?: any;
  /** Restricts the retry pass to `Asset` rows in this `Collection` --
   * used by the opportunistic hook (`addAssetToCollection`) to scope
   * retries to the collection just written to, rather than scanning the
   * whole catalog on every commit. Omitted for the scheduled/global pass. */
  collectionId?: number;
  /** Excludes one `Asset` id from the pending query -- the opportunistic
   * hook uses this to exclude the asset it just committed (whose own
   * `describeAsset` attempt, success or failure, already just ran), so
   * this pass only ever retries a *previously* pending asset. */
  excludeAssetId?: number;
  /** Forwarded to every retried `describeAsset` call's `imagingOptions`
   * (`fetchImpl`/`openrouterApiKey`/... overrides) -- test-injectable. */
  imagingOptions?: ImagingCallOptions;
  /** Supplies each pending asset's image bytes/URL for `describeAsset`'s
   * `input`. Defaults to `defaultLoadInput` (reads the file off the
   * Workspace Filesystem -- see module header); test-injectable so tests
   * never touch the real filesystem. */
  loadInput?: (asset: Pick<AssetModel, 'id' | 'path'>) => Promise<ClassifyAndDescribeInput>;
  /** Logged once per asset that fails again this pass -- the asset is left
   * pending for the next invocation (opportunistic or scheduled), never
   * thrown out of this function. Defaults to a no-op so a scheduled-job
   * run without an explicit logger never throws. */
  logger?: DescriptionRetryLogger;
}

export interface RetryPendingDescriptionsResult {
  /** Number of pending `Asset` rows this pass attempted. */
  attempted: number;
  /** Number that now have an `AssetDescription`/`Embedding` row. */
  succeeded: number;
  /** Number still pending after this pass (left for the next retry). */
  failed: number;
}

const noopLogger: DescriptionRetryLogger = { error() {} };

/**
 * Retries the Description & Embedding Pipeline for every `Asset` row with
 * no `AssetDescription` row -- the pending-retry state R2 defines (see
 * module header). Idempotent by construction: once an asset gets a
 * description, it no longer matches this query, so re-invoking this
 * function never re-processes it (`classifyAndDescribe` is called at most
 * once per asset per still-pending state). A still-failing asset is simply
 * left pending -- its failure is logged, never thrown, so one bad asset
 * never stops the rest of the pass.
 */
export async function retryPendingDescriptions(
  options: RetryPendingDescriptionsOptions = {}
): Promise<RetryPendingDescriptionsResult> {
  const prismaClient = options.prismaClient ?? defaultPrisma;
  const loadInput = options.loadInput ?? defaultLoadInput;
  const logger = options.logger ?? noopLogger;

  const pending = (await prismaClient.asset.findMany({
    where: {
      description: null,
      ...(options.collectionId !== undefined ? { collectionId: options.collectionId } : {}),
      ...(options.excludeAssetId !== undefined ? { id: { not: options.excludeAssetId } } : {}),
    },
  })) as AssetModel[];

  let succeeded = 0;
  let failed = 0;
  for (const asset of pending) {
    try {
      const input = await loadInput(asset);
      await describeAsset(asset, { prismaClient, input, imagingOptions: options.imagingOptions });
      succeeded += 1;
    } catch (err) {
      failed += 1;
      logger.error(
        { err, assetId: asset.id, path: asset.path },
        'retryPendingDescriptions: description pipeline failed again; Asset left pending for the next retry pass'
      );
    }
  }

  return { attempted: pending.length, succeeded, failed };
}

/** The minimal `SchedulerService` surface `registerDescriptionRetryJob`
 * depends on -- narrow enough for a test to inject a plain stub without a
 * real `SchedulerService`/Prisma instance. */
export interface DescriptionRetrySchedulerHandle {
  registerHandler(jobName: string, handler: () => Promise<void>): void;
}

/**
 * Registers the `'description-retry'` job handler on `scheduler` --
 * invoking `retryPendingDescriptions(options)` whenever `SchedulerService`
 * runs that job (its `ScheduledJob` row is seeded by
 * `SchedulerService.seedDefaults`, `frequency: 'hourly'`). Split out from
 * `server/src/index.ts`'s inline startup wiring so a test can call it
 * directly against a stub scheduler, without booting the whole app.
 */
export function registerDescriptionRetryJob(
  scheduler: DescriptionRetrySchedulerHandle,
  options: RetryPendingDescriptionsOptions = {}
): void {
  scheduler.registerHandler('description-retry', async () => {
    await retryPendingDescriptions(options);
  });
}

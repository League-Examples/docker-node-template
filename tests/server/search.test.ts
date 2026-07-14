/**
 * Ticket 002-005: Vector and full-text indexing (sqlite-vec + FTS5 with
 * brute-force fallback).
 *
 * Proves the indexing *mechanics* against test-seeded data -- not real
 * embeddings from actual assets/knowledge content (that's Sprint 004's
 * Description & Embedding Pipeline and ticket 006). Covers:
 *
 *  - KNN correctness (a query vector closer to one seeded embedding than
 *    another returns the closer row first), exercised against both the
 *    `sqlite-vec` path (whatever this environment naturally provides) and
 *    the brute-force fallback (forced on via `FORCE_VECTOR_FALLBACK=1`,
 *    regardless of what the environment naturally provides -- ticket's
 *    Testing Plan).
 *  - FTS5 keyword search over a seeded `KnowledgeEntry.bodyText`.
 *  - Graceful fallback: forcing the fallback path never throws.
 *
 * Platform note: this test suite ran on macOS (arm64) dev, where the
 * `sqlite-vec` extension loads natively (confirmed directly and logged
 * below). Separately, this ticket confirmed via a `node:20-alpine` (this
 * repo's actual Docker base image) container test that the same package's
 * prebuilt `linux-x64` binary fails to `dlopen` there ("Error loading
 * shared library ... vec0.so.so: No such file or directory" -- a glibc-
 * built binary under musl libc). Production therefore runs the
 * brute-force fallback today; see the ticket file's Testing Notes and this
 * sprint's architecture-update.md Open Question 1 for the full writeup.
 */
import { prisma } from '../../server/src/services/prisma';
import {
  nearestNeighbors,
  keywordSearch,
  indexKnowledgeEntry,
  removeFromKeywordIndex,
  isVectorPathActive,
  closeSearchDb,
  __resetCapabilityCacheForTests,
} from '../../server/src/services/search';

const marker = `t005-${Date.now()}`;
// Captured once at module load, before any test mutates the env var, so
// tests that need a *specific* setting can restore this original value
// afterward instead of always deleting it. This way, invoking the suite as
// `FORCE_VECTOR_FALLBACK=1 npm test` (this ticket's second verification
// command) genuinely forces every test -- including the "natural path"
// test below -- into the fallback path for the whole run, while a plain
// `npm test` (this var unset) still exercises both paths in one run via the
// tests that explicitly set/restore it. See ticket 002-005 Testing Plan.
const originalForceFallbackEnv = process.env.FORCE_VECTOR_FALLBACK;

let dirId: number;
// FTS-created rows persist for the whole file (each is independent, no cross-
// contamination risk for keyword search). KNN rows are tracked separately and
// cleared between tests -- see clearKnnFixture() -- because nearestNeighbors
// scores every knowledge_entry embedding in the table each time it's called,
// so leftover rows from an earlier KNN test would otherwise pollute a later
// test's ranking (all fixtures reuse the same query vector).
const ftsEntryIds: number[] = [];
let knnEntryIds: number[] = [];
let knnEmbeddingIds: number[] = [];

function vec(values: number[]): Buffer {
  return Buffer.from(new Float32Array(values).buffer);
}

function restoreForceFallbackEnv() {
  if (originalForceFallbackEnv === undefined) {
    delete process.env.FORCE_VECTOR_FALLBACK;
  } else {
    process.env.FORCE_VECTOR_FALLBACK = originalForceFallbackEnv;
  }
  __resetCapabilityCacheForTests();
}

beforeAll(async () => {
  const dir = await prisma.workspaceDirectory.create({
    data: { path: `${marker}/root`, kind: 'knowledge-category' },
  });
  dirId = dir.id;
});

afterAll(async () => {
  for (const id of ftsEntryIds) {
    removeFromKeywordIndex('knowledge_entry', id);
  }
  await prisma.embedding.deleteMany({ where: { id: { in: knnEmbeddingIds } } });
  await prisma.knowledgeEntry.deleteMany({ where: { id: { in: [...ftsEntryIds, ...knnEntryIds] } } });
  await prisma.workspaceDirectory.deleteMany({ where: { id: dirId } });
  restoreForceFallbackEnv();
  closeSearchDb();
});

/** Removes whatever the previous KNN test seeded, so each KNN test starts
 * from an empty `Embedding` table (nearestNeighbors has no per-test scoping
 * of its own -- it searches every row of the requested ownerType). */
async function clearKnnFixture() {
  if (knnEmbeddingIds.length) {
    await prisma.embedding.deleteMany({ where: { id: { in: knnEmbeddingIds } } });
  }
  if (knnEntryIds.length) {
    await prisma.knowledgeEntry.deleteMany({ where: { id: { in: knnEntryIds } } });
  }
  knnEmbeddingIds = [];
  knnEntryIds = [];
}

/**
 * Seeds two KnowledgeEntry rows with known, distinct embeddings: `near` is
 * close to the query vector `[1, 0, 0, 0]`, `far` is orthogonal to it.
 * Returns their KnowledgeEntry ids. Clears any previous KNN fixture first.
 */
async function seedKnnFixture() {
  await clearKnnFixture();

  const near = await prisma.knowledgeEntry.create({
    data: { directoryId: dirId, kind: 'style', name: `${marker}-near`, bodyText: 'near entry body' },
  });
  const far = await prisma.knowledgeEntry.create({
    data: { directoryId: dirId, kind: 'style', name: `${marker}-far`, bodyText: 'far entry body' },
  });
  knnEntryIds.push(near.id, far.id);

  const nearEmbedding = await prisma.embedding.create({
    data: { ownerType: 'knowledge_entry', ownerId: near.id, vector: vec([0.95, 0.05, 0, 0]), model: 'test-embed' },
  });
  const farEmbedding = await prisma.embedding.create({
    data: { ownerType: 'knowledge_entry', ownerId: far.id, vector: vec([0, 1, 0, 0]), model: 'test-embed' },
  });
  knnEmbeddingIds.push(nearEmbedding.id, farEmbedding.id);

  return { nearId: near.id, farId: far.id };
}

describe('nearestNeighbors', () => {
  afterEach(() => {
    restoreForceFallbackEnv();
  });

  it('logs whether the sqlite-vec extension loaded naturally on this platform (documentation, not an assertion)', async () => {
    // Reflects whatever this invocation naturally provides -- respects an
    // externally-set FORCE_VECTOR_FALLBACK (see originalForceFallbackEnv)
    // rather than always clearing it, so `FORCE_VECTOR_FALLBACK=1 npm test`
    // (this ticket's second verification command) genuinely forces this
    // too, not just the dedicated fallback test below.
    __resetCapabilityCacheForTests();
    const active = await isVectorPathActive();
    // eslint-disable-next-line no-console
    console.log(`[ticket 002-005] sqlite-vec active in this test invocation: ${active}`);
    expect(typeof active).toBe('boolean');
  });

  it('returns the closer embedding first via whichever path this environment naturally provides', async () => {
    __resetCapabilityCacheForTests();
    const { nearId, farId } = await seedKnnFixture();

    const results = await nearestNeighbors([1, 0, 0, 0], 2, { ownerType: 'knowledge_entry' });

    expect(results).toHaveLength(2);
    expect(results[0].ownerId).toBe(nearId);
    expect(results[1].ownerId).toBe(farId);
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('returns the closer embedding first via the brute-force fallback, forced on regardless of platform support', async () => {
    __resetCapabilityCacheForTests();
    process.env.FORCE_VECTOR_FALLBACK = '1';
    expect(await isVectorPathActive()).toBe(false);

    const { nearId, farId } = await seedKnnFixture();

    const results = await nearestNeighbors([1, 0, 0, 0], 2, { ownerType: 'knowledge_entry' });

    expect(results).toHaveLength(2);
    expect(results[0].ownerId).toBe(nearId);
    expect(results[1].ownerId).toBe(farId);
  });

  it('does not throw when the extension load is simulated to fail (forced fallback), and still returns results', async () => {
    __resetCapabilityCacheForTests();
    process.env.FORCE_VECTOR_FALLBACK = '1';
    await seedKnnFixture();

    await expect(nearestNeighbors([1, 0, 0, 0], 5, { ownerType: 'knowledge_entry' })).resolves.not.toThrow();
    const results = await nearestNeighbors([1, 0, 0, 0], 5, { ownerType: 'knowledge_entry' });
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('keywordSearch', () => {
  it('finds a KnowledgeEntry by a distinctive word in its bodyText', async () => {
    const distinctiveWord = `zzyzxquokka${marker.replace(/[^a-zA-Z0-9]/g, '')}`;
    const entry = await prisma.knowledgeEntry.create({
      data: {
        directoryId: dirId,
        kind: 'rule',
        name: `${marker}-fts-entry`,
        bodyText: `This entry mentions the word ${distinctiveWord} exactly once.`,
      },
    });
    ftsEntryIds.push(entry.id);

    indexKnowledgeEntry({ id: entry.id, name: entry.name, bodyText: entry.bodyText });

    const results = keywordSearch(distinctiveWord, { ownerType: 'knowledge_entry' });

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.ownerType === 'knowledge_entry' && r.ownerId === entry.id)).toBe(true);
  });

  it('returns no results for a word that was never indexed', () => {
    const results = keywordSearch(`nonexistentword${marker.replace(/[^a-zA-Z0-9]/g, '')}`);
    expect(results).toHaveLength(0);
  });
});

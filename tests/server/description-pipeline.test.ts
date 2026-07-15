/**
 * Coverage for the Description & Embedding Pipeline (ticket 004-003:
 * `server/src/services/description.ts`) and its hand-off from
 * `agent-mcp/catalogTools.ts`'s `add_asset_to_collection` -- the acceptance
 * criteria are all expressed in terms of `addAssetToCollection`'s observable
 * behavior, so that's what most of this file drives.
 *
 * Every test injects `describeAsset.input` (fixture bytes) and a stub
 * `fetchImpl` (never the real global `fetch`), so no real file read or
 * network call ever happens in this suite -- `process.env.OPENROUTER_API`
 * is never set in the test environment either (see
 * `tests/server/global-setup.ts`), so even the "no describeAsset options
 * given" cases below hit `classifyAndDescribe`'s own
 * no-credential-configured throw rather than a real network attempt.
 *
 * This file's one `nearestNeighbors` call forces the brute-force fallback
 * path (`FORCE_VECTOR_FALLBACK=1`, ticket 002-005's own test-only knob)
 * rather than exercising whichever path this platform naturally provides
 * (`search.test.ts` already covers both paths against its own fixtures).
 * Reason: the `sqlite-vec` `VecEmbeddings` mirror table is a single
 * `CREATE VIRTUAL TABLE IF NOT EXISTS` per test-database file (`search.ts`
 * `ensureVecTable`) fixed at whatever dimension first created it --
 * `search.test.ts`'s own KNN fixtures create it at 4 dimensions, and that
 * table (and its declared dimension) persists across test runs (global
 * cleanup deletes rows, not the table). This module's real embeddings use
 * a different, larger `EMBEDDING_DIMENSION` (see `description.ts`'s
 * header), which would otherwise collide with that leftover 4-dimension
 * table -- a pre-existing limitation `search.ts`'s own `ensureVecTable`
 * comment already flags ("a future multi-model ticket populating
 * different-dimension embeddings ... would need a per-dimension table").
 * This is purely a test-verification concern: `describeAsset` itself
 * never calls `nearestNeighbors` (production code never touches this
 * fallback switch); it only writes `Embedding` rows, so nothing about the
 * pipeline's real behavior is affected.
 */
import { prisma } from '../../server/src/services/prisma';
import { addAssetToCollection } from '../../server/src/agent-mcp/catalogTools';
import { acquireLock, releaseLock } from '../../server/src/agent-mcp/locks';
import { describeAsset, embedText, EMBEDDING_MODEL, EMBEDDING_DIMENSION } from '../../server/src/services/description';
import {
  nearestNeighbors,
  keywordSearch,
  removeFromKeywordIndex,
  __resetCapabilityCacheForTests,
} from '../../server/src/services/search';
import type { VersioningRecorder } from '../../server/src/agent-mcp/fsTools';

const marker = `t003desc${Date.now()}`.replace(/[^a-zA-Z0-9]/g, '');
const originalForceVectorFallbackEnv = process.env.FORCE_VECTOR_FALLBACK;

let assetsDirId: number;
let assetsDirPath: string;

const cleanup = {
  embeddingIds: [] as number[],
  assetIds: [] as number[],
  collectionIds: [] as number[],
  workspaceDirectoryIds: [] as number[],
};

function spyVersioning(): VersioningRecorder & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    recordChange(p: string) {
      calls.push(p);
    },
  };
}

/** A real OpenRouter chat-completions success response wrapping the given
 * classification JSON in the message-content shape `classifyAndDescribe`
 * parses -- mirrors ticket 004-001's own `imaging.test.ts` fixture style. */
function classificationResponse(json: Record<string, unknown>): Response {
  const body = {
    model: 'deepseek/deepseek-v4-pro',
    choices: [{ message: { role: 'assistant', content: JSON.stringify(json) } }],
  };
  return new Response(JSON.stringify(body), { status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json' } });
}

function failureResponse(status = 503): Response {
  return new Response(JSON.stringify({ error: { message: 'simulated upstream failure' } }), {
    status,
    statusText: 'Error',
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeClassification(distinctiveTag: string) {
  return {
    isPhotograph: true,
    isLogo: false,
    style: 'photograph',
    peopleReal: 'real',
    description: `A bright photograph of students at a robotics workshop, tagged ${distinctiveTag} for this test.`,
    tags: ['robotics', 'workshop', distinctiveTag],
  };
}

const FIXTURE_INPUT = { imageBytes: Buffer.from('fake-image-bytes-for-test'), mimeType: 'image/png' };

beforeAll(async () => {
  // See module header: forces nearestNeighbors onto the brute-force path
  // for this file, sidestepping the shared VecEmbeddings table's fixed
  // dimension (a pre-existing search.ts/ticket-002-005 limitation).
  process.env.FORCE_VECTOR_FALLBACK = '1';
  __resetCapabilityCacheForTests();

  const assetsDir = await prisma.workspaceDirectory.create({
    data: { path: `${marker}/assets`, kind: 'collection' },
  });
  assetsDirId = assetsDir.id;
  assetsDirPath = assetsDir.path;
  cleanup.workspaceDirectoryIds.push(assetsDir.id);
});

afterAll(async () => {
  await prisma.embedding.deleteMany({ where: { id: { in: cleanup.embeddingIds } } });
  await prisma.assetDescription.deleteMany({ where: { assetId: { in: cleanup.assetIds } } });
  await prisma.asset.deleteMany({ where: { id: { in: cleanup.assetIds } } });
  await prisma.collection.deleteMany({ where: { id: { in: cleanup.collectionIds } } });
  await prisma.workspaceDirectory.deleteMany({ where: { id: { in: cleanup.workspaceDirectoryIds } } });
  for (const id of cleanup.assetIds) {
    removeFromKeywordIndex('asset', id);
  }

  if (originalForceVectorFallbackEnv === undefined) {
    delete process.env.FORCE_VECTOR_FALLBACK;
  } else {
    process.env.FORCE_VECTOR_FALLBACK = originalForceVectorFallbackEnv;
  }
  __resetCapabilityCacheForTests();
});

afterEach(async () => {
  await prisma.lock.deleteMany({ where: { resourceType: 'directory', resourceKey: assetsDirPath } });
});

async function collectionIdFor(name: string): Promise<number> {
  const collection = await prisma.collection.findFirstOrThrow({ where: { directoryId: assetsDirId, name } });
  return collection.id;
}

// ---------------------------------------------------------------------------
// embedText -- the local embedding convention this ticket establishes
// ---------------------------------------------------------------------------

describe('embedText', () => {
  it('is deterministic: the same text always produces the same vector', () => {
    const a = embedText('a robot mascot in a workshop');
    const b = embedText('a robot mascot in a workshop');
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('produces a fixed-dimension, L2-normalized vector for non-empty text', () => {
    const vector = embedText('students building a robot together');
    expect(vector.length).toBe(EMBEDDING_DIMENSION);
    const norm = Math.sqrt(Array.from(vector).reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('embeds texts sharing vocabulary closer together than unrelated texts', () => {
    function cosine(a: Float32Array, b: Float32Array): number {
      let dot = 0;
      for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
      return dot;
    }
    const base = embedText('robot workshop students building together');
    const related = embedText('students building a robot in the workshop');
    const unrelated = embedText('quarterly finance spreadsheet totals summary');

    expect(cosine(base, related)).toBeGreaterThan(cosine(base, unrelated));
  });
});

// ---------------------------------------------------------------------------
// add_asset_to_collection -- Description & Embedding Pipeline hand-off
// ---------------------------------------------------------------------------

describe('add_asset_to_collection: Description & Embedding Pipeline (ticket 004-003)', () => {
  it('AC1-3: a successful commit produces an AssetDescription, exactly one Embedding, and an FTS5-searchable entry', async () => {
    const distinctiveTag = `${marker}happytag`;
    const classification = makeClassification(distinctiveTag);
    const fetchImpl = vi.fn().mockResolvedValue(classificationResponse(classification));
    const collectionName = `${marker}-happy-collection`;

    const asset = await addAssetToCollection(
      { directoryId: assetsDirId, collectionName, path: `${marker}/assets/happy.png`, hash: 'hash-happy' },
      {
        versioning: spyVersioning(),
        describeAsset: { input: FIXTURE_INPUT, imagingOptions: { fetchImpl, openrouterApiKey: 'test-key' } },
      }
    );
    cleanup.assetIds.push(asset.id);
    cleanup.collectionIds.push(await collectionIdFor(collectionName));

    // AC1: AssetDescription with all four classification fields + description.
    const description = await prisma.assetDescription.findUnique({ where: { assetId: asset.id } });
    expect(description).not.toBeNull();
    expect(description!.isPhotograph).toBe(true);
    expect(description!.isLogo).toBe(false);
    expect(description!.style).toBe('photograph');
    expect(description!.peopleReal).toBe('real');
    expect(description!.description.length).toBeGreaterThan(0);

    // AC2: exactly one Embedding row, retrievable via nearestNeighbors.
    const embeddings = await prisma.embedding.findMany({ where: { ownerType: 'asset', ownerId: asset.id } });
    cleanup.embeddingIds.push(...embeddings.map((e: { id: number }) => e.id));
    expect(embeddings).toHaveLength(1);
    expect(embeddings[0].ownerType).toBe('asset');
    expect(embeddings[0].ownerId).toBe(asset.id);
    expect(embeddings[0].model).toBe(EMBEDDING_MODEL);

    const selfQueryVector = embedText([classification.description, ...classification.tags].join(' '));
    const neighbors = await nearestNeighbors(selfQueryVector, 5, { ownerType: 'asset' });
    expect(neighbors.some((n) => n.ownerId === asset.id)).toBe(true);

    // AC3: keywordSearch against a token in the description/tags finds it.
    const results = keywordSearch(distinctiveTag, { ownerType: 'asset' });
    expect(results.some((r) => r.ownerType === 'asset' && r.ownerId === asset.id)).toBe(true);
  });

  it('AC4: return value, and locking/versioning behavior, are unchanged when the pipeline succeeds', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(classificationResponse(makeClassification(`${marker}unchanged`)));
    const versioning = spyVersioning();
    const collectionName = `${marker}-unchanged-collection`;

    const asset = await addAssetToCollection(
      { directoryId: assetsDirId, collectionName, path: `${marker}/assets/unchanged.png`, hash: 'hash-unchanged' },
      { versioning, describeAsset: { input: FIXTURE_INPUT, imagingOptions: { fetchImpl, openrouterApiKey: 'test-key' } } }
    );
    cleanup.assetIds.push(asset.id);
    const collectionId = await collectionIdFor(collectionName);
    cleanup.collectionIds.push(collectionId);
    const embeddings = await prisma.embedding.findMany({ where: { ownerType: 'asset', ownerId: asset.id } });
    cleanup.embeddingIds.push(...embeddings.map((e: { id: number }) => e.id));

    expect(asset.collectionId).toBe(collectionId);
    expect(asset.path).toBe(`${marker}/assets/unchanged.png`);
    expect(asset.hash).toBe('hash-unchanged');
    // Exactly one versioning.recordChange call, same as before this ticket.
    expect(versioning.calls).toHaveLength(1);
    // Lock released, same as before this ticket.
    const lockCount = await prisma.lock.count({ where: { resourceType: 'directory', resourceKey: assetsDirPath } });
    expect(lockCount).toBe(0);
  });

  it('AC5: a simulated classifyAndDescribe failure does not throw out of addAssetToCollection, and writes no AssetDescription/Embedding', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(failureResponse(503));
    const logger = { error: vi.fn() };
    const collectionName = `${marker}-failure-collection`;

    const asset = await addAssetToCollection(
      { directoryId: assetsDirId, collectionName, path: `${marker}/assets/failure.png`, hash: 'hash-failure' },
      {
        versioning: spyVersioning(),
        logger,
        describeAsset: { input: FIXTURE_INPUT, imagingOptions: { fetchImpl, openrouterApiKey: 'test-key' } },
      }
    );
    cleanup.assetIds.push(asset.id);
    cleanup.collectionIds.push(await collectionIdFor(collectionName));

    // The Asset is still created and returned successfully.
    expect(asset.id).toBeGreaterThan(0);
    expect(asset.hash).toBe('hash-failure');
    expect(logger.error).toHaveBeenCalledTimes(1);

    const description = await prisma.assetDescription.findUnique({ where: { assetId: asset.id } });
    expect(description).toBeNull();
    const embeddings = await prisma.embedding.findMany({ where: { ownerType: 'asset', ownerId: asset.id } });
    expect(embeddings).toHaveLength(0);
  });

  it('AC5 (default path): with no describeAsset options given, a missing asset file on disk is swallowed the same way', async () => {
    const logger = { error: vi.fn() };
    const collectionName = `${marker}-nofile-collection`;

    // No describeAsset options at all -- addAssetToCollection falls back
    // to reading the asset's bytes off the Workspace Filesystem itself,
    // which don't exist at this path, so the read fails before any
    // network call would even be attempted.
    const asset = await addAssetToCollection(
      { directoryId: assetsDirId, collectionName, path: `${marker}/assets/does-not-exist-on-disk.png`, hash: 'hash-nofile' },
      { versioning: spyVersioning(), logger }
    );
    cleanup.assetIds.push(asset.id);
    cleanup.collectionIds.push(await collectionIdFor(collectionName));

    expect(asset.id).toBeGreaterThan(0);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const description = await prisma.assetDescription.findUnique({ where: { assetId: asset.id } });
    expect(description).toBeNull();
  });

  it('AC6: the pipeline call happens after the directory lock is released', async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const fetchImpl = vi.fn().mockImplementation(async () => {
      await gate;
      return classificationResponse(makeClassification(`${marker}locktiming`));
    });
    const collectionName = `${marker}-locktiming-collection`;

    const addPromise = addAssetToCollection(
      { directoryId: assetsDirId, collectionName, path: `${marker}/assets/locktiming.png`, hash: 'hash-locktiming' },
      {
        versioning: spyVersioning(),
        describeAsset: { input: FIXTURE_INPUT, imagingOptions: { fetchImpl, openrouterApiKey: 'test-key' } },
      }
    );

    // Wait until the (gated) vision-model call is actually in flight --
    // by this point addAssetToCollection has created the Asset and
    // released its directory lock.
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    // A concurrent lock acquisition on the same resourceKey succeeds
    // while the pipeline call is still pending -- proves the lock isn't
    // held during it.
    const concurrentLock = await acquireLock('directory', assetsDirPath, 'concurrent-tester');
    expect(concurrentLock).toBeDefined();
    await releaseLock('directory', assetsDirPath);

    releaseGate();
    const asset = await addPromise;
    cleanup.assetIds.push(asset.id);
    cleanup.collectionIds.push(await collectionIdFor(collectionName));
    const embeddings = await prisma.embedding.findMany({ where: { ownerType: 'asset', ownerId: asset.id } });
    cleanup.embeddingIds.push(...embeddings.map((e: { id: number }) => e.id));
    expect(embeddings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// describeAsset -- direct unit coverage
// ---------------------------------------------------------------------------

describe('describeAsset (direct)', () => {
  it('propagates a classifyAndDescribe failure rather than swallowing it (addAssetToCollection is the only swallower)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(failureResponse(500));
    // Build a throwaway Asset row directly (bypassing addAssetToCollection)
    // to exercise describeAsset in isolation.
    const collection = await prisma.collection.create({
      data: { directoryId: assetsDirId, name: `${marker}-direct-collection`, kind: 'stock-art' },
    });
    cleanup.collectionIds.push(collection.id);
    const asset = await prisma.asset.create({
      data: { collectionId: collection.id, path: `${marker}/assets/direct.png`, hash: 'hash-direct', mtime: new Date() },
    });
    cleanup.assetIds.push(asset.id);

    await expect(
      describeAsset(asset, { input: FIXTURE_INPUT, imagingOptions: { fetchImpl, openrouterApiKey: 'test-key' } })
    ).rejects.toThrow();

    const description = await prisma.assetDescription.findUnique({ where: { assetId: asset.id } });
    expect(description).toBeNull();
  });
});

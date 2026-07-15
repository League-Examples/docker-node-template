/**
 * Coverage for ticket 004-004: the vision-unavailable retry/queue
 * (`server/src/services/description.ts`'s `retryPendingDescriptions` /
 * `registerDescriptionRetryJob`, and `agent-mcp/catalogTools.ts`'s
 * opportunistic-retry hook in `addAssetToCollection`) plus the end-to-end
 * semantic-search verification (SUC-004) against pipeline-generated data.
 *
 * Per architecture-update.md R2 ("pending description as absent row"), an
 * `Asset` row with no `AssetDescription` row *is* the pending-retry state --
 * every test below sets that state up via a simulated `classifyAndDescribe`
 * failure (never a hand-written pending flag), and every "described" asset
 * gets there through the real pipeline (`describeAsset`/`retryPendingDescriptions`,
 * both ultimately calling the fixture-stubbed `classifyAndDescribe`), never a
 * raw `prisma.assetDescription.create` -- matching SUC-004's "pipeline-generated,
 * not hand-seeded" requirement.
 *
 * As in `description-pipeline.test.ts` (ticket 004-003), this file forces
 * `nearestNeighbors` onto the brute-force fallback path
 * (`FORCE_VECTOR_FALLBACK=1`) to sidestep the shared `VecEmbeddings` mirror
 * table's fixed dimension from other test files' fixtures -- see that
 * file's header for the full explanation. Every vision call is driven by a
 * stubbed `fetchImpl`; no real network call or filesystem read ever happens
 * in this suite (`loadInput`/`describeAsset.input` are always fixture-
 * injected).
 */
import { prisma } from '../../server/src/services/prisma';
import { addAssetToCollection } from '../../server/src/agent-mcp/catalogTools';
import {
  describeAsset,
  embedText,
  retryPendingDescriptions,
  registerDescriptionRetryJob,
} from '../../server/src/services/description';
import { SchedulerService } from '../../server/src/services/scheduler.service';
import {
  nearestNeighbors,
  keywordSearch,
  removeFromKeywordIndex,
  __resetCapabilityCacheForTests,
} from '../../server/src/services/search';
import type { VersioningRecorder } from '../../server/src/agent-mcp/fsTools';
import type { ClassifyAndDescribeInput } from '../../server/src/services/imaging';

const marker = `t004retry${Date.now()}`.replace(/[^a-zA-Z0-9]/g, '');
const originalForceVectorFallbackEnv = process.env.FORCE_VECTOR_FALLBACK;

let assetsDirId: number;
let assetsDirPath: string;

const cleanup = {
  embeddingIds: [] as number[],
  assetIds: [] as number[],
  collectionIds: [] as number[],
  workspaceDirectoryIds: [] as number[],
  scheduledJobIds: [] as number[],
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

function classificationResponse(json: Record<string, unknown>): Response {
  const body = {
    model: 'deepseek/deepseek-v4-pro',
    choices: [{ message: { role: 'assistant', content: JSON.stringify(json) } }],
  };
  return new Response(JSON.stringify(body), { status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json' } });
}

function failureResponse(status = 503): Response {
  return new Response(JSON.stringify({ error: { message: 'simulated vision-model outage' } }), {
    status,
    statusText: 'Error',
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeClassification(description: string, tags: string[]) {
  return {
    isPhotograph: true,
    isLogo: false,
    style: 'photograph',
    peopleReal: 'real',
    description,
    tags,
  };
}

const FIXTURE_INPUT: ClassifyAndDescribeInput = { imageBytes: Buffer.from('fake-image-bytes-for-test'), mimeType: 'image/png' };

/** A `loadInput` stub for `retryPendingDescriptions` that never touches the
 * filesystem -- every pending asset in this file gets the same fixture
 * bytes, since `classifyAndDescribe` is itself stubbed and never decodes
 * them anyway (mirrors `description-pipeline.test.ts`'s `FIXTURE_INPUT`). */
async function fixtureLoadInput(): Promise<ClassifyAndDescribeInput> {
  return FIXTURE_INPUT;
}

beforeAll(async () => {
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
  await prisma.scheduledJob.deleteMany({ where: { id: { in: cleanup.scheduledJobIds } } });
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

/** Creates a still-pending Asset via `addAssetToCollection`, simulating the
 * vision model being unavailable at commit time (UC-008 E4) -- the setup
 * condition every test in this file builds on (SUC-003's own AC1). */
async function makePendingAsset(pathSuffix: string, collectionName: string) {
  const fetchImpl = vi.fn().mockResolvedValue(failureResponse(503));
  const logger = { error: vi.fn() };
  const asset = await addAssetToCollection(
    { directoryId: assetsDirId, collectionName, path: `${marker}/assets/${pathSuffix}`, hash: `hash-${pathSuffix}` },
    {
      versioning: spyVersioning(),
      logger,
      describeAsset: { input: FIXTURE_INPUT, imagingOptions: { fetchImpl, openrouterApiKey: 'test-key' } },
    }
  );
  cleanup.assetIds.push(asset.id);
  cleanup.collectionIds.push(await collectionIdFor(collectionName));
  return { asset, logger };
}

// ---------------------------------------------------------------------------
// AC1: pending-asset setup, re-verified as this ticket's arrange step
// ---------------------------------------------------------------------------

describe('AC1: a simulated classifyAndDescribe failure leaves the Asset committed with no AssetDescription/Embedding', () => {
  it('commits the Asset but writes neither an AssetDescription nor an Embedding row', async () => {
    const { asset, logger } = await makePendingAsset('ac1-pending.png', `${marker}-ac1-collection`);

    expect(asset.id).toBeGreaterThan(0);
    expect(logger.error).toHaveBeenCalledTimes(1);

    const description = await prisma.assetDescription.findUnique({ where: { assetId: asset.id } });
    expect(description).toBeNull();
    const embeddings = await prisma.embedding.findMany({ where: { ownerType: 'asset', ownerId: asset.id } });
    expect(embeddings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC2: pending asset is findable by filename/path search while pending
// ---------------------------------------------------------------------------

describe('AC2: the pending asset is findable by filename/path search (UC-014 E3) while pending', () => {
  it('is returned by a direct Asset.path lookup even with no AssetDescription row', async () => {
    const { asset } = await makePendingAsset('ac2-findable.png', `${marker}-ac2-collection`);

    // No dedicated FTS5/browse index exists over Asset.path (Sprint 002
    // never indexed it -- indexAssetDescription only ever wrote description/
    // tags text). Filename/path lookup is a plain query against the Asset
    // row itself, which exists and is queryable from the moment
    // add_asset_to_collection commits it -- independent of whether its
    // description has been generated yet.
    const found = await prisma.asset.findFirst({ where: { path: `${marker}/assets/ac2-findable.png` } });
    expect(found).not.toBeNull();
    expect(found!.id).toBe(asset.id);

    // It is not yet keyword-searchable by description/tags -- that only
    // happens once the pipeline (or its retry) actually describes it.
    // (A hyphenated term is deliberately avoided here: FTS5's query syntax
    // treats a bare "-" specially, so a plain marker-derived token is used
    // instead of the hyphenated path/filename itself.)
    const results = keywordSearch(`${marker}ac2findable`, { ownerType: 'asset' });
    expect(results.some((r) => r.ownerId === asset.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC3 + AC4: retryPendingDescriptions direct invocation and idempotency
// ---------------------------------------------------------------------------

describe('AC3: retryPendingDescriptions, invoked directly, produces the same result as the happy path', () => {
  it('describes the previously-pending asset: AssetDescription, one Embedding, and an FTS5-searchable entry', async () => {
    const { asset } = await makePendingAsset('ac3-retry.png', `${marker}-ac3-collection`);
    const distinctiveTag = `${marker}ac3tag`;
    const fetchImpl = vi.fn().mockImplementation(async () => classificationResponse(makeClassification(`A photo for retry test ${distinctiveTag}`, ['robots', distinctiveTag])));

    const result = await retryPendingDescriptions({
      prismaClient: prisma,
      collectionId: asset.collectionId,
      loadInput: fixtureLoadInput,
      imagingOptions: { fetchImpl, openrouterApiKey: 'test-key' },
    });

    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const description = await prisma.assetDescription.findUnique({ where: { assetId: asset.id } });
    expect(description).not.toBeNull();
    expect(description!.description).toContain(distinctiveTag);

    const embeddings = await prisma.embedding.findMany({ where: { ownerType: 'asset', ownerId: asset.id } });
    cleanup.embeddingIds.push(...embeddings.map((e: { id: number }) => e.id));
    expect(embeddings).toHaveLength(1);

    const keywordResults = keywordSearch(distinctiveTag, { ownerType: 'asset' });
    expect(keywordResults.some((r) => r.ownerId === asset.id)).toBe(true);
  });
});

describe('AC4: retryPendingDescriptions is idempotent -- a described asset is never re-processed', () => {
  it('run twice in a row only calls classifyAndDescribe once for a given asset', async () => {
    const { asset } = await makePendingAsset('ac4-idempotent.png', `${marker}-ac4-collection`);
    const fetchImpl = vi.fn().mockImplementation(async () => classificationResponse(makeClassification('idempotency test description', ['idempotent'])));

    const first = await retryPendingDescriptions({
      prismaClient: prisma,
      collectionId: asset.collectionId,
      loadInput: fixtureLoadInput,
      imagingOptions: { fetchImpl, openrouterApiKey: 'test-key' },
    });
    expect(first.attempted).toBe(1);
    expect(first.succeeded).toBe(1);

    const embeddings = await prisma.embedding.findMany({ where: { ownerType: 'asset', ownerId: asset.id } });
    cleanup.embeddingIds.push(...embeddings.map((e: { id: number }) => e.id));

    const second = await retryPendingDescriptions({
      prismaClient: prisma,
      collectionId: asset.collectionId,
      loadInput: fixtureLoadInput,
      imagingOptions: { fetchImpl, openrouterApiKey: 'test-key' },
    });

    // The asset no longer matches the "pending" query -- the second pass
    // doesn't even see it, let alone re-call classifyAndDescribe.
    expect(second.attempted).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const stillOneEmbedding = await prisma.embedding.findMany({ where: { ownerType: 'asset', ownerId: asset.id } });
    expect(stillOneEmbedding).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC5: ScheduledJob registration
// ---------------------------------------------------------------------------

describe('AC5: a ScheduledJob row named description-retry is registered and invokes retryPendingDescriptions', () => {
  it('SchedulerService.seedDefaults() upserts a description-retry row with hourly frequency', async () => {
    const scheduler = new SchedulerService(prisma);
    await scheduler.seedDefaults();

    const job = await prisma.scheduledJob.findUnique({ where: { name: 'description-retry' } });
    expect(job).not.toBeNull();
    expect(job!.frequency).toBe('hourly');
    expect(job!.enabled).toBe(true);
    // seedDefaults also (re-)creates daily-backup/weekly-backup -- don't
    // clean those up (shared across the app/admin-scheduler tests), only
    // track description-retry's own row for this file's cleanup.
    cleanup.scheduledJobIds.push(job!.id);
  });

  it('registerDescriptionRetryJob wires a handler that actually describes a pending asset when run', async () => {
    const { asset } = await makePendingAsset('ac5-scheduled.png', `${marker}-ac5-collection`);
    const fetchImpl = vi.fn().mockImplementation(async () => classificationResponse(makeClassification('scheduled retry description', ['scheduled'])));

    const handlers = new Map<string, () => Promise<void>>();
    const stubScheduler = {
      registerHandler(name: string, handler: () => Promise<void>) {
        handlers.set(name, handler);
      },
    };

    // Scoped to this test's own Collection: an unscoped (global) retry pass
    // would also legitimately pick up any other still-pending Asset left
    // behind by earlier tests in this file (e.g. AC1/AC2's, which are
    // deliberately never retried) -- scoping keeps this test's assertions
    // about its own asset, not incidental side effects on theirs.
    registerDescriptionRetryJob(stubScheduler, {
      prismaClient: prisma,
      collectionId: asset.collectionId,
      loadInput: fixtureLoadInput,
      imagingOptions: { fetchImpl, openrouterApiKey: 'test-key' },
    });

    expect(handlers.has('description-retry')).toBe(true);

    await handlers.get('description-retry')!();

    const description = await prisma.assetDescription.findUnique({ where: { assetId: asset.id } });
    expect(description).not.toBeNull();
    const embeddings = await prisma.embedding.findMany({ where: { ownerType: 'asset', ownerId: asset.id } });
    cleanup.embeddingIds.push(...embeddings.map((e: { id: number }) => e.id));
  });
});

// ---------------------------------------------------------------------------
// AC6: opportunistic retry from addAssetToCollection
// ---------------------------------------------------------------------------

describe('AC6: committing a second asset triggers an opportunistic retry for a pending asset already in the collection', () => {
  it('describes the previously-pending asset as a side effect of the next commit into the same collection', async () => {
    const collectionName = `${marker}-ac6-collection`;
    const { asset: pendingAsset } = await makePendingAsset('ac6-first-pending.png', collectionName);

    const retryFetchImpl = vi.fn().mockImplementation(async () => classificationResponse(makeClassification('opportunistically retried description', ['opportunistic'])));
    const newAssetFetchImpl = vi
      .fn()
      .mockImplementation(async () => classificationResponse(makeClassification('newly committed asset description', ['newcommit'])));

    const secondAsset = await addAssetToCollection(
      { directoryId: assetsDirId, collectionName, path: `${marker}/assets/ac6-second.png`, hash: 'hash-ac6-second' },
      {
        versioning: spyVersioning(),
        describeAsset: { input: FIXTURE_INPUT, imagingOptions: { fetchImpl: newAssetFetchImpl, openrouterApiKey: 'test-key' } },
        retryPendingDescriptions: { loadInput: fixtureLoadInput, imagingOptions: { fetchImpl: retryFetchImpl, openrouterApiKey: 'test-key' } },
      }
    );
    cleanup.assetIds.push(secondAsset.id);

    // The newly committed asset got its own description via its own fetch stub.
    const secondDescription = await prisma.assetDescription.findUnique({ where: { assetId: secondAsset.id } });
    expect(secondDescription).not.toBeNull();
    const secondEmbeddings = await prisma.embedding.findMany({ where: { ownerType: 'asset', ownerId: secondAsset.id } });
    cleanup.embeddingIds.push(...secondEmbeddings.map((e: { id: number }) => e.id));

    // The opportunistic pass described the *other*, previously-pending asset.
    expect(retryFetchImpl).toHaveBeenCalledTimes(1);
    const pendingDescription = await prisma.assetDescription.findUnique({ where: { assetId: pendingAsset.id } });
    expect(pendingDescription).not.toBeNull();
    const pendingEmbeddings = await prisma.embedding.findMany({ where: { ownerType: 'asset', ownerId: pendingAsset.id } });
    cleanup.embeddingIds.push(...pendingEmbeddings.map((e: { id: number }) => e.id));
  });

  it('does not delay or fail the new commit when the opportunistic retry pass itself fails', async () => {
    const collectionName = `${marker}-ac6-failure-collection`;
    await makePendingAsset('ac6-failure-pending.png', collectionName);

    const newAssetFetchImpl = vi
      .fn()
      .mockImplementation(async () => classificationResponse(makeClassification('unaffected new commit', ['unaffected'])));
    const throwingLoadInput = vi.fn().mockRejectedValue(new Error('simulated retry-pass loadInput failure'));
    const logger = { error: vi.fn() };

    const secondAsset = await addAssetToCollection(
      { directoryId: assetsDirId, collectionName, path: `${marker}/assets/ac6-failure-second.png`, hash: 'hash-ac6-failure-second' },
      {
        versioning: spyVersioning(),
        logger,
        describeAsset: { input: FIXTURE_INPUT, imagingOptions: { fetchImpl: newAssetFetchImpl, openrouterApiKey: 'test-key' } },
        retryPendingDescriptions: { loadInput: throwingLoadInput },
      }
    );
    cleanup.assetIds.push(secondAsset.id);

    // The new commit still succeeded and still got its own description --
    // the opportunistic pass's per-asset failure never propagated out.
    expect(secondAsset.id).toBeGreaterThan(0);
    const secondDescription = await prisma.assetDescription.findUnique({ where: { assetId: secondAsset.id } });
    expect(secondDescription).not.toBeNull();
    const secondEmbeddings = await prisma.embedding.findMany({ where: { ownerType: 'asset', ownerId: secondAsset.id } });
    cleanup.embeddingIds.push(...secondEmbeddings.map((e: { id: number }) => e.id));
  });
});

// ---------------------------------------------------------------------------
// AC7 / SUC-004: end-to-end semantic search against pipeline-generated data
// ---------------------------------------------------------------------------

describe('AC7: semantic search finds a pipeline-generated description via both index paths, excluding a still-pending asset', () => {
  it('nearestNeighbors and keywordSearch both return the described asset; a separate pending asset is excluded from both', async () => {
    const describedCollection = `${marker}-ac7-described-collection`;
    const pendingCollection = `${marker}-ac7-pending-collection`;

    // The positive case: a pending asset described through the real retry
    // pipeline (describeAsset via classifyAndDescribe), never a hand-seeded
    // AssetDescription row -- satisfying SUC-004's "pipeline-generated" requirement.
    const { asset: robotsAsset } = await makePendingAsset('ac7-robots.png', describedCollection);
    const robotsClassification = makeClassification(
      'A bright photograph of students building small robots together at a workshop table.',
      ['robots', 'workshop', 'students']
    );
    const fetchImpl = vi.fn().mockImplementation(async () => classificationResponse(robotsClassification));
    await describeAsset(robotsAsset, { prismaClient: prisma, input: FIXTURE_INPUT, imagingOptions: { fetchImpl, openrouterApiKey: 'test-key' } });
    const robotsEmbeddings = await prisma.embedding.findMany({ where: { ownerType: 'asset', ownerId: robotsAsset.id } });
    cleanup.embeddingIds.push(...robotsEmbeddings.map((e: { id: number }) => e.id));

    // The negative case: a separate asset that is still pending -- no
    // AssetDescription/Embedding/keyword-index entry at all.
    const { asset: pendingAsset } = await makePendingAsset('ac7-still-pending.png', pendingCollection);

    // nearestNeighbors (vector path): a query embedding built the same way
    // the pipeline builds its own (embedText over description + tags text)
    // finds the described asset and never the still-pending one.
    const queryVector = embedText('a photo of robots at a workshop');
    const neighbors = await nearestNeighbors(queryVector, 5, { ownerType: 'asset' });
    expect(neighbors.some((n) => n.ownerId === robotsAsset.id)).toBe(true);
    expect(neighbors.some((n) => n.ownerId === pendingAsset.id)).toBe(false);

    // keywordSearch (FTS5 path): the literal term "robots" finds the
    // described asset and never the still-pending one.
    const keywordResults = keywordSearch('robots', { ownerType: 'asset' });
    expect(keywordResults.some((r) => r.ownerId === robotsAsset.id)).toBe(true);
    expect(keywordResults.some((r) => r.ownerId === pendingAsset.id)).toBe(false);
  });
});

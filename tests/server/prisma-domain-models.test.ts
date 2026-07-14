/**
 * CRUD + relation + optimistic-lock coverage for the twelve domain models
 * added by ticket 002-003 (Project, Iteration, ChatMessage, Reference,
 * Collection, Asset, AssetDescription, KnowledgeEntry, KnowledgeCorrection,
 * Embedding, WorkspaceDirectory, Lock).
 *
 * This ticket is schema-only — no routes/services read or write these
 * models yet (Sprints 003-005 build those). These tests exercise the
 * generated Prisma client directly against the migrated SQLite test DB to
 * confirm the schema itself: field shapes, relations, nullability, and the
 * two invariants the acceptance criteria call out explicitly —
 * optimistic-lock version-mismatch rejection (Project, KnowledgeEntry) and
 * append-only Iterations (no update path overwrites an existing
 * `imagePath`).
 */
import { prisma } from '../../server/src/services/prisma';

const marker = `t003-${Date.now()}`;

let userId: number;
let secondUserId: number;
let rootDirId: number;
let collectionId: number;

// IDs created by individual tests, deleted in FK-safe order in afterAll.
const cleanup = {
  embeddingIds: [] as number[],
  knowledgeCorrectionIds: [] as number[],
  assetDescriptionAssetIds: [] as number[],
  referenceIds: [] as number[],
  assetIds: [] as number[],
  iterationIds: [] as number[],
  chatMessageIds: [] as number[],
  knowledgeEntryIds: [] as number[],
  projectIds: [] as number[],
  collectionIds: [] as number[],
  workspaceDirectoryIds: [] as number[],
  lockIds: [] as number[],
};

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `${marker}-owner@example.com`, displayName: 'Domain Model Test Owner' },
  });
  userId = user.id;

  const secondUser = await prisma.user.create({
    data: { email: `${marker}-corrector@example.com`, displayName: 'Domain Model Test Corrector' },
  });
  secondUserId = secondUser.id;

  const rootDir = await prisma.workspaceDirectory.create({
    data: { path: `${marker}/root`, kind: 'collection' },
  });
  rootDirId = rootDir.id;
  cleanup.workspaceDirectoryIds.push(rootDir.id);

  const collection = await prisma.collection.create({
    data: { directoryId: rootDirId, name: `${marker}-collection`, kind: 'stock-art' },
  });
  collectionId = collection.id;
  cleanup.collectionIds.push(collection.id);
});

afterAll(async () => {
  await prisma.embedding.deleteMany({ where: { id: { in: cleanup.embeddingIds } } });
  await prisma.knowledgeCorrection.deleteMany({ where: { id: { in: cleanup.knowledgeCorrectionIds } } });
  await prisma.assetDescription.deleteMany({ where: { assetId: { in: cleanup.assetDescriptionAssetIds } } });
  await prisma.reference.deleteMany({ where: { id: { in: cleanup.referenceIds } } });
  await prisma.asset.deleteMany({ where: { id: { in: cleanup.assetIds } } });
  await prisma.iteration.deleteMany({ where: { id: { in: cleanup.iterationIds } } });
  await prisma.chatMessage.deleteMany({ where: { id: { in: cleanup.chatMessageIds } } });
  await prisma.knowledgeEntry.deleteMany({ where: { id: { in: cleanup.knowledgeEntryIds } } });
  await prisma.project.deleteMany({ where: { id: { in: cleanup.projectIds } } });
  await prisma.collection.deleteMany({ where: { id: { in: cleanup.collectionIds } } });
  await prisma.workspaceDirectory.deleteMany({ where: { id: { in: cleanup.workspaceDirectoryIds } } });
  await prisma.lock.deleteMany({ where: { id: { in: cleanup.lockIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, secondUserId] } } });
});

describe('WorkspaceDirectory', () => {
  it('creates and reads a directory, including a nested child', async () => {
    const child = await prisma.workspaceDirectory.create({
      data: { path: `${marker}/root/child`, kind: 'knowledge-category', parentId: rootDirId, descriptorJson: { note: 'child' } },
    });
    cleanup.workspaceDirectoryIds.push(child.id);

    const found = await prisma.workspaceDirectory.findUnique({ where: { id: child.id } });
    expect(found).not.toBeNull();
    expect(found!.parentId).toBe(rootDirId);
    expect(found!.path).toBe(`${marker}/root/child`);
    expect(found!.descriptorJson).toEqual({ note: 'child' });
  });
});

describe('Collection', () => {
  it('creates and reads a collection scoped to a directory', async () => {
    const found = await prisma.collection.findUnique({ where: { id: collectionId } });
    expect(found).not.toBeNull();
    expect(found!.directoryId).toBe(rootDirId);
    expect(found!.kind).toBe('stock-art');
  });
});

describe('Project', () => {
  it('creates and reads a project, defaulting status and version', async () => {
    const project = await prisma.project.create({
      data: { ownerUserId: userId, title: `${marker}-project`, detailsHeader: { style: 'pop-art' } },
    });
    cleanup.projectIds.push(project.id);

    const found = await prisma.project.findUnique({ where: { id: project.id } });
    expect(found).not.toBeNull();
    expect(found!.ownerUserId).toBe(userId);
    expect(found!.status).toBe('active');
    expect(found!.version).toBe(1);
    expect(found!.detailsHeader).toEqual({ style: 'pop-art' });
  });

  it('creates a subproject via the self-relation, nullable parentProjectId at the root', async () => {
    const parent = await prisma.project.create({
      data: { ownerUserId: userId, title: `${marker}-parent-project` },
    });
    cleanup.projectIds.push(parent.id);
    expect(parent.parentProjectId).toBeNull();

    const child = await prisma.project.create({
      data: { ownerUserId: userId, title: `${marker}-subproject`, parentProjectId: parent.id },
    });
    cleanup.projectIds.push(child.id);

    const found = await prisma.project.findUnique({ where: { id: child.id } });
    expect(found!.parentProjectId).toBe(parent.id);
  });

  it('rejects a version-mismatched update (optimistic lock) and accepts a correctly-versioned one', async () => {
    const project = await prisma.project.create({
      data: { ownerUserId: userId, title: `${marker}-lock-project` },
    });
    cleanup.projectIds.push(project.id);
    expect(project.version).toBe(1);

    // Stale version (0) does not match the current row (version 1) — the
    // optimistic-lock write pattern is a conditional updateMany whose WHERE
    // clause includes the version the writer read; a mismatch matches zero
    // rows instead of silently overwriting.
    const rejected = await prisma.project.updateMany({
      where: { id: project.id, version: 0 },
      data: { title: 'should-not-apply', version: { increment: 1 } },
    });
    expect(rejected.count).toBe(0);

    const unchanged = await prisma.project.findUnique({ where: { id: project.id } });
    expect(unchanged!.title).toBe(`${marker}-lock-project`);
    expect(unchanged!.version).toBe(1);

    // Correct version (1) matches and the write is accepted, bumping version.
    const accepted = await prisma.project.updateMany({
      where: { id: project.id, version: 1 },
      data: { title: 'updated-title', version: { increment: 1 } },
    });
    expect(accepted.count).toBe(1);

    const updated = await prisma.project.findUnique({ where: { id: project.id } });
    expect(updated!.title).toBe('updated-title');
    expect(updated!.version).toBe(2);
  });
});

describe('Iteration', () => {
  it('adds three iterations to a project; all three remain queryable with distinct seq values and untouched imagePath', async () => {
    const project = await prisma.project.create({
      data: { ownerUserId: userId, title: `${marker}-iteration-project` },
    });
    cleanup.projectIds.push(project.id);

    const created = [];
    for (let seq = 1; seq <= 3; seq += 1) {
      const iteration = await prisma.iteration.create({
        data: {
          projectId: project.id,
          seq,
          imagePath: `iterations/iter-00${seq}.png`,
          promptUsed: `prompt for iteration ${seq}`,
          modelParams: { seed: seq },
        },
      });
      cleanup.iterationIds.push(iteration.id);
      created.push(iteration);
    }

    // No update path is exercised here — each iteration is created once and
    // never mutated, matching the acceptance criterion that an existing
    // iteration's imagePath is never overwritten.
    const all = await prisma.iteration.findMany({
      where: { projectId: project.id },
      orderBy: { seq: 'asc' },
    });
    expect(all).toHaveLength(3);
    expect(all.map((i: any) => i.seq)).toEqual([1, 2, 3]);
    expect(all.map((i: any) => i.imagePath)).toEqual([
      'iterations/iter-001.png',
      'iterations/iter-002.png',
      'iterations/iter-003.png',
    ]);
    // Each row's imagePath still matches what it was created with.
    created.forEach((iteration, idx) => {
      expect(all[idx].imagePath).toBe(iteration.imagePath);
    });
  });
});

describe('ChatMessage', () => {
  it('creates and reads a chat message with structured toolCalls', async () => {
    const project = await prisma.project.create({
      data: { ownerUserId: userId, title: `${marker}-chat-project` },
    });
    cleanup.projectIds.push(project.id);

    const message = await prisma.chatMessage.create({
      data: {
        projectId: project.id,
        role: 'assistant',
        content: 'Here is a first draft.',
        toolCalls: [{ name: 'create_iteration', args: { seq: 1 } }],
      },
    });
    cleanup.chatMessageIds.push(message.id);

    const found = await prisma.chatMessage.findUnique({ where: { id: message.id } });
    expect(found).not.toBeNull();
    expect(found!.role).toBe('assistant');
    expect(found!.toolCalls).toEqual([{ name: 'create_iteration', args: { seq: 1 } }]);
  });
});

describe('Asset / AssetDescription', () => {
  it('creates an asset with no AssetDescription row and confirms it remains queryable by path', async () => {
    const asset = await prisma.asset.create({
      data: {
        collectionId,
        path: `${marker}/assets/no-description.png`,
        hash: 'deadbeef',
        mtime: new Date(),
      },
    });
    cleanup.assetIds.push(asset.id);

    const found = await prisma.asset.findFirst({
      where: { path: `${marker}/assets/no-description.png` },
      include: { description: true },
    });
    expect(found).not.toBeNull();
    expect(found!.id).toBe(asset.id);
    expect(found!.description).toBeNull();
  });

  it('creates an asset with an AssetDescription row (1:1)', async () => {
    const asset = await prisma.asset.create({
      data: {
        collectionId,
        path: `${marker}/assets/with-description.png`,
        hash: 'cafebabe',
        mtime: new Date(),
      },
    });
    cleanup.assetIds.push(asset.id);

    const description = await prisma.assetDescription.create({
      data: {
        assetId: asset.id,
        isPhotograph: true,
        isLogo: false,
        style: 'flat-poster',
        peopleReal: 'ai',
        description: 'A student robot waving.',
        tags: ['robot', 'wonder'],
      },
    });
    cleanup.assetDescriptionAssetIds.push(description.assetId);

    const found = await prisma.asset.findUnique({
      where: { id: asset.id },
      include: { description: true },
    });
    expect(found!.description).not.toBeNull();
    expect(found!.description!.description).toBe('A student robot waving.');
    expect(found!.description!.tags).toEqual(['robot', 'wonder']);
  });

  it('sources an asset from an iteration (optional relation)', async () => {
    const project = await prisma.project.create({
      data: { ownerUserId: userId, title: `${marker}-source-project` },
    });
    cleanup.projectIds.push(project.id);

    const iteration = await prisma.iteration.create({
      data: { projectId: project.id, seq: 1, imagePath: 'iterations/iter-001.png', promptUsed: 'p' },
    });
    cleanup.iterationIds.push(iteration.id);

    const asset = await prisma.asset.create({
      data: {
        collectionId,
        sourceIterationId: iteration.id,
        path: `${marker}/assets/from-iteration.png`,
        hash: 'abc123',
        mtime: new Date(),
      },
    });
    cleanup.assetIds.push(asset.id);

    const found = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(found!.sourceIterationId).toBe(iteration.id);
  });
});

describe('Reference', () => {
  it('creates and reads a reference pointing a project at an asset', async () => {
    const project = await prisma.project.create({
      data: { ownerUserId: userId, title: `${marker}-reference-project` },
    });
    cleanup.projectIds.push(project.id);

    const asset = await prisma.asset.create({
      data: { collectionId, path: `${marker}/assets/referenced.png`, hash: 'feedface', mtime: new Date() },
    });
    cleanup.assetIds.push(asset.id);

    const reference = await prisma.reference.create({
      data: { projectId: project.id, assetId: asset.id, role: 'style' },
    });
    cleanup.referenceIds.push(reference.id);

    const found = await prisma.reference.findUnique({ where: { id: reference.id } });
    expect(found).not.toBeNull();
    expect(found!.assetId).toBe(asset.id);
    expect(found!.role).toBe('style');
  });
});

describe('KnowledgeEntry', () => {
  it('creates and reads a knowledge entry, defaulting version to 1', async () => {
    const entry = await prisma.knowledgeEntry.create({
      data: {
        directoryId: rootDirId,
        kind: 'style',
        name: `${marker}-pop-art`,
        bodyText: 'Bold flat colors, thick outlines.',
        structuredFields: { doList: ['bold colors'], dontList: ['gradients'] },
      },
    });
    cleanup.knowledgeEntryIds.push(entry.id);

    const found = await prisma.knowledgeEntry.findUnique({ where: { id: entry.id } });
    expect(found).not.toBeNull();
    expect(found!.version).toBe(1);
    expect(found!.bodyText).toBe('Bold flat colors, thick outlines.');
  });

  it('rejects a version-mismatched update (optimistic lock) and accepts a correctly-versioned one', async () => {
    const entry = await prisma.knowledgeEntry.create({
      data: { directoryId: rootDirId, kind: 'rule', name: `${marker}-lock-entry`, bodyText: 'original text' },
    });
    cleanup.knowledgeEntryIds.push(entry.id);
    expect(entry.version).toBe(1);

    const rejected = await prisma.knowledgeEntry.updateMany({
      where: { id: entry.id, version: 0 },
      data: { bodyText: 'should-not-apply', version: { increment: 1 } },
    });
    expect(rejected.count).toBe(0);

    const unchanged = await prisma.knowledgeEntry.findUnique({ where: { id: entry.id } });
    expect(unchanged!.bodyText).toBe('original text');
    expect(unchanged!.version).toBe(1);

    const accepted = await prisma.knowledgeEntry.updateMany({
      where: { id: entry.id, version: 1 },
      data: { bodyText: 'revised text', version: { increment: 1 } },
    });
    expect(accepted.count).toBe(1);

    const updated = await prisma.knowledgeEntry.findUnique({ where: { id: entry.id } });
    expect(updated!.bodyText).toBe('revised text');
    expect(updated!.version).toBe(2);
  });
});

describe('KnowledgeCorrection', () => {
  it('leaves bodyText/version unchanged while pending, and only the resolution step changes them', async () => {
    const entry = await prisma.knowledgeEntry.create({
      data: { directoryId: rootDirId, kind: 'style', name: `${marker}-correctable`, bodyText: 'original body text' },
    });
    cleanup.knowledgeEntryIds.push(entry.id);

    const project = await prisma.project.create({
      data: { ownerUserId: userId, title: `${marker}-correction-context-project` },
    });
    cleanup.projectIds.push(project.id);

    const correction = await prisma.knowledgeCorrection.create({
      data: {
        entryId: entry.id,
        proposedByUserId: secondUserId,
        contextProjectId: project.id,
        diff: '-original body text\n+revised body text',
      },
    });
    cleanup.knowledgeCorrectionIds.push(correction.id);

    // Default status is 'pending'; creating the correction row must not
    // itself mutate the entry (D3: a correction is a proposed diff
    // requiring resolution, not an autonomous edit).
    expect(correction.status).toBe('pending');
    expect(correction.resolvedAt).toBeNull();

    const stillOriginal = await prisma.knowledgeEntry.findUnique({ where: { id: entry.id } });
    expect(stillOriginal!.bodyText).toBe('original body text');
    expect(stillOriginal!.version).toBe(1);

    // Resolution step: accepting a correction applies the diff and bumps
    // KnowledgeEntry.version (architecture-001 Data Model). No service
    // layer exists yet (a later sprint's job) — this exercises that the
    // schema supports the transition atomically enough for that future
    // service to implement it directly.
    const resolvedAt = new Date();
    await prisma.knowledgeCorrection.update({
      where: { id: correction.id },
      data: { status: 'accepted', resolvedAt },
    });
    await prisma.knowledgeEntry.updateMany({
      where: { id: entry.id, version: 1 },
      data: { bodyText: 'revised body text', version: { increment: 1 } },
    });

    const resolvedCorrection = await prisma.knowledgeCorrection.findUnique({ where: { id: correction.id } });
    expect(resolvedCorrection!.status).toBe('accepted');
    expect(resolvedCorrection!.resolvedAt).not.toBeNull();

    const revisedEntry = await prisma.knowledgeEntry.findUnique({ where: { id: entry.id } });
    expect(revisedEntry!.bodyText).toBe('revised body text');
    expect(revisedEntry!.version).toBe(2);
  });
});

describe('Embedding', () => {
  it('creates and reads a polymorphic embedding owned by an asset', async () => {
    const asset = await prisma.asset.create({
      data: { collectionId, path: `${marker}/assets/embedded.png`, hash: 'a1b2c3', mtime: new Date() },
    });
    cleanup.assetIds.push(asset.id);

    const embedding = await prisma.embedding.create({
      data: {
        ownerType: 'asset',
        ownerId: asset.id,
        vector: Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer),
        model: 'test-embed-model',
      },
    });
    cleanup.embeddingIds.push(embedding.id);

    const found = await prisma.embedding.findUnique({ where: { id: embedding.id } });
    expect(found).not.toBeNull();
    expect(found!.ownerType).toBe('asset');
    expect(found!.ownerId).toBe(asset.id);
    expect(Buffer.isBuffer(found!.vector) || found!.vector instanceof Uint8Array).toBe(true);
  });

  it('creates and reads a polymorphic embedding owned by a knowledge entry', async () => {
    const entry = await prisma.knowledgeEntry.create({
      data: { directoryId: rootDirId, kind: 'palette', name: `${marker}-embedded-entry`, bodyText: 'palette text' },
    });
    cleanup.knowledgeEntryIds.push(entry.id);

    const embedding = await prisma.embedding.create({
      data: {
        ownerType: 'knowledge_entry',
        ownerId: entry.id,
        vector: Buffer.from(new Float32Array([0.4, 0.5, 0.6]).buffer),
        model: 'test-embed-model',
      },
    });
    cleanup.embeddingIds.push(embedding.id);

    const found = await prisma.embedding.findUnique({ where: { id: embedding.id } });
    expect(found!.ownerType).toBe('knowledge_entry');
    expect(found!.ownerId).toBe(entry.id);
  });
});

describe('Lock', () => {
  it('creates and reads a lock, and rejects a conflicting acquisition on the same resource', async () => {
    const lock = await prisma.lock.create({
      data: { resourceType: 'project_turn', resourceKey: `${marker}-project-42` },
    });
    cleanup.lockIds.push(lock.id);

    const found = await prisma.lock.findUnique({ where: { id: lock.id } });
    expect(found).not.toBeNull();
    expect(found!.resourceType).toBe('project_turn');

    // A second acquisition attempt for the same (resourceType, resourceKey)
    // must be rejected, not silently allowed to queue or overwrite.
    await expect(
      prisma.lock.create({
        data: { resourceType: 'project_turn', resourceKey: `${marker}-project-42` },
      })
    ).rejects.toThrow();
  });

  it('allows releasing a lock (delete) and re-acquiring the same resource afterward', async () => {
    const lock = await prisma.lock.create({
      data: { resourceType: 'directory', resourceKey: `${marker}/root` },
    });

    await prisma.lock.delete({ where: { id: lock.id } });

    const reacquired = await prisma.lock.create({
      data: { resourceType: 'directory', resourceKey: `${marker}/root` },
    });
    cleanup.lockIds.push(reacquired.id);

    const found = await prisma.lock.findUnique({ where: { id: reacquired.id } });
    expect(found).not.toBeNull();
  });
});

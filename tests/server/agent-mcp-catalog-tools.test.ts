/**
 * Coverage for the Workspace MCP Server's catalog tool family (ticket
 * 003-003): `create_knowledge_entry`, `propose_correction`,
 * `resolve_correction`, `add_asset_to_collection`, `create_project`,
 * `create_iteration`, `create_agent_page` -- optimistic-lock
 * reject-and-surface (R3), the propose/resolve-correction split (D3) that
 * keeps `bodyText` untouched until a correction is explicitly accepted,
 * the shared `Lock` acquire/release helper (`locks.ts`), and the hand-off
 * to the Versioning Service's `recordChange` after a successful write.
 *
 * All filesystem assertions (`create_agent_page`) run against a scratch
 * `WORKSPACE_DIR` (a per-run temp directory), never the real
 * `server/workspace/` tree. All DB assertions run against the real test
 * database, cleaned up in `afterAll`.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { prisma } from '../../server/src/services/prisma';
import { resolveWorkspacePath } from '../../server/src/services/workspaceDirectorySync';
import {
  createKnowledgeEntry,
  proposeCorrection,
  resolveCorrection,
  addAssetToCollection,
  createProject,
  createIteration,
  createAgentPage,
  addReference,
  removeReference,
  setIterationState,
  searchCatalog,
  registerCatalogTools,
  VersionConflictError,
} from '../../server/src/agent-mcp/catalogTools';
import { createWorkspaceMcpServer } from '../../server/src/agent-mcp/server';
import { acquireLock, releaseLock, LockConflictError } from '../../server/src/agent-mcp/locks';
import {
  indexAssetDescription,
  indexKnowledgeEntry,
  removeFromKeywordIndex,
  __resetCapabilityCacheForTests,
} from '../../server/src/services/search';
import { embedText, EMBEDDING_MODEL } from '../../server/src/services/description';
import type { VersioningRecorder } from '../../server/src/agent-mcp/fsTools';

const marker = `t003cat${Date.now()}`;

let testRoot: string;
let previousWorkspaceDir: string | undefined;

let ownerId: number;
let secondUserId: number;
let knowledgeDirId: number;
let knowledgeDirPath: string;
let assetsDirId: number;
let assetsDirPath: string;

const cleanup = {
  embeddingIds: [] as number[],
  knowledgeCorrectionIds: [] as number[],
  referenceIds: [] as number[],
  assetIds: [] as number[],
  iterationIds: [] as number[],
  knowledgeEntryIds: [] as number[],
  projectIds: [] as number[],
  collectionIds: [] as number[],
  workspaceDirectoryIds: [] as number[],
};

/** A `VersioningRecorder` spy: records every path passed to
 * `recordChange` without touching git or the real singleton. */
function spyVersioning(): VersioningRecorder & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    recordChange(p: string) {
      calls.push(p);
    },
  };
}

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'flyerbot-agent-mcp-catalog-test-'));
  previousWorkspaceDir = process.env.WORKSPACE_DIR;
  process.env.WORKSPACE_DIR = testRoot;

  const owner = await prisma.user.create({
    data: { email: `${marker}-owner@example.com`, displayName: 'Catalog Test Owner' },
  });
  ownerId = owner.id;

  const secondUser = await prisma.user.create({
    data: { email: `${marker}-corrector@example.com`, displayName: 'Catalog Test Corrector' },
  });
  secondUserId = secondUser.id;

  const knowledgeDir = await prisma.workspaceDirectory.create({
    data: { path: `${marker}/knowledge`, kind: 'knowledge-category' },
  });
  knowledgeDirId = knowledgeDir.id;
  knowledgeDirPath = knowledgeDir.path;
  cleanup.workspaceDirectoryIds.push(knowledgeDir.id);

  const assetsDir = await prisma.workspaceDirectory.create({
    data: { path: `${marker}/assets`, kind: 'collection' },
  });
  assetsDirId = assetsDir.id;
  assetsDirPath = assetsDir.path;
  cleanup.workspaceDirectoryIds.push(assetsDir.id);
});

afterAll(async () => {
  await prisma.embedding.deleteMany({ where: { id: { in: cleanup.embeddingIds } } });
  await prisma.knowledgeCorrection.deleteMany({ where: { id: { in: cleanup.knowledgeCorrectionIds } } });
  await prisma.reference.deleteMany({ where: { id: { in: cleanup.referenceIds } } });
  await prisma.assetDescription.deleteMany({ where: { assetId: { in: cleanup.assetIds } } });
  await prisma.asset.deleteMany({ where: { id: { in: cleanup.assetIds } } });
  await prisma.iteration.deleteMany({ where: { id: { in: cleanup.iterationIds } } });
  await prisma.knowledgeEntry.deleteMany({ where: { id: { in: cleanup.knowledgeEntryIds } } });
  // Clear self-relation FKs first -- a parent/child pair created in this
  // file's tests could otherwise have the parent row deleted (by id order)
  // while a child row still references it via parentProjectId.
  await prisma.project.updateMany({ where: { id: { in: cleanup.projectIds } }, data: { parentProjectId: null } });
  await prisma.project.deleteMany({ where: { id: { in: cleanup.projectIds } } });
  await prisma.collection.deleteMany({ where: { id: { in: cleanup.collectionIds } } });
  await prisma.workspaceDirectory.deleteMany({ where: { id: { in: cleanup.workspaceDirectoryIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, secondUserId] } } });

  if (previousWorkspaceDir === undefined) {
    delete process.env.WORKSPACE_DIR;
  } else {
    process.env.WORKSPACE_DIR = previousWorkspaceDir;
  }
  await fs.rm(testRoot, { recursive: true, force: true });
});

afterEach(async () => {
  // Belt-and-braces: no test in this file should leave a Lock row behind.
  await prisma.lock.deleteMany({ where: { resourceType: 'directory' } });
});

async function makeEntry(name: string, bodyText: string) {
  const entry = await createKnowledgeEntry(
    { directoryId: knowledgeDirId, kind: 'style', name, bodyText },
    { versioning: spyVersioning() }
  );
  cleanup.knowledgeEntryIds.push(entry.id);
  return entry;
}

async function makeProject(title: string) {
  const project = await createProject(
    { title, ownerUserId: ownerId },
    { versioning: spyVersioning() }
  );
  cleanup.projectIds.push(project.id);
  return project;
}

describe('registerCatalogTools / createWorkspaceMcpServer -- tool surface', () => {
  it('registers exactly the eleven catalog tools (seven from ticket 003 + four from ticket 005-002) alongside the four fs tools -- no other tools', async () => {
    const server = createWorkspaceMcpServer();
    const names = Object.keys((server as any)._registeredTools ?? {}).sort();
    expect(names).toEqual(
      [
        'add_asset_to_collection',
        'create_agent_page',
        'create_directory',
        'create_iteration',
        'create_knowledge_entry',
        'create_project',
        'move_file',
        'propose_correction',
        'read_file',
        'resolve_correction',
        'stat',
        'add_reference',
        'remove_reference',
        'set_iteration_state',
        'search_catalog',
      ].sort()
    );
  });

  it('a fresh McpServer instance passed directly to registerCatalogTools only gets the catalog tools', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const server = new McpServer({ name: 'test-catalog-only', version: '0.1.0' });
    registerCatalogTools(server);
    const names = Object.keys((server as any)._registeredTools ?? {}).sort();
    expect(names).toEqual(
      [
        'add_asset_to_collection',
        'create_agent_page',
        'create_iteration',
        'create_knowledge_entry',
        'create_project',
        'propose_correction',
        'resolve_correction',
        'add_reference',
        'remove_reference',
        'set_iteration_state',
        'search_catalog',
      ].sort()
    );
  });
});

describe('create_knowledge_entry', () => {
  it('creates a KnowledgeEntry row under a WorkspaceDirectory, defaulting version to 1', async () => {
    const versioning = spyVersioning();
    const entry = await createKnowledgeEntry(
      { directoryId: knowledgeDirId, kind: 'palette', name: `${marker}-create`, bodyText: 'warm autumn tones' },
      { versioning }
    );
    cleanup.knowledgeEntryIds.push(entry.id);

    expect(entry.version).toBe(1);
    expect(entry.bodyText).toBe('warm autumn tones');
    expect(versioning.calls).toHaveLength(1);
  });

  it('acquires and releases a Lock row around the create', async () => {
    const entry = await createKnowledgeEntry(
      { directoryId: knowledgeDirId, kind: 'rule', name: `${marker}-lockcheck`, bodyText: 'x' },
      { versioning: spyVersioning() }
    );
    cleanup.knowledgeEntryIds.push(entry.id);

    const count = await prisma.lock.count({ where: { resourceType: 'directory', resourceKey: knowledgeDirPath } });
    expect(count).toBe(0); // released after completion
  });

  it('rejects a second call for the same directory resourceKey while a lock is held', async () => {
    await acquireLock('directory', knowledgeDirPath, 'first-caller');
    try {
      await expect(
        createKnowledgeEntry(
          { directoryId: knowledgeDirId, kind: 'rule', name: `${marker}-contended`, bodyText: 'x' },
          { versioning: spyVersioning() }
        )
      ).rejects.toThrow(LockConflictError);
    } finally {
      await releaseLock('directory', knowledgeDirPath);
    }
  });

  it('updates an existing entry\'s metadata (id + version) without touching bodyText', async () => {
    const entry = await makeEntry(`${marker}-update-target`, 'original body text');

    const updated = await createKnowledgeEntry(
      { id: entry.id, version: entry.version, name: `${marker}-renamed`, structuredFields: { note: 'renamed' } },
      { versioning: spyVersioning() }
    );

    expect(updated.name).toBe(`${marker}-renamed`);
    expect(updated.bodyText).toBe('original body text'); // untouched
    expect(updated.version).toBe(entry.version + 1);
  });

  it('rejects bodyText on the update path', async () => {
    const entry = await makeEntry(`${marker}-no-direct-bodytext`, 'original');
    await expect(
      createKnowledgeEntry(
        { id: entry.id, version: entry.version, bodyText: 'should not be allowed' },
        { versioning: spyVersioning() }
      )
    ).rejects.toThrow(/bodyText/);
  });

  it('rejects an update carrying a stale version, not silently overwriting (R3)', async () => {
    const entry = await makeEntry(`${marker}-stale-entry`, 'original');

    await expect(
      createKnowledgeEntry(
        { id: entry.id, version: -1, name: 'should-not-apply' }, // -1 never matches a real version
        { versioning: spyVersioning() }
      )
    ).rejects.toThrow(VersionConflictError);

    const unchanged = await prisma.knowledgeEntry.findUnique({ where: { id: entry.id } });
    expect(unchanged!.name).toBe(`${marker}-stale-entry`);
    expect(unchanged!.version).toBe(entry.version);
  });
});

describe('create_project', () => {
  it('creates a Project row, optionally a subproject via parentProjectId', async () => {
    const parent = await makeProject(`${marker}-parent`);
    expect(parent.parentProjectId).toBeNull();

    const child = await createProject(
      { title: `${marker}-child`, ownerUserId: ownerId, parentProjectId: parent.id },
      { versioning: spyVersioning() }
    );
    cleanup.projectIds.push(child.id);

    expect(child.parentProjectId).toBe(parent.id);
    expect(child.version).toBe(1);
  });

  it('acquires and releases a Lock row around the create, keyed by projects/<id>', async () => {
    const project = await makeProject(`${marker}-lockcheck-project`);
    const count = await prisma.lock.count({
      where: { resourceType: 'directory', resourceKey: `projects/${project.id}` },
    });
    expect(count).toBe(0); // released after completion
  });

  it('updates an existing project\'s metadata (id + version)', async () => {
    const project = await makeProject(`${marker}-update-target-project`);

    const updated = await createProject(
      { id: project.id, version: project.version, status: 'archived' },
      { versioning: spyVersioning() }
    );

    expect(updated.status).toBe('archived');
    expect(updated.version).toBe(project.version + 1);
  });

  it('rejects an update carrying a stale version, not silently overwriting (R3)', async () => {
    const project = await makeProject(`${marker}-stale-project`);

    await expect(
      createProject({ id: project.id, version: -1, title: 'should-not-apply' }, { versioning: spyVersioning() })
    ).rejects.toThrow(VersionConflictError);

    const unchanged = await prisma.project.findUnique({ where: { id: project.id } });
    expect(unchanged!.title).toBe(`${marker}-stale-project`);
    expect(unchanged!.version).toBe(project.version);
  });
});

describe('propose_correction / resolve_correction', () => {
  it('propose_correction leaves bodyText/version unchanged; a read after proposing shows the original entry', async () => {
    const entry = await makeEntry(`${marker}-proposable`, 'original body text');

    const correction = await proposeCorrection(
      { entryId: entry.id, proposedBodyText: 'revised body text', proposedByUserId: secondUserId },
      { versioning: spyVersioning() }
    );
    cleanup.knowledgeCorrectionIds.push(correction.id);

    expect(correction.status).toBe('pending');
    expect(correction.diff).toContain('original body text');
    expect(correction.diff).toContain('revised body text');

    const stillOriginal = await prisma.knowledgeEntry.findUnique({ where: { id: entry.id } });
    expect(stillOriginal!.bodyText).toBe('original body text');
    expect(stillOriginal!.version).toBe(entry.version);
  });

  it('resolve_correction (accept) applies the diff, bumping version by exactly 1', async () => {
    const entry = await makeEntry(`${marker}-accept-target`, 'original body text');
    const correction = await proposeCorrection(
      { entryId: entry.id, proposedBodyText: 'revised body text', proposedByUserId: secondUserId },
      { versioning: spyVersioning() }
    );
    cleanup.knowledgeCorrectionIds.push(correction.id);

    const resolved = await resolveCorrection({ correctionId: correction.id, action: 'accept' }, { versioning: spyVersioning() });

    expect(resolved.status).toBe('accepted');
    expect(resolved.resolvedAt).not.toBeNull();

    const updatedEntry = await prisma.knowledgeEntry.findUnique({ where: { id: entry.id } });
    expect(updatedEntry!.bodyText).toBe('revised body text');
    expect(updatedEntry!.version).toBe(entry.version + 1);
  });

  it('resolve_correction (reject) changes only status/resolvedAt -- bodyText/version untouched', async () => {
    const entry = await makeEntry(`${marker}-reject-target`, 'original body text');
    const correction = await proposeCorrection(
      { entryId: entry.id, proposedBodyText: 'a rejected revision', proposedByUserId: secondUserId },
      { versioning: spyVersioning() }
    );
    cleanup.knowledgeCorrectionIds.push(correction.id);

    const resolved = await resolveCorrection({ correctionId: correction.id, action: 'reject' }, { versioning: spyVersioning() });

    expect(resolved.status).toBe('rejected');
    expect(resolved.resolvedAt).not.toBeNull();

    const untouchedEntry = await prisma.knowledgeEntry.findUnique({ where: { id: entry.id } });
    expect(untouchedEntry!.bodyText).toBe('original body text');
    expect(untouchedEntry!.version).toBe(entry.version);
  });

  it('rejects resolving an already-resolved correction', async () => {
    const entry = await makeEntry(`${marker}-double-resolve`, 'body');
    const correction = await proposeCorrection(
      { entryId: entry.id, proposedBodyText: 'revised', proposedByUserId: secondUserId },
      { versioning: spyVersioning() }
    );
    cleanup.knowledgeCorrectionIds.push(correction.id);

    await resolveCorrection({ correctionId: correction.id, action: 'accept' }, { versioning: spyVersioning() });
    await expect(
      resolveCorrection({ correctionId: correction.id, action: 'reject' }, { versioning: spyVersioning() })
    ).rejects.toThrow(/already/);
  });

  it('acquires and releases a Lock row around propose_correction and resolve_correction', async () => {
    const entry = await makeEntry(`${marker}-lockcheck-correction`, 'body');
    const correction = await proposeCorrection(
      { entryId: entry.id, proposedBodyText: 'revised', proposedByUserId: secondUserId },
      { versioning: spyVersioning() }
    );
    cleanup.knowledgeCorrectionIds.push(correction.id);
    await resolveCorrection({ correctionId: correction.id, action: 'accept' }, { versioning: spyVersioning() });

    const count = await prisma.lock.count({ where: { resourceType: 'directory', resourceKey: knowledgeDirPath } });
    expect(count).toBe(0); // released after completion
  });
});

describe('add_asset_to_collection', () => {
  it('creates an Asset row under a named Collection, auto-creating the Collection when missing', async () => {
    const collectionName = `${marker}-new-collection`;
    const before = await prisma.collection.findFirst({ where: { directoryId: assetsDirId, name: collectionName } });
    expect(before).toBeNull();

    const versioning = spyVersioning();
    const asset = await addAssetToCollection(
      { directoryId: assetsDirId, collectionName, path: `${marker}/assets/one.png`, hash: 'abc123' },
      { versioning }
    );
    cleanup.assetIds.push(asset.id);

    const collection = await prisma.collection.findFirst({ where: { directoryId: assetsDirId, name: collectionName } });
    expect(collection).not.toBeNull();
    cleanup.collectionIds.push(collection!.id);
    expect(asset.collectionId).toBe(collection!.id);
    expect(collection!.kind).toBe('stock-art'); // documented default
    expect(versioning.calls).toHaveLength(1);
  });

  it('reuses an existing Collection with the same name rather than creating a duplicate', async () => {
    const collectionName = `${marker}-reused-collection`;
    const first = await addAssetToCollection(
      { directoryId: assetsDirId, collectionName, path: `${marker}/assets/two.png`, hash: 'hash-two' },
      { versioning: spyVersioning() }
    );
    cleanup.assetIds.push(first.id);

    const second = await addAssetToCollection(
      { directoryId: assetsDirId, collectionName, path: `${marker}/assets/three.png`, hash: 'hash-three' },
      { versioning: spyVersioning() }
    );
    cleanup.assetIds.push(second.id);

    expect(second.collectionId).toBe(first.collectionId);
    cleanup.collectionIds.push(first.collectionId);

    const matchingCollections = await prisma.collection.findMany({
      where: { directoryId: assetsDirId, name: collectionName },
    });
    expect(matchingCollections).toHaveLength(1);
  });

  it('acquires and releases a Lock row around the write', async () => {
    const asset = await addAssetToCollection(
      { directoryId: assetsDirId, collectionName: `${marker}-lockcheck-collection`, path: `${marker}/assets/four.png`, hash: 'h4' },
      { versioning: spyVersioning() }
    );
    cleanup.assetIds.push(asset.id);
    cleanup.collectionIds.push(asset.collectionId);

    const count = await prisma.lock.count({ where: { resourceType: 'directory', resourceKey: assetsDirPath } });
    expect(count).toBe(0); // released after completion
  });
});

describe('create_iteration', () => {
  it('creates an Iteration row under a Project with an auto-incrementing seq', async () => {
    const project = await makeProject(`${marker}-iteration-project`);

    const first = await createIteration(
      { projectId: project.id, imagePath: 'iterations/iter-001.png', promptUsed: 'first prompt' },
      { versioning: spyVersioning() }
    );
    cleanup.iterationIds.push(first.id);
    expect(first.seq).toBe(1);

    const second = await createIteration(
      { projectId: project.id, imagePath: 'iterations/iter-002.png', promptUsed: 'second prompt' },
      { versioning: spyVersioning() }
    );
    cleanup.iterationIds.push(second.id);
    expect(second.seq).toBe(2);

    // Never overwrites the first iteration's imagePath (insert-only, SUC-001 parity).
    const stillFirst = await prisma.iteration.findUnique({ where: { id: first.id } });
    expect(stillFirst!.imagePath).toBe('iterations/iter-001.png');

    const all = await prisma.iteration.findMany({ where: { projectId: project.id }, orderBy: { seq: 'asc' } });
    expect(all.map((i: any) => i.imagePath)).toEqual(['iterations/iter-001.png', 'iterations/iter-002.png']);
  });

  it('acquires and releases a Lock row around the create', async () => {
    const project = await makeProject(`${marker}-iteration-lock-project`);
    const iteration = await createIteration(
      { projectId: project.id, imagePath: 'iterations/iter-001.png', promptUsed: 'p' },
      { versioning: spyVersioning() }
    );
    cleanup.iterationIds.push(iteration.id);

    const count = await prisma.lock.count({
      where: { resourceType: 'directory', resourceKey: `projects/${project.id}` },
    });
    expect(count).toBe(0); // released after completion
  });
});

describe('create_agent_page', () => {
  it('writes the page file under projects/<id>/outputs/ and records a minimal Iteration row', async () => {
    const project = await makeProject(`${marker}-agent-page-project`);
    const versioning = spyVersioning();

    const result = await createAgentPage(
      { projectId: project.id, filename: 'postcard.html', content: '<html>hello</html>', contentType: 'text/html' },
      { versioning }
    );
    cleanup.iterationIds.push(result.iteration.id);

    expect(result.path).toBe(`projects/${project.id}/outputs/postcard.html`);
    const written = await fs.readFile(resolveWorkspacePath(result.path), 'utf8');
    expect(written).toBe('<html>hello</html>');

    expect(result.iteration.imagePath).toBe(result.path);
    expect(result.iteration.promptUsed).toBe('agent-page:postcard.html');
    expect(result.iteration.modelParams).toMatchObject({ kind: 'agent-page', filename: 'postcard.html' });
    expect(versioning.calls).toHaveLength(1);
  });

  it('rejects a filename that would escape the workspace root, before any file write (reuses ticket 002 containment)', async () => {
    const project = await makeProject(`${marker}-agent-page-escape-project`);

    await expect(
      createAgentPage(
        // projects/<id>/outputs/ is 3 levels below the workspace root --
        // 4 levels of ../ is needed to actually escape it.
        { projectId: project.id, filename: '../../../../escape.html', content: 'x' },
        { versioning: spyVersioning() }
      )
    ).rejects.toThrow(/escapes workspace root/);
  });

  it('acquires and releases a Lock row around the write', async () => {
    const project = await makeProject(`${marker}-agent-page-lock-project`);
    const result = await createAgentPage(
      { projectId: project.id, filename: 'page.html', content: 'x' },
      { versioning: spyVersioning() }
    );
    cleanup.iterationIds.push(result.iteration.id);

    const count = await prisma.lock.count({
      where: { resourceType: 'directory', resourceKey: `projects/${project.id}/outputs/page.html` },
    });
    expect(count).toBe(0); // released after completion
  });
});

// ---------------------------------------------------------------------------
// Ticket 005-002: add_reference / remove_reference / set_iteration_state /
// search_catalog.
// ---------------------------------------------------------------------------

describe('add_reference / remove_reference', () => {
  async function makeAsset(pathSuffix: string) {
    const asset = await addAssetToCollection(
      {
        directoryId: assetsDirId,
        collectionName: `${marker}-ref-collection`,
        path: `${marker}/assets/${pathSuffix}`,
        hash: `hash-${pathSuffix}`,
      },
      { versioning: spyVersioning() }
    );
    cleanup.assetIds.push(asset.id);
    cleanup.collectionIds.push(asset.collectionId);
    return asset;
  }

  it('creates a Reference row scoped to a project with a documented role value', async () => {
    const project = await makeProject(`${marker}-ref-project`);
    const asset = await makeAsset('ref-one.png');
    const versioning = spyVersioning();

    const reference = await addReference({ projectId: project.id, assetId: asset.id, role: 'style' }, { versioning });
    cleanup.referenceIds.push(reference.id);

    expect(reference.projectId).toBe(project.id);
    expect(reference.assetId).toBe(asset.id);
    expect(reference.role).toBe('style');
    expect(versioning.calls).toHaveLength(1);

    const persisted = await prisma.reference.findUnique({ where: { id: reference.id } });
    expect(persisted).not.toBeNull();
    expect(persisted!.role).toBe('style');
  });

  it('accepts each documented role value (style | composition | template)', async () => {
    const project = await makeProject(`${marker}-ref-roles-project`);

    for (const role of ['style', 'composition', 'template'] as const) {
      const asset = await makeAsset(`ref-role-${role}.png`);
      const reference = await addReference({ projectId: project.id, assetId: asset.id, role }, { versioning: spyVersioning() });
      cleanup.referenceIds.push(reference.id);
      expect(reference.role).toBe(role);
    }
  });

  it('acquires and releases a Lock row around the create, keyed by projects/<id>', async () => {
    const project = await makeProject(`${marker}-ref-lock-project`);
    const asset = await makeAsset('ref-lock.png');

    const reference = await addReference(
      { projectId: project.id, assetId: asset.id, role: 'composition' },
      { versioning: spyVersioning() }
    );
    cleanup.referenceIds.push(reference.id);

    const count = await prisma.lock.count({ where: { resourceType: 'directory', resourceKey: `projects/${project.id}` } });
    expect(count).toBe(0); // released after completion
  });

  it('rejects an unknown projectId', async () => {
    const asset = await makeAsset('ref-badproject.png');
    await expect(
      addReference({ projectId: -1, assetId: asset.id, role: 'template' }, { versioning: spyVersioning() })
    ).rejects.toThrow(/no Project/);
  });

  it('rejects an unknown assetId', async () => {
    const project = await makeProject(`${marker}-ref-badasset-project`);
    await expect(
      addReference({ projectId: project.id, assetId: -1, role: 'template' }, { versioning: spyVersioning() })
    ).rejects.toThrow(/no Asset/);
  });

  it('remove_reference deletes exactly the targeted row', async () => {
    const project = await makeProject(`${marker}-ref-remove-project`);
    const assetOne = await makeAsset('ref-remove-one.png');
    const assetTwo = await makeAsset('ref-remove-two.png');

    const refOne = await addReference({ projectId: project.id, assetId: assetOne.id, role: 'style' }, { versioning: spyVersioning() });
    const refTwo = await addReference({ projectId: project.id, assetId: assetTwo.id, role: 'template' }, { versioning: spyVersioning() });
    cleanup.referenceIds.push(refTwo.id);

    const versioning = spyVersioning();
    const result = await removeReference({ referenceId: refOne.id }, { versioning });

    expect(result).toEqual({ id: refOne.id, deleted: true });
    expect(versioning.calls).toHaveLength(1);

    const gone = await prisma.reference.findUnique({ where: { id: refOne.id } });
    expect(gone).toBeNull();
    const stillThere = await prisma.reference.findUnique({ where: { id: refTwo.id } });
    expect(stillThere).not.toBeNull();
  });

  it('rejects removing an unknown referenceId', async () => {
    await expect(removeReference({ referenceId: -1 }, { versioning: spyVersioning() })).rejects.toThrow(/no Reference/);
  });
});

describe('set_iteration_state', () => {
  it('accepted: true clears accepted on other iterations in the same project only -- a different project is unaffected', async () => {
    const projectA = await makeProject(`${marker}-state-project-a`);
    const projectB = await makeProject(`${marker}-state-project-b`);

    const iterA1 = await createIteration({ projectId: projectA.id, imagePath: 'a1.png', promptUsed: 'p' }, { versioning: spyVersioning() });
    const iterA2 = await createIteration({ projectId: projectA.id, imagePath: 'a2.png', promptUsed: 'p' }, { versioning: spyVersioning() });
    const iterB1 = await createIteration({ projectId: projectB.id, imagePath: 'b1.png', promptUsed: 'p' }, { versioning: spyVersioning() });
    cleanup.iterationIds.push(iterA1.id, iterA2.id, iterB1.id);

    await setIterationState({ iterationId: iterA1.id, accepted: true }, { versioning: spyVersioning() });
    await setIterationState({ iterationId: iterB1.id, accepted: true }, { versioning: spyVersioning() });

    const updated = await setIterationState({ iterationId: iterA2.id, accepted: true }, { versioning: spyVersioning() });
    expect(updated.accepted).toBe(true);

    const refreshedA1 = await prisma.iteration.findUnique({ where: { id: iterA1.id } });
    const refreshedB1 = await prisma.iteration.findUnique({ where: { id: iterB1.id } });
    expect(refreshedA1!.accepted).toBe(false); // cleared -- same project as the new accepted iteration
    expect(refreshedB1!.accepted).toBe(true); // untouched -- different project
  });

  it("role: 'front' clears front from the prior same-project holder without disturbing whoever holds 'back'", async () => {
    const project = await makeProject(`${marker}-state-role-project`);
    const iter1 = await createIteration({ projectId: project.id, imagePath: 'r1.png', promptUsed: 'p' }, { versioning: spyVersioning() });
    const iter2 = await createIteration({ projectId: project.id, imagePath: 'r2.png', promptUsed: 'p' }, { versioning: spyVersioning() });
    const iter3 = await createIteration({ projectId: project.id, imagePath: 'r3.png', promptUsed: 'p' }, { versioning: spyVersioning() });
    cleanup.iterationIds.push(iter1.id, iter2.id, iter3.id);

    await setIterationState({ iterationId: iter1.id, role: 'front' }, { versioning: spyVersioning() });
    await setIterationState({ iterationId: iter3.id, role: 'back' }, { versioning: spyVersioning() });

    const updated = await setIterationState({ iterationId: iter2.id, role: 'front' }, { versioning: spyVersioning() });
    expect(updated.role).toBe('front');

    const refreshed1 = await prisma.iteration.findUnique({ where: { id: iter1.id } });
    const refreshed3 = await prisma.iteration.findUnique({ where: { id: iter3.id } });
    expect(refreshed1!.role).toBeNull(); // front cleared from the prior holder
    expect(refreshed3!.role).toBe('back'); // untouched -- front/back are independently exclusive
  });

  it('acquires and releases a Lock row around the transaction', async () => {
    const project = await makeProject(`${marker}-state-lock-project`);
    const iter = await createIteration({ projectId: project.id, imagePath: 'lock.png', promptUsed: 'p' }, { versioning: spyVersioning() });
    cleanup.iterationIds.push(iter.id);

    await setIterationState({ iterationId: iter.id, accepted: true }, { versioning: spyVersioning() });

    const count = await prisma.lock.count({ where: { resourceType: 'directory', resourceKey: `projects/${project.id}` } });
    expect(count).toBe(0); // released after completion
  });

  it('rejects a call with neither accepted nor role', async () => {
    const project = await makeProject(`${marker}-state-empty-project`);
    const iter = await createIteration({ projectId: project.id, imagePath: 'empty.png', promptUsed: 'p' }, { versioning: spyVersioning() });
    cleanup.iterationIds.push(iter.id);

    await expect(setIterationState({ iterationId: iter.id }, { versioning: spyVersioning() })).rejects.toThrow(/at least one/);
  });

  it('rejects an unknown iterationId', async () => {
    await expect(setIterationState({ iterationId: -1, accepted: true }, { versioning: spyVersioning() })).rejects.toThrow(
      /no Iteration/
    );
  });
});

describe('search_catalog', () => {
  // This file's real, 64-dimension embedText vectors share the process-wide
  // `VecEmbeddings` mirror table (search.ts's ensureVecTable, fixed
  // dimension per process) with search.test.ts's hand-seeded 4-dimension
  // fixtures. Forcing the brute-force fallback here sidesteps that
  // dimension collision entirely -- same pattern
  // description-retry-and-search.test.ts already uses for this exact
  // reason (see that file's header comment).
  const originalForceVectorFallbackEnv = process.env.FORCE_VECTOR_FALLBACK;
  const searchAssetIds: number[] = [];
  const searchEmbeddingIds: number[] = [];
  const searchEntryIds: number[] = [];

  beforeAll(() => {
    process.env.FORCE_VECTOR_FALLBACK = '1';
    __resetCapabilityCacheForTests();
  });

  afterAll(() => {
    if (originalForceVectorFallbackEnv === undefined) {
      delete process.env.FORCE_VECTOR_FALLBACK;
    } else {
      process.env.FORCE_VECTOR_FALLBACK = originalForceVectorFallbackEnv;
    }
    __resetCapabilityCacheForTests();
  });

  afterEach(async () => {
    for (const id of searchAssetIds.splice(0)) {
      removeFromKeywordIndex('asset', id);
    }
    for (const id of searchEntryIds.splice(0)) {
      removeFromKeywordIndex('knowledge_entry', id);
    }
    const embeddingIdsToClear = searchEmbeddingIds.splice(0);
    if (embeddingIdsToClear.length) {
      await prisma.embedding.deleteMany({ where: { id: { in: embeddingIdsToClear } } });
    }
  });

  async function seedAssetWithDescriptionAndEmbedding(pathSuffix: string, descriptionText: string) {
    const asset = await addAssetToCollection(
      {
        directoryId: assetsDirId,
        collectionName: `${marker}-search-collection`,
        path: `${marker}/assets/${pathSuffix}`,
        hash: `hash-${pathSuffix}`,
      },
      { versioning: spyVersioning() }
    );
    cleanup.assetIds.push(asset.id);
    cleanup.collectionIds.push(asset.collectionId);
    searchAssetIds.push(asset.id);

    await prisma.assetDescription.create({
      data: { assetId: asset.id, isPhotograph: false, isLogo: false, description: descriptionText, tags: [] },
    });
    indexAssetDescription({ assetId: asset.id, description: descriptionText, tags: [] });

    const vector = embedText(descriptionText);
    const embedding = await prisma.embedding.create({
      data: {
        ownerType: 'asset',
        ownerId: asset.id,
        vector: Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength),
        model: EMBEDDING_MODEL,
      },
    });
    searchEmbeddingIds.push(embedding.id);

    return asset;
  }

  it('returns a match found via both the vector (embedText/nearestNeighbors) and keyword (keywordSearch) paths, with denormalized fields', async () => {
    const distinctiveWord = `robotmascot${marker.replace(/[^a-zA-Z0-9]/g, '')}`;
    const asset = await seedAssetWithDescriptionAndEmbedding(
      'search-robot.png',
      `a friendly ${distinctiveWord} for the postcard design`
    );

    const results = await searchCatalog({ query: distinctiveWord, k: 5 }, {});

    const match = results.find((r) => r.ownerType === 'asset' && r.ownerId === asset.id);
    expect(match).toBeDefined();
    expect(match!.matchedVia).toEqual(expect.arrayContaining(['vector', 'keyword']));
    expect(match!.score).toBeGreaterThan(0);
    expect(match!.path).toBe(asset.path);
    expect(match!.label).toContain(distinctiveWord);
  });

  it('merges an Asset vector match and a KnowledgeEntry keyword-only match into one deduped result set', async () => {
    const distinctiveWord = `zzyzxsearch${marker.replace(/[^a-zA-Z0-9]/g, '')}`;
    const asset = await seedAssetWithDescriptionAndEmbedding('search-mixed.png', `${distinctiveWord} branded artwork`);

    const entry = await prisma.knowledgeEntry.create({
      data: {
        directoryId: knowledgeDirId,
        kind: 'style',
        name: `${marker}-search-entry`,
        bodyText: `notes about ${distinctiveWord} usage`,
      },
    });
    cleanup.knowledgeEntryIds.push(entry.id);
    searchEntryIds.push(entry.id);
    indexKnowledgeEntry({ id: entry.id, name: entry.name, bodyText: entry.bodyText });

    const results = await searchCatalog({ query: distinctiveWord, k: 5 }, {});

    const assetMatch = results.find((r) => r.ownerType === 'asset' && r.ownerId === asset.id);
    const entryMatch = results.find((r) => r.ownerType === 'knowledge_entry' && r.ownerId === entry.id);
    expect(assetMatch).toBeDefined();
    expect(entryMatch).toBeDefined();
    expect(entryMatch!.matchedVia).toEqual(['keyword']);
    expect(entryMatch!.label).toBe(entry.name);

    // No duplicate (ownerType, ownerId) pairs in the merged result set.
    const keys = results.map((r) => `${r.ownerType}:${r.ownerId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('makes zero real network calls -- purely local embedText/nearestNeighbors/keywordSearch', async () => {
    // No fetch/network stub is configured anywhere in this test file; a real
    // network call here would either throw (no network reachable in the
    // sandbox) or hang past the test's default timeout. Completing quickly
    // with a well-formed (possibly empty) array proves no such call happened.
    const results = await searchCatalog({ query: `nomatch${marker.replace(/[^a-zA-Z0-9]/g, '')}`, k: 5 }, {});
    expect(Array.isArray(results)).toBe(true);
  });
});

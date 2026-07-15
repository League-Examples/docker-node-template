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
  registerCatalogTools,
  VersionConflictError,
} from '../../server/src/agent-mcp/catalogTools';
import { createWorkspaceMcpServer } from '../../server/src/agent-mcp/server';
import { acquireLock, releaseLock, LockConflictError } from '../../server/src/agent-mcp/locks';
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
  it('registers exactly the seven catalog tools alongside the four fs tools -- no other tools', async () => {
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

/**
 * Coverage for `server/src/routes/projects.ts` (ticket 006): project
 * list/get/create, references (attach/remove), and iteration-state PATCH
 * -- all `requireAuth`-only, all write handlers delegating to ticket
 * 002's `create_project`/`add_reference`/`remove_reference`/
 * `set_iteration_state` Workspace MCP Server tool functions in-process
 * (never raw Prisma -- R1).
 *
 * Every write handler is verified to go through its tool function via a
 * call-through spy on `agent-mcp/catalogTools.ts`'s exports -- the real
 * tool implementation still runs underneath (these wrap, not replace, the
 * original export, mirroring `tests/server/postcard-pdf-route.test.ts`'s
 * `vi.mock(..., importOriginal)` pattern but calling through instead of
 * stubbing), so the DB/lock/versioning side effects the other assertions
 * below depend on (exclusivity, persisted rows) still happen for real.
 * If a handler were ever rewritten to call raw Prisma instead of the
 * tool, the corresponding spy would simply never fire.
 *
 * Follows `tests/server/postcard-route.test.ts`'s scratch `WORKSPACE_DIR`/
 * `WORKSPACE_GIT_ROOT` pattern: `create_project`'s create path does a real
 * `fs.mkdir` under `WORKSPACE_DIR`, and every tool call's
 * `versioning.recordChange` (the real, unmocked singleton -- this route
 * exposes no DI knob, matching `postcards.ts`) needs `WORKSPACE_GIT_ROOT`
 * set or it throws "Path escapes WORKSPACE_GIT_ROOT".
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Server } from 'http';
import { startTestServer, stopTestServer } from './helpers/testServer';

process.env.NODE_ENV = 'test';

// One persistent http.Server for this file (sprint 013-001) -- started
// once `app` is available below (after WORKSPACE_DIR/WORKSPACE_GIT_ROOT
// are set). Its afterAll is registered first, before any other hook in
// this file, so it closes last -- after the env-var-restore and
// fixture-cleanup afterAlls further down.
let server: Server;

afterAll(async () => {
  await stopTestServer(server);
});

const mockCreateProject = vi.hoisted(() => vi.fn());
const mockAddReference = vi.hoisted(() => vi.fn());
const mockRemoveReference = vi.hoisted(() => vi.fn());
const mockSetIterationState = vi.hoisted(() => vi.fn());
const mockRemoveIteration = vi.hoisted(() => vi.fn());
const mockRemoveProject = vi.hoisted(() => vi.fn());

vi.mock('../../server/src/agent-mcp/catalogTools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/src/agent-mcp/catalogTools')>();
  return {
    ...actual,
    createProject: (...args: Parameters<typeof actual.createProject>) => {
      mockCreateProject(...args);
      return actual.createProject(...args);
    },
    addReference: (...args: Parameters<typeof actual.addReference>) => {
      mockAddReference(...args);
      return actual.addReference(...args);
    },
    removeReference: (...args: Parameters<typeof actual.removeReference>) => {
      mockRemoveReference(...args);
      return actual.removeReference(...args);
    },
    setIterationState: (...args: Parameters<typeof actual.setIterationState>) => {
      mockSetIterationState(...args);
      return actual.setIterationState(...args);
    },
    removeIteration: (...args: Parameters<typeof actual.removeIteration>) => {
      mockRemoveIteration(...args);
      return actual.removeIteration(...args);
    },
    removeProject: (...args: Parameters<typeof actual.removeProject>) => {
      mockRemoveProject(...args);
      return actual.removeProject(...args);
    },
  };
});

const marker = `t006proj${Date.now()}`;

let testRoot: string;
let previousWorkspaceDir: string | undefined;
let previousWorkspaceGitRoot: string | undefined;

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'flyerbot-projects-route-test-'));
  previousWorkspaceDir = process.env.WORKSPACE_DIR;
  previousWorkspaceGitRoot = process.env.WORKSPACE_GIT_ROOT;
  process.env.WORKSPACE_DIR = testRoot;
  process.env.WORKSPACE_GIT_ROOT = testRoot;
});

afterAll(async () => {
  if (previousWorkspaceDir === undefined) {
    delete process.env.WORKSPACE_DIR;
  } else {
    process.env.WORKSPACE_DIR = previousWorkspaceDir;
  }
  if (previousWorkspaceGitRoot === undefined) {
    delete process.env.WORKSPACE_GIT_ROOT;
  } else {
    process.env.WORKSPACE_GIT_ROOT = previousWorkspaceGitRoot;
  }
  await fs.rm(testRoot, { recursive: true, force: true });
});

let app: typeof import('../../server/src/app').default;
let prisma: typeof import('../../server/src/services/prisma').prisma;

beforeAll(async () => {
  app = (await import('../../server/src/app')).default;
  prisma = (await import('../../server/src/services/prisma')).prisma;
  server = await startTestServer(app);
});

let userAId: number;
let userBId: number;
let assetDirId: number;
let collectionId: number;
let assetId: number;

const cleanup = {
  projectIds: [] as number[],
  iterationIds: [] as number[],
  referenceIds: [] as number[],
  chatMessageIds: [] as number[],
  assetIds: [] as number[],
  collectionIds: [] as number[],
  directoryIds: [] as number[],
};

beforeAll(async () => {
  const userA = await prisma.user.create({
    data: {
      email: `${marker}-a@example.com`,
      displayName: 'Projects Route User A',
      role: 'USER',
      provider: 'test',
      providerId: `${marker}-a`,
    },
  });
  userAId = userA.id;

  const userB = await prisma.user.create({
    data: {
      email: `${marker}-b@example.com`,
      displayName: 'Projects Route User B',
      role: 'USER',
      provider: 'test',
      providerId: `${marker}-b`,
    },
  });
  userBId = userB.id;

  const dir = await prisma.workspaceDirectory.create({
    data: { path: `${marker}/assets`, kind: 'collection' },
  });
  assetDirId = dir.id;
  cleanup.directoryIds.push(dir.id);

  const collection = await prisma.collection.create({
    data: { directoryId: assetDirId, name: `${marker}-collection`, kind: 'stock-art' },
  });
  collectionId = collection.id;
  cleanup.collectionIds.push(collection.id);

  const asset = await prisma.asset.create({
    data: { collectionId, path: `${marker}/assets/hero.png`, hash: 'hero-hash', mtime: new Date() },
  });
  assetId = asset.id;
  cleanup.assetIds.push(asset.id);
});

afterAll(async () => {
  await prisma.reference.deleteMany({ where: { id: { in: cleanup.referenceIds } } });
  await prisma.reference.deleteMany({ where: { projectId: { in: cleanup.projectIds } } });
  await prisma.chatMessage.deleteMany({ where: { id: { in: cleanup.chatMessageIds } } });
  await prisma.chatMessage.deleteMany({ where: { projectId: { in: cleanup.projectIds } } });
  await prisma.iteration.deleteMany({ where: { id: { in: cleanup.iterationIds } } });
  await prisma.iteration.deleteMany({ where: { projectId: { in: cleanup.projectIds } } });
  await prisma.project.updateMany({ where: { id: { in: cleanup.projectIds } }, data: { parentProjectId: null } });
  await prisma.project.deleteMany({ where: { id: { in: cleanup.projectIds } } });
  await prisma.asset.deleteMany({ where: { id: { in: cleanup.assetIds } } });
  await prisma.collection.deleteMany({ where: { id: { in: cleanup.collectionIds } } });
  await prisma.workspaceDirectory.deleteMany({ where: { id: { in: cleanup.directoryIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
});

beforeEach(() => {
  mockCreateProject.mockClear();
  mockAddReference.mockClear();
  mockRemoveReference.mockClear();
  mockSetIterationState.mockClear();
  mockRemoveIteration.mockClear();
  mockRemoveProject.mockClear();
});

async function loginAsUserA() {
  const agent = request.agent(server);
  await agent.post('/api/auth/test-login').send({
    email: `${marker}-a@example.com`,
    displayName: 'Projects Route User A',
    role: 'USER',
  });
  return agent;
}

async function loginAsUserB() {
  const agent = request.agent(server);
  await agent.post('/api/auth/test-login').send({
    email: `${marker}-b@example.com`,
    displayName: 'Projects Route User B',
    role: 'USER',
  });
  return agent;
}

async function makeProject(ownerId: number, title: string, status = 'active') {
  const project = await prisma.project.create({ data: { title, ownerUserId: ownerId, status } });
  cleanup.projectIds.push(project.id);
  return project;
}

async function makeIteration(projectId: number, imagePath: string, seq: number) {
  const iteration = await prisma.iteration.create({ data: { projectId, seq, imagePath, promptUsed: 'fixture' } });
  cleanup.iterationIds.push(iteration.id);
  return iteration;
}

describe('GET /api/projects -- auth gate', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const res = await request(server).get('/api/projects');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/projects -- view filtering', () => {
  it('view=mine returns only the requesting user\'s non-archived projects', async () => {
    const mine = await makeProject(userAId, `${marker}-mine-active`);
    const mineArchived = await makeProject(userAId, `${marker}-mine-archived`, 'archived');
    const other = await makeProject(userBId, `${marker}-others-active`);

    const agent = await loginAsUserA();
    const res = await agent.get('/api/projects?view=mine');
    expect(res.status).toBe(200);
    const ids = res.body.projects.map((p: any) => p.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(mineArchived.id);
    expect(ids).not.toContain(other.id);
  });

  it('view=all returns every user\'s projects, not just the requester\'s', async () => {
    const mine = await makeProject(userAId, `${marker}-all-mine`);
    const other = await makeProject(userBId, `${marker}-all-others`);

    const agent = await loginAsUserA();
    const res = await agent.get('/api/projects?view=all');
    expect(res.status).toBe(200);
    const ids = res.body.projects.map((p: any) => p.id);
    expect(ids).toContain(mine.id);
    expect(ids).toContain(other.id);
  });

  it('view=archive returns only status: archived projects', async () => {
    const archived = await makeProject(userAId, `${marker}-archived-only`, 'archived');
    const active = await makeProject(userAId, `${marker}-active-only`);

    const agent = await loginAsUserA();
    const res = await agent.get('/api/projects?view=archive');
    expect(res.status).toBe(200);
    const ids = res.body.projects.map((p: any) => p.id);
    expect(ids).toContain(archived.id);
    expect(ids).not.toContain(active.id);
  });

  it('inlines each project\'s iterations and owner (ticket 008 hero-image rule)', async () => {
    const project = await makeProject(userAId, `${marker}-list-hero`);
    const iteration = await makeIteration(project.id, `projects/${project.id}/iterations/iter-1.png`, 1);

    const agent = await loginAsUserA();
    const res = await agent.get('/api/projects?view=mine');
    expect(res.status).toBe(200);

    const row = res.body.projects.find((p: any) => p.id === project.id);
    expect(row).toBeDefined();
    expect(row.iterations.map((i: any) => i.id)).toEqual([iteration.id]);
    expect(row.owner.id).toBe(userAId);
    expect(row.owner.email).toBe(`${marker}-a@example.com`);
  });

  it('inlines each project\'s saved postcardContent, and null when nothing is saved (OOP change, 2026-07-15)', async () => {
    // Two projects: one with a real, prior-PUT `postcard-content.json`
    // (via the same `PUT /api/postcards/:projectId` route the client's
    // text editor uses -- mirrors `postcard-route.test.ts`'s own fixture
    // pattern, so this exercises the real `createAgentPage` write, not a
    // hand-written file), one with nothing saved at all.
    const withContent = await makeProject(userAId, `${marker}-list-postcard-content`);
    const frontIteration = await makeIteration(withContent.id, `projects/${withContent.id}/iterations/front.png`, 1);
    const withoutContent = await makeProject(userAId, `${marker}-list-postcard-none`);

    const agent = await loginAsUserA();

    const putRes = await agent.put(`/api/postcards/${withContent.id}`).send({
      front_image: frontIteration.imagePath,
      front_regions: [
        {
          name: 'headline',
          label: 'Headline',
          style: '',
          text: 'HELLO WORLD',
          rows: null,
          position: { top: '1.0in', left: '0.5in', width: '3.4in' },
          font: { family: 'Arial, sans-serif', size: '34px' },
        },
      ],
    });
    expect(putRes.status).toBe(200);

    const res = await agent.get('/api/projects?view=mine');
    expect(res.status).toBe(200);

    const withContentRow = res.body.projects.find((p: any) => p.id === withContent.id);
    expect(withContentRow).toBeDefined();
    expect(withContentRow.postcardContent).not.toBeNull();
    expect(withContentRow.postcardContent.front_regions).toHaveLength(1);
    expect(withContentRow.postcardContent.front_regions[0].text).toBe('HELLO WORLD');

    const withoutContentRow = res.body.projects.find((p: any) => p.id === withoutContent.id);
    expect(withoutContentRow).toBeDefined();
    expect(withoutContentRow.postcardContent).toBeNull();
  });

  it('excludes agent-page output rows from the list response\'s iterations too (OOP follow-up, 2026-07-15)', async () => {
    const project = await makeProject(userAId, `${marker}-list-agent-page-filter`);
    const realIteration = await makeIteration(project.id, `projects/${project.id}/iterations/real.png`, 1);
    const agentPageIteration = await prisma.iteration.create({
      data: {
        projectId: project.id,
        seq: 2,
        imagePath: `projects/${project.id}/outputs/postcard-content.json`,
        promptUsed: 'agent-page:postcard-content.json',
        modelParams: { kind: 'agent-page', filename: 'postcard-content.json' },
      },
    });
    cleanup.iterationIds.push(agentPageIteration.id);

    const agent = await loginAsUserA();
    const res = await agent.get('/api/projects?view=mine');
    expect(res.status).toBe(200);

    const row = res.body.projects.find((p: any) => p.id === project.id);
    expect(row).toBeDefined();
    const ids = row.iterations.map((i: any) => i.id);
    expect(ids).toContain(realIteration.id);
    expect(ids).not.toContain(agentPageIteration.id);
  });
});

describe('GET /api/projects/:id', () => {
  it('includes iterations, references, and chatMessages in one response', async () => {
    const project = await makeProject(userAId, `${marker}-detail`);
    const iteration = await makeIteration(project.id, `projects/${project.id}/iterations/iter-1.png`, 1);
    const reference = await prisma.reference.create({ data: { projectId: project.id, assetId, role: 'style' } });
    cleanup.referenceIds.push(reference.id);
    const chatMessage = await prisma.chatMessage.create({
      data: { projectId: project.id, role: 'user', content: 'Hello Claude, prior chat history' },
    });
    cleanup.chatMessageIds.push(chatMessage.id);

    const agent = await loginAsUserA();
    const res = await agent.get(`/api/projects/${project.id}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(project.id);
    expect(res.body.iterations.map((i: any) => i.id)).toEqual([iteration.id]);
    expect(res.body.references.map((r: any) => r.id)).toEqual([reference.id]);
    // The tightened requirement: chatMessages ride along in this same
    // response so reopening a project rehydrates chat history without a
    // second request.
    expect(res.body.chatMessages.map((m: any) => m.id)).toEqual([chatMessage.id]);
    expect(res.body.chatMessages[0].content).toBe('Hello Claude, prior chat history');
  });

  it('returns 404 for a project that does not exist', async () => {
    const agent = await loginAsUserA();
    const res = await agent.get('/api/projects/999999999');
    expect(res.status).toBe(404);
  });

  it('returns 400 for a non-numeric project id', async () => {
    const agent = await loginAsUserA();
    const res = await agent.get('/api/projects/not-a-number');
    expect(res.status).toBe(400);
  });

  it('excludes agent-page output rows (promptUsed starting agent-page:) from iterations (OOP follow-up, 2026-07-15)', async () => {
    const project = await makeProject(userAId, `${marker}-detail-agent-page-filter`);
    const realIteration = await makeIteration(project.id, `projects/${project.id}/iterations/real.png`, 1);
    const agentPageIteration = await prisma.iteration.create({
      data: {
        projectId: project.id,
        seq: 2,
        imagePath: `projects/${project.id}/outputs/postcard.html`,
        promptUsed: 'agent-page:postcard.html',
        modelParams: { kind: 'agent-page', filename: 'postcard.html' },
      },
    });
    cleanup.iterationIds.push(agentPageIteration.id);

    const agent = await loginAsUserA();
    const res = await agent.get(`/api/projects/${project.id}`);

    expect(res.status).toBe(200);
    const ids = res.body.iterations.map((i: any) => i.id);
    expect(ids).toContain(realIteration.id);
    expect(ids).not.toContain(agentPageIteration.id);
  });
});

describe('POST /api/projects -- create via create_project (no sourceAssetId)', () => {
  it('creates a project through the create_project tool, not raw Prisma', async () => {
    const agent = await loginAsUserA();
    const res = await agent.post('/api/projects').send({ title: `${marker}-created` });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe(`${marker}-created`);
    expect(res.body.ownerUserId).toBe(userAId);
    expect(res.body.iterations).toEqual([]);
    expect(res.body.references).toEqual([]);
    expect(res.body.chatMessages).toEqual([]);
    cleanup.projectIds.push(res.body.id);

    expect(mockCreateProject).toHaveBeenCalledTimes(1);
    expect(mockCreateProject.mock.calls[0][0]).toMatchObject({ title: `${marker}-created`, ownerUserId: userAId });

    // Confirms the real create_project implementation ran underneath the
    // spy (its own fs.mkdir side effect), not a bypassed no-op.
    const dirStat = await fs.stat(path.join(testRoot, 'projects', String(res.body.id)));
    expect(dirStat.isDirectory()).toBe(true);
  });

  it('rejects a missing title with 400 without calling create_project', async () => {
    const agent = await loginAsUserA();
    const res = await agent.post('/api/projects').send({});
    expect(res.status).toBe(400);
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it('a non-admin (USER role) authenticated caller can create a project', async () => {
    const agent = await loginAsUserA();
    const res = await agent.post('/api/projects').send({ title: `${marker}-nonadmin` });
    expect(res.status).toBe(201);
    cleanup.projectIds.push(res.body.id);
  });
});

describe('POST /api/projects -- description (OOP follow-up, 2026-07-16: "New project" modal)', () => {
  it('stores a description in detailsHeader.description, and GET returns it', async () => {
    const agent = await loginAsUserA();
    const res = await agent
      .post('/api/projects')
      .send({ title: `${marker}-with-description`, description: 'A postcard announcing the spring open house.' });

    expect(res.status).toBe(201);
    cleanup.projectIds.push(res.body.id);
    expect(res.body.detailsHeader).toEqual({ description: 'A postcard announcing the spring open house.' });

    expect(mockCreateProject).toHaveBeenCalledTimes(1);
    expect(mockCreateProject.mock.calls[0][0]).toMatchObject({
      detailsHeader: { description: 'A postcard announcing the spring open house.' },
    });

    const getRes = await agent.get(`/api/projects/${res.body.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.detailsHeader).toEqual({ description: 'A postcard announcing the spring open house.' });
  });

  it('merges description onto a caller-supplied detailsHeader rather than clobbering it', async () => {
    const agent = await loginAsUserA();
    const res = await agent.post('/api/projects').send({
      title: `${marker}-merged-description`,
      description: 'A postcard announcing the spring open house.',
      detailsHeader: { style: 'Pop Art' },
    });

    expect(res.status).toBe(201);
    cleanup.projectIds.push(res.body.id);
    expect(res.body.detailsHeader).toEqual({
      style: 'Pop Art',
      description: 'A postcard announcing the spring open house.',
    });
  });

  it('an absent description is fine -- no detailsHeader is set', async () => {
    const agent = await loginAsUserA();
    const res = await agent.post('/api/projects').send({ title: `${marker}-no-description` });

    expect(res.status).toBe(201);
    cleanup.projectIds.push(res.body.id);
    expect(res.body.detailsHeader).toBeNull();
  });

  it('rejects a non-string description with 400, without calling create_project', async () => {
    const agent = await loginAsUserA();
    const res = await agent.post('/api/projects').send({ title: `${marker}-bad-description`, description: 42 });

    expect(res.status).toBe(400);
    expect(mockCreateProject).not.toHaveBeenCalled();
  });
});

describe('POST /api/projects -- with sourceAssetId (SUC-011 library-asset-to-project flow)', () => {
  it('creates the project and a Reference row pointing at the source asset in one request', async () => {
    const agent = await loginAsUserA();
    const res = await agent.post('/api/projects').send({ title: `${marker}-from-library`, sourceAssetId: assetId });

    expect(res.status).toBe(201);
    cleanup.projectIds.push(res.body.id);

    expect(res.body.references).toHaveLength(1);
    expect(res.body.references[0].assetId).toBe(assetId);

    expect(mockCreateProject).toHaveBeenCalledTimes(1);
    expect(mockAddReference).toHaveBeenCalledTimes(1);
    expect(mockAddReference.mock.calls[0][0]).toMatchObject({ projectId: res.body.id, assetId });

    const persisted = await prisma.reference.findFirst({ where: { projectId: res.body.id } });
    expect(persisted?.assetId).toBe(assetId);
    if (persisted) cleanup.referenceIds.push(persisted.id);
  });
});

describe('POST /api/projects/:id/references, DELETE /api/projects/:id/references/:refId', () => {
  it('round-trips correctly through add_reference/remove_reference', async () => {
    const project = await makeProject(userAId, `${marker}-refs`);
    const agent = await loginAsUserA();

    const addRes = await agent.post(`/api/projects/${project.id}/references`).send({ assetId, role: 'style' });
    expect(addRes.status).toBe(201);
    expect(addRes.body.projectId).toBe(project.id);
    expect(addRes.body.assetId).toBe(assetId);
    expect(mockAddReference).toHaveBeenCalledTimes(1);

    const refId = addRes.body.id;
    const stored = await prisma.reference.findUnique({ where: { id: refId } });
    expect(stored).not.toBeNull();

    const delRes = await agent.delete(`/api/projects/${project.id}/references/${refId}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body).toEqual({ id: refId, deleted: true });
    expect(mockRemoveReference).toHaveBeenCalledTimes(1);

    const goneAfterDelete = await prisma.reference.findUnique({ where: { id: refId } });
    expect(goneAfterDelete).toBeNull();
  });

  it('rejects a missing assetId/role with 400 without calling add_reference', async () => {
    const project = await makeProject(userAId, `${marker}-refs-bad`);
    const agent = await loginAsUserA();
    const res = await agent.post(`/api/projects/${project.id}/references`).send({});
    expect(res.status).toBe(400);
    expect(mockAddReference).not.toHaveBeenCalled();
  });

  it('returns 404 deleting a reference that does not belong to the named project', async () => {
    const projectA = await makeProject(userAId, `${marker}-mismatch-a`);
    const projectB = await makeProject(userAId, `${marker}-mismatch-b`);
    const reference = await prisma.reference.create({ data: { projectId: projectA.id, assetId, role: 'style' } });
    cleanup.referenceIds.push(reference.id);

    const agent = await loginAsUserA();
    const res = await agent.delete(`/api/projects/${projectB.id}/references/${reference.id}`);
    expect(res.status).toBe(404);
    expect(mockRemoveReference).not.toHaveBeenCalled();

    const stillThere = await prisma.reference.findUnique({ where: { id: reference.id } });
    expect(stillThere).not.toBeNull();
  });
});

describe('PATCH /api/projects/:id/iterations/:iterId -- set_iteration_state exclusivity (Sprint 005 OOP change, 2026-07-15: role is stream membership)', () => {
  it('round-trips accepted exclusivity through set_iteration_state, scoped to iterations sharing the same role', async () => {
    const project = await makeProject(userAId, `${marker}-iter-accept`);
    const iterA = await makeIteration(project.id, `projects/${project.id}/iterations/a.png`, 1);
    const iterB = await makeIteration(project.id, `projects/${project.id}/iterations/b.png`, 2);

    const agent = await loginAsUserA();
    const res1 = await agent.patch(`/api/projects/${project.id}/iterations/${iterA.id}`).send({ accepted: true });
    expect(res1.status).toBe(200);
    expect(res1.body.accepted).toBe(true);

    const res2 = await agent.patch(`/api/projects/${project.id}/iterations/${iterB.id}`).send({ accepted: true });
    expect(res2.status).toBe(200);
    expect(res2.body.accepted).toBe(true);
    expect(mockSetIterationState).toHaveBeenCalledTimes(2);

    // Both iterations share the same role (null, the default), so
    // accepting B still clears A's accepted flag.
    const refreshedA = await prisma.iteration.findUnique({ where: { id: iterA.id } });
    expect(refreshedA?.accepted).toBe(false);
  });

  it('accepting a front-stream iteration never clears an already-accepted back-stream iteration (per-(project, role) exclusivity)', async () => {
    const project = await makeProject(userAId, `${marker}-iter-stream-accept`);
    const front = await makeIteration(project.id, `projects/${project.id}/iterations/f.png`, 1);
    const back = await makeIteration(project.id, `projects/${project.id}/iterations/b.png`, 2);

    const agent = await loginAsUserA();
    await agent.patch(`/api/projects/${project.id}/iterations/${front.id}`).send({ role: 'front', accepted: true });
    await agent.patch(`/api/projects/${project.id}/iterations/${back.id}`).send({ role: 'back', accepted: true });

    const refreshedFront = await prisma.iteration.findUnique({ where: { id: front.id } });
    const refreshedBack = await prisma.iteration.findUnique({ where: { id: back.id } });
    expect(refreshedFront?.accepted).toBe(true); // untouched -- different stream
    expect(refreshedBack?.accepted).toBe(true);
  });

  it('role is stream membership, not exclusive -- setting role never affects any other iteration\'s role (old front/back single-holder exclusivity dropped)', async () => {
    const project = await makeProject(userAId, `${marker}-iter-role`);
    const iterA = await makeIteration(project.id, `projects/${project.id}/iterations/a.png`, 1);
    const iterB = await makeIteration(project.id, `projects/${project.id}/iterations/b.png`, 2);

    const agent = await loginAsUserA();
    await agent.patch(`/api/projects/${project.id}/iterations/${iterA.id}`).send({ role: 'front' });

    let refreshedA = await prisma.iteration.findUnique({ where: { id: iterA.id } });
    expect(refreshedA?.role).toBe('front');

    // Tagging iterB into the SAME 'front' stream must NOT clear iterA's
    // role -- many iterations can share a stream now.
    const res = await agent.patch(`/api/projects/${project.id}/iterations/${iterB.id}`).send({ role: 'front' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('front');

    refreshedA = await prisma.iteration.findUnique({ where: { id: iterA.id } });
    expect(refreshedA?.role).toBe('front');
  });

  it('returns 400 when neither accepted nor role is provided', async () => {
    const project = await makeProject(userAId, `${marker}-iter-empty`);
    const iter = await makeIteration(project.id, `projects/${project.id}/iterations/a.png`, 1);
    const agent = await loginAsUserA();
    const res = await agent.patch(`/api/projects/${project.id}/iterations/${iter.id}`).send({});
    expect(res.status).toBe(400);
    expect(mockSetIterationState).not.toHaveBeenCalled();
  });

  it('returns 404 for an iteration id that does not belong to the named project', async () => {
    const projectA = await makeProject(userAId, `${marker}-iter-mismatch-a`);
    const projectB = await makeProject(userAId, `${marker}-iter-mismatch-b`);
    const iter = await makeIteration(projectA.id, `projects/${projectA.id}/iterations/a.png`, 1);

    const agent = await loginAsUserA();
    const res = await agent.patch(`/api/projects/${projectB.id}/iterations/${iter.id}`).send({ accepted: true });
    expect(res.status).toBe(404);
    expect(mockSetIterationState).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/projects/:id/iterations/:iterId -- remove_iteration (OOP follow-up, 2026-07-15)', () => {
  it('deletes the Iteration row through the remove_iteration tool, not raw Prisma', async () => {
    const project = await makeProject(userAId, `${marker}-iter-delete`);
    const iter = await makeIteration(project.id, `projects/${project.id}/iterations/a.png`, 1);

    const agent = await loginAsUserA();
    const res = await agent.delete(`/api/projects/${project.id}/iterations/${iter.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: iter.id, deleted: true });
    expect(mockRemoveIteration).toHaveBeenCalledTimes(1);
    expect(mockRemoveIteration.mock.calls[0][0]).toMatchObject({ iterationId: iter.id });

    const gone = await prisma.iteration.findUnique({ where: { id: iter.id } });
    expect(gone).toBeNull();
  });

  it('returns 404 for an iteration id that does not belong to the named project, without calling remove_iteration', async () => {
    const projectA = await makeProject(userAId, `${marker}-iter-delete-mismatch-a`);
    const projectB = await makeProject(userAId, `${marker}-iter-delete-mismatch-b`);
    const iter = await makeIteration(projectA.id, `projects/${projectA.id}/iterations/a.png`, 1);

    const agent = await loginAsUserA();
    const res = await agent.delete(`/api/projects/${projectB.id}/iterations/${iter.id}`);

    expect(res.status).toBe(404);
    expect(mockRemoveIteration).not.toHaveBeenCalled();

    const stillThere = await prisma.iteration.findUnique({ where: { id: iter.id } });
    expect(stillThere).not.toBeNull();
  });

  it('returns 404 for an iteration id that does not exist at all', async () => {
    const project = await makeProject(userAId, `${marker}-iter-delete-missing`);
    const agent = await loginAsUserA();
    const res = await agent.delete(`/api/projects/${project.id}/iterations/999999999`);
    expect(res.status).toBe(404);
    expect(mockRemoveIteration).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-numeric project or iteration id', async () => {
    const agent = await loginAsUserA();
    const res = await agent.delete('/api/projects/not-a-number/iterations/1');
    expect(res.status).toBe(400);
    expect(mockRemoveIteration).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await request(server).delete('/api/projects/1/iterations/1');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/projects/:id -- archive/restore (OOP follow-up, 2026-07-15)', () => {
  it('archives an active project through create_project, not raw Prisma', async () => {
    const project = await makeProject(userAId, `${marker}-patch-archive`);
    const agent = await loginAsUserA();

    const res = await agent.patch(`/api/projects/${project.id}`).send({ status: 'archived' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('archived');
    expect(mockCreateProject).toHaveBeenCalledTimes(1);
    expect(mockCreateProject.mock.calls[0][0]).toMatchObject({ id: project.id, status: 'archived' });

    const persisted = await prisma.project.findUnique({ where: { id: project.id } });
    expect(persisted?.status).toBe('archived');
  });

  it('restores an archived project back to active', async () => {
    const project = await makeProject(userAId, `${marker}-patch-restore`, 'archived');
    const agent = await loginAsUserA();

    const res = await agent.patch(`/api/projects/${project.id}`).send({ status: 'active' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');

    const persisted = await prisma.project.findUnique({ where: { id: project.id } });
    expect(persisted?.status).toBe('active');
  });

  it('rejects an invalid status value with 400, without calling create_project', async () => {
    const project = await makeProject(userAId, `${marker}-patch-bad-status`);
    const agent = await loginAsUserA();

    const res = await agent.patch(`/api/projects/${project.id}`).send({ status: 'deleted' });

    expect(res.status).toBe(400);
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it('returns 404 for a project that does not exist, without calling create_project', async () => {
    const agent = await loginAsUserA();
    const res = await agent.patch('/api/projects/999999999').send({ status: 'archived' });
    expect(res.status).toBe(404);
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-numeric project id', async () => {
    const agent = await loginAsUserA();
    const res = await agent.patch('/api/projects/not-a-number').send({ status: 'archived' });
    expect(res.status).toBe(400);
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request with 401', async () => {
    const project = await makeProject(userAId, `${marker}-patch-unauth`);
    const res = await request(server).patch(`/api/projects/${project.id}`).send({ status: 'archived' });
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/projects/:id -- bulk delete (OOP follow-up, 2026-07-15)', () => {
  it('deletes the Project row through the remove_project tool, not raw Prisma', async () => {
    const project = await makeProject(userAId, `${marker}-delete-project`);
    const iter = await makeIteration(project.id, `projects/${project.id}/iterations/a.png`, 1);
    const agent = await loginAsUserA();

    const res = await agent.delete(`/api/projects/${project.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: project.id, deleted: true });
    expect(mockRemoveProject).toHaveBeenCalledTimes(1);
    expect(mockRemoveProject.mock.calls[0][0]).toMatchObject({ projectId: project.id });

    expect(await prisma.project.findUnique({ where: { id: project.id } })).toBeNull();
    expect(await prisma.iteration.findUnique({ where: { id: iter.id } })).toBeNull();
  });

  it('returns 404 for a project that does not exist, without calling remove_project', async () => {
    const agent = await loginAsUserA();
    const res = await agent.delete('/api/projects/999999999');
    expect(res.status).toBe(404);
    expect(mockRemoveProject).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-numeric project id', async () => {
    const agent = await loginAsUserA();
    const res = await agent.delete('/api/projects/not-a-number');
    expect(res.status).toBe(400);
    expect(mockRemoveProject).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await request(server).delete('/api/projects/1');
    expect(res.status).toBe(401);
  });
});

describe('cross-user access (shared-trust model -- architecture-001 Security Considerations)', () => {
  it('userB can read and act on userA\'s project (no per-user isolation below USER/ADMIN)', async () => {
    const project = await makeProject(userAId, `${marker}-shared`);
    const iter = await makeIteration(project.id, `projects/${project.id}/iterations/a.png`, 1);

    const agentB = await loginAsUserB();
    const getRes = await agentB.get(`/api/projects/${project.id}`);
    expect(getRes.status).toBe(200);

    const patchRes = await agentB.patch(`/api/projects/${project.id}/iterations/${iter.id}`).send({ accepted: true });
    expect(patchRes.status).toBe(200);
  });
});

/**
 * Coverage for `POST /api/postcards/:projectId/pdf` (ticket 006): reading
 * back the currently-persisted `postcard-content.json`, rendering
 * front(+back) HTML for `postcardPdf.ts` to rasterize, persisting
 * `postcard.pdf` via `create_agent_page`, and streaming the PDF bytes back
 * in the response.
 *
 * `postcardPdf.ts`'s `renderPostcardPdf` is mocked entirely here (no real
 * Chromium, no real raster/pad/assemble pipeline -- that's
 * `postcard-pdf.test.ts`'s job) so this file only exercises the route's
 * own logic: auth gate, "no content submitted yet" 404, front-only vs.
 * front+back HTML composition handed to the pipeline, the
 * front_image-required 400, persistence, and the HTTP response shape
 * (status, `Content-Type`, body bytes). Follows
 * `tests/server/postcard-route.test.ts`'s scratch-`WORKSPACE_DIR` /
 * `WORKSPACE_GIT_ROOT` pattern exactly (same reason: the route calls
 * `create_agent_page` without a fake `VersioningRecorder`, matching
 * production wiring).
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';

const mockRenderPostcardPdf = vi.hoisted(() => vi.fn());

vi.mock('../../server/src/services/postcardPdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/src/services/postcardPdf')>();
  return {
    ...actual,
    renderPostcardPdf: (...args: unknown[]) => mockRenderPostcardPdf(...args),
  };
});

const marker = `t006postcardpdf${Date.now()}`;

let testRoot: string;
let previousWorkspaceDir: string | undefined;
let previousWorkspaceGitRoot: string | undefined;

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'flyerbot-postcard-pdf-route-test-'));
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
let resolveWorkspacePath: typeof import('../../server/src/services/workspaceDirectorySync').resolveWorkspacePath;

beforeAll(async () => {
  app = (await import('../../server/src/app')).default;
  prisma = (await import('../../server/src/services/prisma')).prisma;
  resolveWorkspacePath = (await import('../../server/src/services/workspaceDirectorySync')).resolveWorkspacePath;
});

let adminUserId: number;
let regularUserId: number;
let ownerId: number;

const cleanup = {
  iterationIds: [] as number[],
  projectIds: [] as number[],
};

beforeAll(async () => {
  const admin = await (await import('../../server/src/services/prisma')).prisma.user.create({
    data: {
      email: `${marker}-admin@example.com`,
      displayName: 'Postcard PDF Route Admin',
      role: 'ADMIN',
      provider: 'test',
      providerId: `${marker}-admin`,
    },
  });
  adminUserId = admin.id;

  const regular = await (await import('../../server/src/services/prisma')).prisma.user.create({
    data: {
      email: `${marker}-user@example.com`,
      displayName: 'Postcard PDF Route User',
      role: 'USER',
      provider: 'test',
      providerId: `${marker}-user`,
    },
  });
  regularUserId = regular.id;

  const owner = await (await import('../../server/src/services/prisma')).prisma.user.create({
    data: { email: `${marker}-owner@example.com`, displayName: 'Postcard PDF Project Owner' },
  });
  ownerId = owner.id;
});

afterAll(async () => {
  await prisma.iteration.deleteMany({ where: { projectId: { in: cleanup.projectIds } } });
  await prisma.project.deleteMany({ where: { id: { in: cleanup.projectIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminUserId, regularUserId, ownerId] } } });
});

async function makeProject(title: string) {
  const project = await prisma.project.create({ data: { title, ownerUserId: ownerId } });
  cleanup.projectIds.push(project.id);
  return project;
}

async function makeIteration(projectId: number, imagePath: string, seq: number) {
  const iteration = await prisma.iteration.create({
    data: { projectId, seq, imagePath, promptUsed: 'fixture' },
  });
  cleanup.iterationIds.push(iteration.id);
  return iteration;
}

async function loginAsAdmin() {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({
    email: `${marker}-admin@example.com`,
    displayName: 'Postcard PDF Route Admin',
    role: 'ADMIN',
  });
  return agent;
}

async function loginAsUser() {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({
    email: `${marker}-user@example.com`,
    displayName: 'Postcard PDF Route User',
    role: 'USER',
  });
  return agent;
}

const FAKE_PDF_BYTES = Buffer.from('%PDF-1.7 fake postcard pdf for route tests');

describe('POST /api/postcards/:projectId/pdf -- auth gate', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const res = await request(app).post('/api/postcards/1/pdf');
    expect(res.status).toBe(401);
  });

  it('rejects a non-admin authenticated request with 403', async () => {
    const agent = await loginAsUser();
    const res = await agent.post('/api/postcards/1/pdf');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/postcards/:projectId/pdf -- no content submitted yet', () => {
  it('returns 404 when postcard-content.json was never PUT for this project', async () => {
    const project = await makeProject(`${marker}-no-content`);
    const agent = await loginAsAdmin();
    const res = await agent.post(`/api/postcards/${project.id}/pdf`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(new RegExp(String(project.id)));
  });

  it('returns 404 for a project that does not exist', async () => {
    const agent = await loginAsAdmin();
    const res = await agent.post('/api/postcards/999999999/pdf');
    expect(res.status).toBe(404);
  });

  it('returns 400 for a non-numeric project id', async () => {
    const agent = await loginAsAdmin();
    const res = await agent.post('/api/postcards/not-a-number/pdf');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/postcards/:projectId/pdf -- front-only PDF', () => {
  it('renders, persists, and streams back the PDF for a front-only project', async () => {
    mockRenderPostcardPdf.mockReset();
    mockRenderPostcardPdf.mockResolvedValue(FAKE_PDF_BYTES);

    const project = await makeProject(`${marker}-front-only`);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-1.png`, 1);

    const agent = await loginAsAdmin();
    const putRes = await agent.put(`/api/postcards/${project.id}`).send({
      front_image: `projects/${project.id}/iterations/iter-1.png`,
      front_regions: [],
    });
    expect(putRes.status).toBe(200);

    const pdfRes = await agent.post(`/api/postcards/${project.id}/pdf`);
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers['content-type']).toMatch(/application\/pdf/);
    expect(Buffer.from(pdfRes.body)).toEqual(FAKE_PDF_BYTES);

    // Only one call, with a front-only face doc (no back).
    expect(mockRenderPostcardPdf).toHaveBeenCalledTimes(1);
    const [faces] = mockRenderPostcardPdf.mock.calls[0] as [{ front: string; back?: string }];
    expect(faces.front).toContain('data-side="front"');
    expect(faces.front).not.toContain('data-side="back"');
    expect(faces.back).toBeUndefined();

    const persistedPath = resolveWorkspacePath(`projects/${project.id}/outputs/postcard.pdf`);
    const persisted = await fs.readFile(persistedPath);
    expect(persisted).toEqual(FAKE_PDF_BYTES);
  });
});

describe('POST /api/postcards/:projectId/pdf -- front+back PDF', () => {
  it('hands both face docs to the pipeline in front-then-back composition', async () => {
    mockRenderPostcardPdf.mockReset();
    mockRenderPostcardPdf.mockResolvedValue(FAKE_PDF_BYTES);

    const project = await makeProject(`${marker}-front-back`);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-1.png`, 1);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-2.png`, 2);

    const agent = await loginAsAdmin();
    await agent.put(`/api/postcards/${project.id}`).send({
      front_image: `projects/${project.id}/iterations/iter-1.png`,
      back_image: `projects/${project.id}/iterations/iter-2.png`,
      back_extra_html: '<div><img src="qr.png"></div>',
    });

    const pdfRes = await agent.post(`/api/postcards/${project.id}/pdf`);
    expect(pdfRes.status).toBe(200);

    const [faces] = mockRenderPostcardPdf.mock.calls[0] as [{ front: string; back?: string }];
    expect(faces.front).toContain('data-side="front"');
    expect(faces.front).not.toContain('data-side="back"');
    expect(faces.back).toContain('data-side="back"');
    expect(faces.back).not.toContain('data-side="front"');
    expect(faces.back).toContain('<img src="qr.png">');
  });
});

describe('POST /api/postcards/:projectId/pdf -- back-only content (front_image required for PDF export)', () => {
  it('returns 400 when the persisted content has no front_image', async () => {
    mockRenderPostcardPdf.mockReset();

    const project = await makeProject(`${marker}-back-only`);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-1.png`, 1);

    const agent = await loginAsAdmin();
    const putRes = await agent.put(`/api/postcards/${project.id}`).send({
      back_image: `projects/${project.id}/iterations/iter-1.png`,
    });
    expect(putRes.status).toBe(200);

    const pdfRes = await agent.post(`/api/postcards/${project.id}/pdf`);
    expect(pdfRes.status).toBe(400);
    expect(pdfRes.body.error).toMatch(/front_image/);
    expect(mockRenderPostcardPdf).not.toHaveBeenCalled();
  });
});

describe('POST /api/postcards/:projectId/pdf -- re-generation overwrites in place', () => {
  it('overwrites the persisted postcard.pdf on a second call, recording a fresh Iteration each time', async () => {
    mockRenderPostcardPdf.mockReset();
    mockRenderPostcardPdf
      .mockResolvedValueOnce(Buffer.from('first-pdf'))
      .mockResolvedValueOnce(Buffer.from('second-pdf'));

    const project = await makeProject(`${marker}-regen`);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-1.png`, 1);

    const agent = await loginAsAdmin();
    await agent.put(`/api/postcards/${project.id}`).send({
      front_image: `projects/${project.id}/iterations/iter-1.png`,
    });

    const first = await agent.post(`/api/postcards/${project.id}/pdf`);
    expect(Buffer.from(first.body)).toEqual(Buffer.from('first-pdf'));
    const countAfterFirst = await prisma.iteration.count({ where: { projectId: project.id } });

    const second = await agent.post(`/api/postcards/${project.id}/pdf`);
    expect(Buffer.from(second.body)).toEqual(Buffer.from('second-pdf'));
    const countAfterSecond = await prisma.iteration.count({ where: { projectId: project.id } });
    expect(countAfterSecond).toBe(countAfterFirst + 1);

    const persistedPath = resolveWorkspacePath(`projects/${project.id}/outputs/postcard.pdf`);
    const persisted = await fs.readFile(persistedPath);
    expect(persisted).toEqual(Buffer.from('second-pdf'));

    const allIterations = await prisma.iteration.findMany({ where: { projectId: project.id } });
    for (const it of allIterations) cleanup.iterationIds.push(it.id);
  });
});

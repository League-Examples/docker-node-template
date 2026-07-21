/**
 * Coverage for `POST /api/postcards/:projectId/pdf` (ticket 006): reading
 * back the currently-persisted `postcard-content.json`, rendering
 * front(+back) HTML for `postcardPdf.ts` to rasterize, persisting
 * `postcard.pdf` via `create_agent_page`, and streaming the PDF bytes back
 * in the response. Also covers this same ticket's auth-gate relaxation to
 * `requireAuth`-only (see `server/src/routes/postcards.ts`'s module
 * header).
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
  server = await startTestServer(app);
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
  const agent = request.agent(server);
  await agent.post('/api/auth/test-login').send({
    email: `${marker}-admin@example.com`,
    displayName: 'Postcard PDF Route Admin',
    role: 'ADMIN',
  });
  return agent;
}

async function loginAsUser() {
  const agent = request.agent(server);
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
    const res = await request(server).post('/api/postcards/1/pdf');
    expect(res.status).toBe(401);
  });

  it('allows a non-admin authenticated request past the auth gate (ticket 006: requireAdmin dropped)', async () => {
    const agent = await loginAsUser();
    // No `postcard-content.json` submitted for this project yet -- the
    // gate itself no longer rejects a non-admin caller, so this resolves
    // to the route's own "no content submitted yet" 404, not a 401/403.
    const res = await agent.post('/api/postcards/999999999/pdf');
    expect(res.status).toBe(404);
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

describe('POST /api/postcards/:projectId/pdf -- rasterizer failure is handled, not fatal', () => {
  it('returns 500 (never crashes) when the PDF rasterizer throws, e.g. no browser on the host', async () => {
    mockRenderPostcardPdf.mockReset();
    mockRenderPostcardPdf.mockRejectedValue(
      new Error('Browser was not found at the configured executablePath (/usr/bin/chromium-browser)'),
    );

    const project = await makeProject(`${marker}-rasterizer-throws`);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-1.png`, 1);

    const agent = await loginAsAdmin();
    const putRes = await agent.put(`/api/postcards/${project.id}`).send({
      front_image: `projects/${project.id}/iterations/iter-1.png`,
      front_regions: [],
    });
    expect(putRes.status).toBe(200);

    const pdfRes = await agent.post(`/api/postcards/${project.id}/pdf`);
    expect(pdfRes.status).toBe(500);
    expect(pdfRes.body.error).toMatch(/failed to generate postcard pdf/i);

    // The server is still alive: a follow-up request succeeds.
    const healthRes = await agent.get('/api/health');
    expect(healthRes.status).toBe(200);
  });
});

describe('POST /api/postcards/:projectId/pdf -- non-admin authenticated user (ticket 006)', () => {
  it('a USER-role authenticated caller can request and receive a postcard PDF end to end', async () => {
    mockRenderPostcardPdf.mockReset();
    mockRenderPostcardPdf.mockResolvedValue(FAKE_PDF_BYTES);

    const project = await makeProject(`${marker}-nonadmin`);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-1.png`, 1);

    const agent = await loginAsUser();
    const putRes = await agent.put(`/api/postcards/${project.id}`).send({
      front_image: `projects/${project.id}/iterations/iter-1.png`,
      front_regions: [],
    });
    expect(putRes.status).toBe(200);

    const pdfRes = await agent.post(`/api/postcards/${project.id}/pdf`);
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers['content-type']).toMatch(/application\/pdf/);
    expect(Buffer.from(pdfRes.body)).toEqual(FAKE_PDF_BYTES);
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
  it('overwrites the persisted postcard.pdf on a second call, without recording any Iteration rows (OOP follow-up, 2026-07-15)', async () => {
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
    // `postcards.ts` passes `recordIteration: false` to `create_agent_page`
    // for postcard.pdf too -- neither PDF generation adds an Iteration row,
    // only the one fixture row created above remains.
    expect(countAfterSecond).toBe(countAfterFirst);
    expect(countAfterSecond).toBe(1);

    const persistedPath = resolveWorkspacePath(`projects/${project.id}/outputs/postcard.pdf`);
    const persisted = await fs.readFile(persistedPath);
    expect(persisted).toEqual(Buffer.from('second-pdf'));
  });
});

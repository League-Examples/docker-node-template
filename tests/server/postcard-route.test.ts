/**
 * Coverage for the Postcard Render & PDF Service's first half (ticket
 * 005): `server/src/services/postcardRender.ts`'s content-JSON
 * validation/HTML templating, and `server/src/routes/postcards.ts`'s
 * `PUT /api/postcards/:projectId` route -- auth gate (AC7, relaxed to
 * `requireAuth`-only in ticket 006 -- see that file's module header), the
 * validate-then-persist-then-render-then-persist flow (AC1-5), and the
 * bad-image-reference validation error (AC6).
 *
 * Route tests run against the real Prisma test database (fixture
 * `Project`/`Iteration` rows, no real image generation) and a scratch
 * `WORKSPACE_DIR` (never the real `server/workspace/` tree), following
 * `tests/server/agent-mcp-catalog-tools.test.ts`'s pattern -- assertions
 * read the persisted `postcard-content.json`/`postcard.html` files
 * straight off disk.
 *
 * The route calls `create_agent_page` without injecting a fake
 * `VersioningRecorder` (that's the production wiring -- `postcards.ts`
 * exposes no DI knob, matching `routes/chat.ts`), so `WORKSPACE_GIT_ROOT`
 * is also pointed at this file's scratch directory (matching
 * `WORKSPACE_DIR`) before `app.ts` is ever imported below -- otherwise the
 * real `WorkspaceVersioningService` singleton's `recordChange` throws
 * "Path escapes WORKSPACE_GIT_ROOT" for every write (`versioning.ts`'s
 * containment check). `recordChange` itself never runs a git command (it
 * only queues the path; `commitTurn` is what shells out, and nothing in
 * this route calls it), so this is a safe, no-op-for-git env var --
 * unlike `tests/server/versioning.test.ts`, no scratch git repo needs to
 * be initialized here.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';

const marker = `t005postcard${Date.now()}`;

let testRoot: string;
let previousWorkspaceDir: string | undefined;
let previousWorkspaceGitRoot: string | undefined;

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'flyerbot-postcard-route-test-'));
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

// Imported after WORKSPACE_DIR is set on process.env above, but these are
// only used for direct-DB fixture setup/teardown and reading files back --
// `resolveWorkspacePath` re-reads `process.env.WORKSPACE_DIR` on every call
// (see its own header), so import order here doesn't matter for it.
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
      displayName: 'Postcard Route Admin',
      role: 'ADMIN',
      provider: 'test',
      providerId: `${marker}-admin`,
    },
  });
  adminUserId = admin.id;

  const regular = await (await import('../../server/src/services/prisma')).prisma.user.create({
    data: {
      email: `${marker}-user@example.com`,
      displayName: 'Postcard Route User',
      role: 'USER',
      provider: 'test',
      providerId: `${marker}-user`,
    },
  });
  regularUserId = regular.id;

  const owner = await (await import('../../server/src/services/prisma')).prisma.user.create({
    data: { email: `${marker}-owner@example.com`, displayName: 'Postcard Project Owner' },
  });
  ownerId = owner.id;
});

afterAll(async () => {
  // Delete every Iteration under a tracked project, not just the ones this
  // file created directly via `makeIteration` -- the route itself creates
  // further Iteration rows on every `create_agent_page` call
  // (postcard-content.json + postcard.html, per submission), which would
  // otherwise be left behind and violate the Project FK below.
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
    displayName: 'Postcard Route Admin',
    role: 'ADMIN',
  });
  return agent;
}

async function loginAsUser() {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({
    email: `${marker}-user@example.com`,
    displayName: 'Postcard Route User',
    role: 'USER',
  });
  return agent;
}

function region(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: 'headline',
    label: 'Headline',
    style: 'font-weight:900; color:#CC1616;',
    text: 'ROBOT RIOT\n\n',
    rows: null,
    position: { top: '1.0in', left: '0.5in', width: '3.4in' },
    font: { family: "'Arial Black', Arial, sans-serif", size: '34px' },
    ...overrides,
  };
}

describe('PUT /api/postcards/:projectId -- auth gate (AC7)', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const res = await request(app).put('/api/postcards/1').send({ front_image: 'x' });
    expect(res.status).toBe(401);
  });

  it('allows a non-admin authenticated user to submit a postcard (ticket 006: requireAdmin dropped)', async () => {
    const project = await makeProject(`${marker}-nonadmin-put`);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-1.png`, 1);

    const agent = await loginAsUser();
    const res = await agent.put(`/api/postcards/${project.id}`).send({
      front_image: `projects/${project.id}/iterations/iter-1.png`,
      front_regions: [],
    });

    expect(res.status).toBe(200);
    expect(res.body.contentPath).toBe(`projects/${project.id}/outputs/postcard-content.json`);
  });
});

describe('PUT /api/postcards/:projectId -- front-only render (AC1)', () => {
  it('persists postcard-content.json and renders only the front face', async () => {
    const project = await makeProject(`${marker}-front-only`);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-1.png`, 1);

    const agent = await loginAsAdmin();
    const res = await agent.put(`/api/postcards/${project.id}`).send({
      front_image: `projects/${project.id}/iterations/iter-1.png`,
      front_regions: [region()],
    });

    expect(res.status).toBe(200);
    expect(res.body.contentPath).toBe(`projects/${project.id}/outputs/postcard-content.json`);
    expect(res.body.htmlPath).toBe(`projects/${project.id}/outputs/postcard.html`);

    const persistedContent = JSON.parse(
      await fs.readFile(resolveWorkspacePath(res.body.contentPath), 'utf8')
    );
    expect(persistedContent.front_image).toBe(`projects/${project.id}/iterations/iter-1.png`);
    expect(persistedContent.back_image).toBeUndefined();

    const html = await fs.readFile(resolveWorkspacePath(res.body.htmlPath), 'utf8');
    expect(html).toContain(`data-side="front"`);
    expect(html).not.toContain(`data-side="back"`);
    expect(html).toContain(`projects/${project.id}/iterations/iter-1.png`);
  });
});

describe('PUT /api/postcards/:projectId -- front+back render (AC2)', () => {
  it('renders both faces when both images are present', async () => {
    const project = await makeProject(`${marker}-front-back`);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-1.png`, 1);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-2.png`, 2);

    const agent = await loginAsAdmin();
    const res = await agent.put(`/api/postcards/${project.id}`).send({
      front_image: `projects/${project.id}/iterations/iter-1.png`,
      back_image: `projects/${project.id}/iterations/iter-2.png`,
      front_regions: [region({ name: 'front_headline' })],
      back_regions: [region({ name: 'back_headline' })],
    });

    expect(res.status).toBe(200);
    const html = await fs.readFile(resolveWorkspacePath(res.body.htmlPath), 'utf8');
    expect(html).toContain(`data-side="front"`);
    expect(html).toContain(`data-side="back"`);
    expect(html).toContain(`data-region="front_headline"`);
    expect(html).toContain(`data-region="back_headline"`);
  });
});

describe('PUT /api/postcards/:projectId -- region position/font fidelity (AC3)', () => {
  it('renders each region\'s position and font values verbatim', async () => {
    const project = await makeProject(`${marker}-region-fidelity`);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-1.png`, 1);

    const agent = await loginAsAdmin();
    const res = await agent.put(`/api/postcards/${project.id}`).send({
      front_image: `projects/${project.id}/iterations/iter-1.png`,
      front_regions: [
        region({
          name: 'body',
          position: { top: '1.86in', right: '0.5in', width: '3.4in', height: '2in' },
          font: { family: 'Georgia, serif', size: '15.5px' },
        }),
      ],
    });

    expect(res.status).toBe(200);
    const html = await fs.readFile(resolveWorkspacePath(res.body.htmlPath), 'utf8');
    expect(html).toContain('top:1.86in');
    expect(html).toContain('right:0.5in');
    expect(html).toContain('width:3.4in');
    expect(html).toContain('height:2in');
    expect(html).toContain('overflow:hidden');
    expect(html).toContain('font-family:Georgia, serif');
    expect(html).toContain('font-size:15.5px');
  });
});

describe('PUT /api/postcards/:projectId -- extra_html QR overlay (AC4)', () => {
  it('includes extra_html verbatim in the rendered face', async () => {
    const project = await makeProject(`${marker}-extra-html`);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-1.png`, 1);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-2.png`, 2);

    const qrHtml = '<div style="position:absolute; top:1.15in; right:0.5in;"><img src="sources/qr.png"></div>';

    const agent = await loginAsAdmin();
    const res = await agent.put(`/api/postcards/${project.id}`).send({
      front_image: `projects/${project.id}/iterations/iter-1.png`,
      back_image: `projects/${project.id}/iterations/iter-2.png`,
      back_extra_html: qrHtml,
    });

    expect(res.status).toBe(200);
    const html = await fs.readFile(resolveWorkspacePath(res.body.htmlPath), 'utf8');
    expect(html).toContain(qrHtml);
  });
});

describe('PUT /api/postcards/:projectId -- front_qr/back_qr overlay (OOP: addable/deletable/movable QR)', () => {
  it('persists and renders a structured front_qr, and omits the QR overlay entirely when absent', async () => {
    const project = await makeProject(`${marker}-qr-front`);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-1.png`, 1);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-2.png`, 2);

    const agent = await loginAsAdmin();
    const res = await agent.put(`/api/postcards/${project.id}`).send({
      front_image: `projects/${project.id}/iterations/iter-1.png`,
      back_image: `projects/${project.id}/iterations/iter-2.png`,
      front_qr: {
        url: 'https://example.org/rsvp',
        position: { top: '1.15in', right: '0.5in', width: '1.5in', height: '1.5in' },
      },
    });

    expect(res.status).toBe(200);
    const persistedContent = JSON.parse(
      await fs.readFile(resolveWorkspacePath(res.body.contentPath), 'utf8')
    );
    expect(persistedContent.front_qr.url).toBe('https://example.org/rsvp');
    expect(persistedContent.back_qr).toBeUndefined();

    const html = await fs.readFile(resolveWorkspacePath(res.body.htmlPath), 'utf8');
    const frontSection = html.split('data-side="front"')[1].split('data-side="back"')[0];
    const backSection = html.split('data-side="back"')[1];
    expect(frontSection).toContain('data-qr-url="https://example.org/rsvp"');
    expect(backSection).not.toContain('data-qr-url');
  });

  it('rejects a QR position with neither left nor right', async () => {
    const project = await makeProject(`${marker}-qr-bad-position`);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-1.png`, 1);

    const agent = await loginAsAdmin();
    const res = await agent.put(`/api/postcards/${project.id}`).send({
      front_image: `projects/${project.id}/iterations/iter-1.png`,
      front_qr: { url: 'https://example.org', position: { top: '1in', width: '1.5in' } },
    });

    expect(res.status).toBe(400);
  });
});

describe('PUT /api/postcards/:projectId -- re-submission overwrites (AC5)', () => {
  it('overwrites the persisted files in place while recording a fresh Iteration each time', async () => {
    const project = await makeProject(`${marker}-resubmit`);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-1.png`, 1);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-2.png`, 2);

    const agent = await loginAsAdmin();

    const first = await agent.put(`/api/postcards/${project.id}`).send({
      front_image: `projects/${project.id}/iterations/iter-1.png`,
      front_regions: [region({ text: 'FIRST VERSION' })],
    });
    expect(first.status).toBe(200);

    const iterationCountAfterFirst = await prisma.iteration.count({ where: { projectId: project.id } });

    const second = await agent.put(`/api/postcards/${project.id}`).send({
      front_image: `projects/${project.id}/iterations/iter-2.png`,
      front_regions: [region({ text: 'SECOND VERSION' })],
    });
    expect(second.status).toBe(200);

    // Same path both times -- overwritten in place, not a second file.
    expect(second.body.contentPath).toBe(first.body.contentPath);
    expect(second.body.htmlPath).toBe(first.body.htmlPath);

    const html = await fs.readFile(resolveWorkspacePath(second.body.htmlPath), 'utf8');
    expect(html).toContain('SECOND VERSION');
    expect(html).not.toContain('FIRST VERSION');

    const content = JSON.parse(await fs.readFile(resolveWorkspacePath(second.body.contentPath), 'utf8'));
    expect(content.front_image).toBe(`projects/${project.id}/iterations/iter-2.png`);

    // create_agent_page's existing, unmodified behavior: each call inserts
    // a fresh Iteration provenance row (two files x two submissions = 4).
    const iterationCountAfterSecond = await prisma.iteration.count({ where: { projectId: project.id } });
    expect(iterationCountAfterSecond).toBe(iterationCountAfterFirst + 2);

    const allIterations = await prisma.iteration.findMany({ where: { projectId: project.id } });
    for (const it of allIterations) cleanup.iterationIds.push(it.id);
  });
});

describe('PUT /api/postcards/:projectId -- bad image reference (AC6)', () => {
  it('returns a 400 validation error rather than persisting anything, when front_image matches no Iteration', async () => {
    const project = await makeProject(`${marker}-bad-image`);

    const agent = await loginAsAdmin();
    const res = await agent.put(`/api/postcards/${project.id}`).send({
      front_image: `projects/${project.id}/iterations/does-not-exist.png`,
      front_regions: [],
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/front_image/);
    expect(res.body.error).toMatch(/does-not-exist\.png/);

    const outputsDir = resolveWorkspacePath(`projects/${project.id}/outputs`);
    await expect(fs.access(outputsDir)).rejects.toThrow();
  });

  it('returns a 400 validation error when back_image matches no Iteration', async () => {
    const project = await makeProject(`${marker}-bad-back-image`);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-1.png`, 1);

    const agent = await loginAsAdmin();
    const res = await agent.put(`/api/postcards/${project.id}`).send({
      front_image: `projects/${project.id}/iterations/iter-1.png`,
      back_image: `projects/${project.id}/iterations/nope.png`,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/back_image/);
  });
});

describe('PUT /api/postcards/:projectId -- malformed content JSON', () => {
  it('returns a 400 when the body fails shape validation', async () => {
    const project = await makeProject(`${marker}-malformed`);

    const agent = await loginAsAdmin();
    const res = await agent.put(`/api/postcards/${project.id}`).send({
      front_regions: [{ name: 'bad' }], // missing required fields, no front_image/back_image at all
    });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('returns a 400 for a non-numeric project id', async () => {
    const agent = await loginAsAdmin();
    const res = await agent.put('/api/postcards/not-a-number').send({ front_image: 'x' });
    expect(res.status).toBe(400);
  });

  it('returns a 404 for a project that does not exist', async () => {
    const agent = await loginAsAdmin();
    const res = await agent.put('/api/postcards/999999999').send({
      front_image: 'projects/999999999/iterations/iter-1.png',
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/postcards/:projectId -- read-back for the editor (OOP follow-up, 2026-07-15)', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const res = await request(app).get('/api/postcards/1');
    expect(res.status).toBe(401);
  });

  it('returns { content: null } for a project with no prior PUT', async () => {
    const project = await makeProject(`${marker}-get-nothing-saved`);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-1.png`, 1);

    const agent = await loginAsUser();
    const res = await agent.get(`/api/postcards/${project.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: null });
  });

  it('round-trips: GET returns exactly what a prior PUT persisted', async () => {
    const project = await makeProject(`${marker}-get-roundtrip`);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-1.png`, 1);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-2.png`, 2);

    const agent = await loginAsUser();
    const putRes = await agent.put(`/api/postcards/${project.id}`).send({
      front_image: `projects/${project.id}/iterations/iter-1.png`,
      back_image: `projects/${project.id}/iterations/iter-2.png`,
      front_regions: [region({ name: 'front_headline' })],
      front_qr: {
        url: 'https://example.org/rsvp',
        position: { top: '1.15in', right: '0.5in', width: '1.5in', height: '1.5in' },
      },
    });
    expect(putRes.status).toBe(200);

    const getRes = await agent.get(`/api/postcards/${project.id}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.content.front_image).toBe(`projects/${project.id}/iterations/iter-1.png`);
    expect(getRes.body.content.back_image).toBe(`projects/${project.id}/iterations/iter-2.png`);
    expect(getRes.body.content.front_regions).toHaveLength(1);
    expect(getRes.body.content.front_regions[0].name).toBe('front_headline');
    expect(getRes.body.content.front_qr).toEqual({
      url: 'https://example.org/rsvp',
      position: { top: '1.15in', right: '0.5in', width: '1.5in', height: '1.5in' },
    });
    expect(getRes.body.content.back_qr).toBeUndefined();
  });

  it('reflects a re-submission -- GET after a second PUT returns the newest content, not the first', async () => {
    const project = await makeProject(`${marker}-get-resubmit`);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-1.png`, 1);
    await makeIteration(project.id, `projects/${project.id}/iterations/iter-2.png`, 2);

    const agent = await loginAsAdmin();
    await agent.put(`/api/postcards/${project.id}`).send({
      front_image: `projects/${project.id}/iterations/iter-1.png`,
      front_regions: [region({ text: 'FIRST VERSION' })],
    });
    await agent.put(`/api/postcards/${project.id}`).send({
      front_image: `projects/${project.id}/iterations/iter-2.png`,
      front_regions: [region({ text: 'SECOND VERSION' })],
    });

    const getRes = await agent.get(`/api/postcards/${project.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.content.front_image).toBe(`projects/${project.id}/iterations/iter-2.png`);
    expect(getRes.body.content.front_regions[0].text).toBe('SECOND VERSION');

    const allIterations = await prisma.iteration.findMany({ where: { projectId: project.id } });
    for (const it of allIterations) cleanup.iterationIds.push(it.id);
  });

  it('returns a 400 for a non-numeric project id', async () => {
    const agent = await loginAsAdmin();
    const res = await agent.get('/api/postcards/not-a-number');
    expect(res.status).toBe(400);
  });

  it('returns a 404 for a project that does not exist', async () => {
    const agent = await loginAsAdmin();
    const res = await agent.get('/api/postcards/999999999');
    expect(res.status).toBe(404);
  });
});

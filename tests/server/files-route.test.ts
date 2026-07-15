/**
 * Coverage for `GET /api/files/*` (ticket 004): the workspace
 * file-serving route -- the only HTTP path that streams `workspace/`
 * bytes to the browser (architecture-update.md R7). Every image surface
 * in the promoted UI depends on this route, so its own coverage is
 * disproportionately important relative to its size (Risks section) --
 * in particular the traversal-rejection test, since `resolveWorkspacePath`
 * containment is this route's only defense against reading arbitrary
 * files off disk.
 *
 * Follows `tests/server/postcard-pdf-route.test.ts`'s scratch-
 * `WORKSPACE_DIR` pattern: point the env var at a temp directory per
 * run so tests never touch the real `workspace/` tree.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';

let testRoot: string;
let previousWorkspaceDir: string | undefined;

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'flyerbot-files-route-test-'));
  previousWorkspaceDir = process.env.WORKSPACE_DIR;
  process.env.WORKSPACE_DIR = testRoot;
});

afterAll(async () => {
  if (previousWorkspaceDir === undefined) {
    delete process.env.WORKSPACE_DIR;
  } else {
    process.env.WORKSPACE_DIR = previousWorkspaceDir;
  }
  await fs.rm(testRoot, { recursive: true, force: true });
});

let app: typeof import('../../server/src/app').default;
let prisma: typeof import('../../server/src/services/prisma').prisma;

beforeAll(async () => {
  app = (await import('../../server/src/app')).default;
  prisma = (await import('../../server/src/services/prisma')).prisma;
});

const marker = `t004files${Date.now()}`;
let regularUserId: number;

beforeAll(async () => {
  const regular = await prisma.user.create({
    data: {
      email: `${marker}-user@example.com`,
      displayName: 'Files Route User',
      role: 'USER',
      provider: 'test',
      providerId: `${marker}-user`,
    },
  });
  regularUserId = regular.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: regularUserId } });
});

async function loginAsUser() {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({
    email: `${marker}-user@example.com`,
    displayName: 'Files Route User',
    role: 'USER',
  });
  return agent;
}

describe('GET /api/files/* -- auth gate', () => {
  it('rejects an unauthenticated request with 401 before touching the filesystem', async () => {
    const res = await request(app).get('/api/files/projects/1/iterations/iter-1.png');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/files/* -- happy path', () => {
  it('returns the file bytes with the correct Content-Type for a PNG', async () => {
    const relPath = 'projects/1/iterations/iter-1.png';
    const absPath = path.join(testRoot, relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad]);
    await fs.writeFile(absPath, pngBytes);

    const agent = await loginAsUser();
    const res = await agent.get(`/api/files/${relPath}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/png/);
    expect(Buffer.from(res.body)).toEqual(pngBytes);
  });

  it('returns the correct Content-Type for a PDF', async () => {
    const relPath = 'projects/1/outputs/postcard.pdf';
    const absPath = path.join(testRoot, relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    const pdfBytes = Buffer.from('%PDF-1.7 fake pdf bytes');
    await fs.writeFile(absPath, pdfBytes);

    const agent = await loginAsUser();
    const res = await agent.get(`/api/files/${relPath}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/pdf/);
    expect(Buffer.from(res.body)).toEqual(pdfBytes);
  });
});

describe('GET /api/files/* -- missing file', () => {
  it('returns 404 (not a stack trace or directory listing) for a path that does not exist', async () => {
    const agent = await loginAsUser();
    const res = await agent.get('/api/files/projects/999999/iterations/does-not-exist.png');
    expect(res.status).toBe(404);
  });

  it('returns 404 for a directory path rather than listing its contents', async () => {
    const relDir = 'projects/1/iterations';
    await fs.mkdir(path.join(testRoot, relDir), { recursive: true });

    const agent = await loginAsUser();
    const res = await agent.get(`/api/files/${relDir}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/files/* -- path traversal', () => {
  it('rejects a literal ../ traversal attempt without escaping the workspace root', async () => {
    const agent = await loginAsUser();
    const res = await agent.get('/api/files/../../etc/passwd');
    expect([400, 403, 404]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toMatch(/root:/);
  });

  it('rejects an encoded ../ traversal attempt', async () => {
    const agent = await loginAsUser();
    const res = await agent.get('/api/files/%2e%2e/%2e%2e/etc/passwd');
    expect([400, 403, 404]).toContain(res.status);
  });
});

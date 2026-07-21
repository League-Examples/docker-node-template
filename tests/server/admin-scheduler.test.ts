import request from 'supertest';
import type { Server } from 'http';

import app from '../../server/src/app';
import { prisma, initPrisma } from '../../server/src/services/prisma';
import { startTestServer, stopTestServer } from './helpers/testServer';

// One persistent http.Server for this file (sprint 013-001) -- see
// helpers/testServer.ts for why. Registered first so it closes last,
// after the "restore jobs" afterAll below (which uses prisma directly,
// not the server, but this ordering is the file's general convention).
let server: Server;

afterAll(async () => {
  await stopTestServer(server);
});

beforeAll(async () => {
  server = await startTestServer(app);
});

async function seedJobs() {
  // Ensure Prisma is initialized before direct use
  await initPrisma();

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400000);
  const nextWeek = new Date(now.getTime() + 7 * 86400000);

  await prisma.scheduledJob.upsert({
    where: { name: 'daily-backup' },
    create: { name: 'daily-backup', frequency: 'daily', enabled: true, nextRun: tomorrow },
    update: {},
  });
  await prisma.scheduledJob.upsert({
    where: { name: 'weekly-backup' },
    create: { name: 'weekly-backup', frequency: 'weekly', enabled: true, nextRun: nextWeek },
    update: {},
  });
}

beforeAll(async () => {
  await seedJobs();
}, 30000);

afterAll(async () => {
  // Restore jobs to enabled state
  await prisma.scheduledJob.updateMany({
    where: { name: { in: ['daily-backup', 'weekly-backup'] } },
    data: { enabled: true },
  });
});

describe('Admin Scheduler API', () => {
  let adminAgent: any;

  beforeAll(async () => {
    adminAgent = request.agent(server);
    await adminAgent.post('/api/auth/test-login').send({
      email: 'sched-admin@example.com',
      displayName: 'Scheduler Admin',
      role: 'ADMIN',
    });
  });

  it('GET lists seeded jobs', async () => {
    const res = await adminAgent.get('/api/admin/scheduler/jobs');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const names = res.body.map((j: any) => j.name);
    expect(names).toContain('daily-backup');
    expect(names).toContain('weekly-backup');
  });

  it('PUT toggles enabled/disabled', async () => {
    const listRes = await adminAgent.get('/api/admin/scheduler/jobs');
    const dailyJob = listRes.body.find((j: any) => j.name === 'daily-backup');
    expect(dailyJob).toBeDefined();

    const res = await adminAgent.put(`/api/admin/scheduler/jobs/${dailyJob.id}`).send({
      enabled: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);

    // Re-enable for cleanup
    await adminAgent.put(`/api/admin/scheduler/jobs/${dailyJob.id}`).send({
      enabled: true,
    });
  });

  it('POST run triggers execution and returns updated job with lastRun', async () => {
    const listRes = await adminAgent.get('/api/admin/scheduler/jobs');
    const dailyJob = listRes.body.find((j: any) => j.name === 'daily-backup');

    const res = await adminAgent.post(`/api/admin/scheduler/jobs/${dailyJob.id}/run`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('lastRun');
    expect(res.body.lastRun).not.toBeNull();
  });

  it('returns 403 for non-admin', async () => {
    const userAgent = request.agent(server);
    await userAgent.post('/api/auth/test-login').send({
      email: 'sched-user@example.com',
      displayName: 'Scheduler User',
      role: 'USER',
    });
    const res = await userAgent.get('/api/admin/scheduler/jobs');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Admin access required');
  });

  it('returns 401 for unauthenticated', async () => {
    const res = await request(server).get('/api/admin/scheduler/jobs');
    expect(res.status).toBe(401);
  });
});

import request from 'supertest';
import { Pool } from 'pg';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://app:devpassword@localhost:5433/app';

import app from '../../server/src/app';
import { getTestPool } from './helpers/db';

let pool: Pool;

async function seedJobs(pool: Pool) {
  // Ensure the two default jobs exist
  await pool.query(`
    INSERT INTO "ScheduledJob" (name, frequency, enabled, "nextRun", "createdAt", "updatedAt")
    VALUES ('daily-backup', 'daily', true, NOW() + INTERVAL '1 day', NOW(), NOW())
    ON CONFLICT (name) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO "ScheduledJob" (name, frequency, enabled, "nextRun", "createdAt", "updatedAt")
    VALUES ('weekly-backup', 'weekly', true, NOW() + INTERVAL '7 days', NOW(), NOW())
    ON CONFLICT (name) DO NOTHING
  `);
}

beforeAll(async () => {
  pool = getTestPool();
  await seedJobs(pool);
}, 30000);

afterAll(async () => {
  // Restore jobs to enabled state
  await pool.query(`UPDATE "ScheduledJob" SET enabled = true WHERE name IN ('daily-backup', 'weekly-backup')`);
});

describe('Admin Scheduler API', () => {
  let adminAgent: any;

  beforeAll(async () => {
    adminAgent = request.agent(app);
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
    const userAgent = request.agent(app);
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
    const res = await request(app).get('/api/admin/scheduler/jobs');
    expect(res.status).toBe(401);
  });
});

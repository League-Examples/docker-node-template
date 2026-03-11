import request from 'supertest';
import { Pool } from 'pg';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://app:devpassword@localhost:5433/app';

import app from '../../server/src/app';
import { getTestPool } from './helpers/db';

let pool: Pool;

async function cleanupPatterns(pool: Pool) {
  try {
    await pool.query(`DELETE FROM "RoleAssignmentPattern" WHERE pattern LIKE '%test-perm%'`);
  } catch {
    // Table may not exist yet
  }
}

beforeAll(async () => {
  pool = getTestPool();
  await cleanupPatterns(pool);
}, 30000);

afterAll(async () => {
  await cleanupPatterns(pool);
});

describe('Admin Permissions API', () => {
  let adminAgent: any;
  let createdExactId: number;
  let createdRegexId: number;

  beforeAll(async () => {
    adminAgent = request.agent(app);
    await adminAgent.post('/api/auth/test-login').send({
      email: 'perm-admin@example.com',
      displayName: 'Perm Admin',
      role: 'ADMIN',
    });
  });

  it('POST creates an exact-match pattern (201)', async () => {
    const res = await adminAgent.post('/api/admin/permissions/patterns').send({
      matchType: 'exact',
      pattern: 'test-perm-exact@example.com',
      role: 'ADMIN',
    });
    expect(res.status).toBe(201);
    expect(res.body.matchType).toBe('exact');
    expect(res.body.pattern).toBe('test-perm-exact@example.com');
    expect(res.body.role).toBe('ADMIN');
    expect(res.body).toHaveProperty('id');
    createdExactId = res.body.id;
  });

  it('POST creates a regex pattern (201)', async () => {
    const res = await adminAgent.post('/api/admin/permissions/patterns').send({
      matchType: 'regex',
      pattern: '^test-perm-.*@example\\.com$',
      role: 'USER',
    });
    expect(res.status).toBe(201);
    expect(res.body.matchType).toBe('regex');
    createdRegexId = res.body.id;
  });

  it('POST rejects invalid regex (400)', async () => {
    const res = await adminAgent.post('/api/admin/permissions/patterns').send({
      matchType: 'regex',
      pattern: '[invalid((',
      role: 'USER',
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('GET lists all patterns', async () => {
    const res = await adminAgent.get('/api/admin/permissions/patterns');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const ids = res.body.map((p: any) => p.id);
    expect(ids).toContain(createdExactId);
    expect(ids).toContain(createdRegexId);
  });

  it('PUT updates a pattern', async () => {
    const res = await adminAgent.put(`/api/admin/permissions/patterns/${createdExactId}`).send({
      role: 'USER',
    });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('USER');
  });

  it('DELETE removes a pattern (204)', async () => {
    const res = await adminAgent.delete(`/api/admin/permissions/patterns/${createdRegexId}`);
    expect(res.status).toBe(204);

    // Verify it's gone
    const listRes = await adminAgent.get('/api/admin/permissions/patterns');
    const ids = listRes.body.map((p: any) => p.id);
    expect(ids).not.toContain(createdRegexId);
  });

  it('returns 403 for non-admin USER', async () => {
    const userAgent = request.agent(app);
    await userAgent.post('/api/auth/test-login').send({
      email: 'perm-user@example.com',
      displayName: 'Perm User',
      role: 'USER',
    });
    const res = await userAgent.get('/api/admin/permissions/patterns');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Admin access required');
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).get('/api/admin/permissions/patterns');
    expect(res.status).toBe(401);
  });
});

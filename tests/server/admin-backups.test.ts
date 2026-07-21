import request from 'supertest';
import type { Server } from 'http';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://app:devpassword@localhost:5433/app';

import app from '../../server/src/app';
import { startTestServer, stopTestServer } from './helpers/testServer';

// One persistent http.Server for this file (sprint 013-001) -- see
// helpers/testServer.ts for why. Registered first so it closes last.
let server: Server;

afterAll(async () => {
  await stopTestServer(server);
});

beforeAll(async () => {
  server = await startTestServer(app);
});

describe('Admin Backups API', () => {
  let adminAgent: any;

  beforeAll(async () => {
    adminAgent = request.agent(server);
    await adminAgent.post('/api/auth/test-login').send({
      email: 'backup-admin@example.com',
      displayName: 'Backup Admin',
      role: 'ADMIN',
    });
  }, 30000);

  it('GET /api/admin/export/json returns valid JSON with tables and metadata', async () => {
    const res = await adminAgent.get('/api/admin/export/json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toHaveProperty('exportedAt');
    expect(res.body).toHaveProperty('tables');
  });

  it('JSON export includes exportedAt and tables object', async () => {
    const res = await adminAgent.get('/api/admin/export/json');
    expect(res.status).toBe(200);
    expect(typeof res.body.exportedAt).toBe('string');
    expect(typeof res.body.tables).toBe('object');
    // Check expected table keys
    expect(res.body.tables).toHaveProperty('User');
    expect(res.body.tables).toHaveProperty('Config');
    expect(res.body.tables.User).toHaveProperty('count');
    expect(res.body.tables.User).toHaveProperty('records');
  });

  it('returns 403 for non-admin on export', async () => {
    const userAgent = request.agent(server);
    await userAgent.post('/api/auth/test-login').send({
      email: 'backup-user@example.com',
      displayName: 'Backup User',
      role: 'USER',
    });
    const res = await userAgent.get('/api/admin/export/json');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Admin access required');
  });

  it('returns 401 for unauthenticated on export', async () => {
    const res = await request(server).get('/api/admin/export/json');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin on backup routes', async () => {
    const userAgent = request.agent(server);
    await userAgent.post('/api/auth/test-login').send({
      email: 'backup-user2@example.com',
      displayName: 'Backup User 2',
      role: 'USER',
    });
    const res = await userAgent.get('/api/admin/backups');
    expect(res.status).toBe(403);
  });

  it('returns 401 for unauthenticated on backup routes', async () => {
    const res = await request(server).get('/api/admin/backups');
    expect(res.status).toBe(401);
  });
});

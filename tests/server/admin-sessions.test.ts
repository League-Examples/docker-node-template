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

describe('Admin Sessions API', () => {
  let adminAgent: any;

  beforeAll(async () => {
    adminAgent = request.agent(server);
    await adminAgent.post('/api/auth/test-login').send({
      email: 'session-admin@example.com',
      displayName: 'Session Admin',
      role: 'ADMIN',
    });
  }, 30000);

  it('GET /api/admin/sessions returns array', async () => {
    const res = await adminAgent.get('/api/admin/sessions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('sessions include expected fields when present', async () => {
    const res = await adminAgent.get('/api/admin/sessions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    // Sessions may or may not be stored in PG depending on session store config.
    // If sessions are present, verify the shape.
    if (res.body.length > 0) {
      const session = res.body[0];
      expect(session).toHaveProperty('sid');
      expect(session).toHaveProperty('expire');
      expect(session).toHaveProperty('hasUser');
    }
  });

  it('returns 403 for non-admin', async () => {
    const userAgent = request.agent(server);
    await userAgent.post('/api/auth/test-login').send({
      email: 'session-user@example.com',
      displayName: 'Session User',
      role: 'USER',
    });
    const res = await userAgent.get('/api/admin/sessions');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Admin access required');
  });

  it('returns 401 for unauthenticated', async () => {
    const res = await request(server).get('/api/admin/sessions');
    expect(res.status).toBe(401);
  });
});

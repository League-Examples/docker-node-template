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

describe('Admin Environment API', () => {
  let adminAgent: any;

  beforeAll(async () => {
    adminAgent = request.agent(server);
    await adminAgent.post('/api/auth/test-login').send({
      email: 'env-admin@example.com',
      displayName: 'Env Admin',
      role: 'ADMIN',
    });
  }, 30000);

  it('GET /api/admin/env returns environment info', async () => {
    const res = await adminAgent.get('/api/admin/env');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('node');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('memory');
    expect(res.body).toHaveProperty('deployment');
    expect(res.body).toHaveProperty('database');
    expect(res.body).toHaveProperty('integrations');
  });

  it('response includes integrations object with configured booleans', async () => {
    const res = await adminAgent.get('/api/admin/env');
    expect(res.status).toBe(200);

    const integrations = res.body.integrations;
    expect(typeof integrations).toBe('object');

    // Each integration should have a 'configured' boolean
    expect(integrations.google).toHaveProperty('configured');
    expect(typeof integrations.google.configured).toBe('boolean');
    expect(integrations.anthropic).toHaveProperty('configured');
    expect(typeof integrations.anthropic.configured).toBe('boolean');
  });

  it('returns 403 for non-admin', async () => {
    const userAgent = request.agent(server);
    await userAgent.post('/api/auth/test-login').send({
      email: 'env-user@example.com',
      displayName: 'Env User',
      role: 'USER',
    });
    const res = await userAgent.get('/api/admin/env');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Admin access required');
  });

  it('returns 401 for unauthenticated', async () => {
    const res = await request(server).get('/api/admin/env');
    expect(res.status).toBe(401);
  });
});

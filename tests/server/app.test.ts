import request from 'supertest';
import type { Server } from 'http';

// Set test environment before importing app
process.env.NODE_ENV = 'test';

// Import the app (not index.ts — avoids starting the server)
import app from '../../server/src/app';
import { startTestServer, stopTestServer } from './helpers/testServer';

// One persistent http.Server for this file (sprint 013-001) -- see
// helpers/testServer.ts for why.
let server: Server;

beforeAll(async () => {
  server = await startTestServer(app);
});

afterAll(async () => {
  await stopTestServer(server);
});

describe('Server smoke tests', () => {
  it('GET /api/health returns 200 with status ok', async () => {
    const res = await request(server).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('appName');
    expect(res.body).toHaveProperty('appSlug');
  });

  it('starts without any OAuth environment variables', async () => {
    // If we got here, the app imported and configured without crashing.
    // Verify it responds to requests.
    const res = await request(server).get('/api/health');
    expect(res.status).toBe(200);
  });
});

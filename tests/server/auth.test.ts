import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';

import app from '../../server/src/app';

describe('Auth routes', () => {
  it('GET /api/auth/me returns 401 when not logged in', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/not authenticated/i);
  });

  it('POST /api/auth/logout handles gracefully when not logged in', async () => {
    const res = await request(app).post('/api/auth/logout');
    // Should either succeed (200) or not crash — both are acceptable
    expect([200, 401]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('success', true);
    }
  });

  it('GET /api/auth/github is not a route (404)', async () => {
    const res = await request(app).get('/api/auth/github');
    expect(res.status).toBe(404);
  });

  it('GET /api/auth/google is not a route (404)', async () => {
    const res = await request(app).get('/api/auth/google');
    expect(res.status).toBe(404);
  });
});

import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';

import app from '../../server/src/app';

describe('Auth routes (no OAuth credentials configured)', () => {
  it('GET /api/auth/github returns 501 when GitHub OAuth not configured', async () => {
    const res = await request(app).get('/api/auth/github');
    expect(res.status).toBe(501);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/not configured/i);
  });

  it('GET /api/auth/github 501 response includes docs URL', async () => {
    const res = await request(app).get('/api/auth/github');
    expect(res.status).toBe(501);
    expect(res.body).toHaveProperty('docs');
    expect(res.body.docs).toContain('github.com');
  });

  it('GET /api/auth/github/callback returns 501 when not configured', async () => {
    const res = await request(app).get('/api/auth/github/callback');
    expect(res.status).toBe(501);
    expect(res.body).toHaveProperty('error');
  });

  it('GET /api/auth/google returns 501 when Google OAuth not configured', async () => {
    const res = await request(app).get('/api/auth/google');
    expect(res.status).toBe(501);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/not configured/i);
  });

  it('GET /api/auth/google 501 response includes docs URL', async () => {
    const res = await request(app).get('/api/auth/google');
    expect(res.status).toBe(501);
    expect(res.body).toHaveProperty('docs');
    expect(res.body.docs).toContain('console.cloud.google.com');
  });

  it('GET /api/auth/google/callback returns 501 when not configured', async () => {
    const res = await request(app).get('/api/auth/google/callback');
    expect(res.status).toBe(501);
    expect(res.body).toHaveProperty('error');
  });

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
});

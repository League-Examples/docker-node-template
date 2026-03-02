import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';

import app from '../../server/src/app';

describe('Pike 13 routes (no credentials configured)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PIKE13_ACCESS_TOKEN;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('GET /api/pike13/events returns 501 when PIKE13_ACCESS_TOKEN not set', async () => {
    const res = await request(app).get('/api/pike13/events');
    expect(res.status).toBe(501);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/not configured/i);
  });

  it('GET /api/pike13/events 501 response includes docs URL', async () => {
    const res = await request(app).get('/api/pike13/events');
    expect(res.status).toBe(501);
    expect(res.body).toHaveProperty('docs');
    expect(res.body.docs).toContain('pike13.com');
  });

  it('GET /api/pike13/events 501 response includes setup detail', async () => {
    const res = await request(app).get('/api/pike13/events');
    expect(res.status).toBe(501);
    expect(res.body).toHaveProperty('detail');
    expect(res.body.detail).toMatch(/PIKE13_ACCESS_TOKEN/);
  });

  it('GET /api/pike13/people returns 501 when PIKE13_ACCESS_TOKEN not set', async () => {
    const res = await request(app).get('/api/pike13/people');
    expect(res.status).toBe(501);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/not configured/i);
  });

  it('GET /api/pike13/people 501 response includes docs URL', async () => {
    const res = await request(app).get('/api/pike13/people');
    expect(res.status).toBe(501);
    expect(res.body).toHaveProperty('docs');
    expect(res.body.docs).toContain('pike13.com');
  });
});

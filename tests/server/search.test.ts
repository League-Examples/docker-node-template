import request from 'supertest';
import app from '../../server/src/app';

describe('Search — GET /api/search', () => {
  let adminAgent: request.SuperAgentTest;
  let userAgent: request.SuperAgentTest;
  const suffix = Date.now();

  beforeAll(async () => {
    // Admin agent (for creating channels)
    adminAgent = request.agent(app);
    await adminAgent
      .post('/api/auth/test-login')
      .send({
        email: `search-admin-${suffix}@test.com`,
        displayName: 'Search Admin',
        role: 'ADMIN',
      })
      .expect(200);

    // Regular user agent
    userAgent = request.agent(app);
    await userAgent
      .post('/api/auth/test-login')
      .send({
        email: `search-user-${suffix}@test.com`,
        displayName: 'Search User',
        role: 'USER',
      })
      .expect(200);

    // Seed data: create a channel and messages for search
    const chanRes = await adminAgent
      .post('/api/channels')
      .send({ name: `general-search-${suffix}`, description: 'General discussion' })
      .expect(201);
    const channelId = chanRes.body.id;

    await userAgent
      .post(`/api/channels/${channelId}/messages`)
      .send({ content: `searchable keyword alpha-${suffix}` })
      .expect(201);
    await userAgent
      .post(`/api/channels/${channelId}/messages`)
      .send({ content: `another searchable message beta-${suffix}` })
      .expect(201);
  });

  it('returns 401 unauthenticated', async () => {
    const res = await request(app).get('/api/search?q=general');
    expect(res.status).toBe(401);
  });

  it('returns grouped results with channels and messages arrays', async () => {
    const res = await userAgent.get(`/api/search?q=general-search-${suffix}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('channels');
    expect(res.body).toHaveProperty('messages');
    expect(Array.isArray(res.body.channels)).toBe(true);
    expect(Array.isArray(res.body.messages)).toBe(true);
    // Should find the seeded channel
    expect(res.body.channels.length).toBeGreaterThanOrEqual(1);
  });

  it('returns matching messages', async () => {
    const res = await userAgent.get(`/api/search?q=alpha-${suffix}`);
    expect(res.status).toBe(200);
    expect(res.body.messages.length).toBeGreaterThanOrEqual(1);
    expect(res.body.messages[0].content).toContain(`alpha-${suffix}`);
  });

  it('returns empty results for queries with no matches', async () => {
    const res = await userAgent.get('/api/search?q=zzzznonexistent99999');
    expect(res.status).toBe(200);
    expect(res.body.channels).toHaveLength(0);
    expect(res.body.messages).toHaveLength(0);
  });

  it('returns 400 for short queries (< 2 chars)', async () => {
    const res = await userAgent.get('/api/search?q=a');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for missing query param', async () => {
    const res = await userAgent.get('/api/search');
    expect(res.status).toBe(400);
  });

  it('results are limited to max 5 per type', async () => {
    // Create many channels to test the limit
    for (let i = 0; i < 7; i++) {
      await adminAgent
        .post('/api/channels')
        .send({ name: `limitcheck-${suffix}-${i}` })
        .expect(201);
    }

    const res = await userAgent.get(`/api/search?q=limitcheck-${suffix}`);
    expect(res.status).toBe(200);
    expect(res.body.channels.length).toBeLessThanOrEqual(5);
  });
});

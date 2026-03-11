import request from 'supertest';
import app from '../../server/src/app';

describe('Channel CRUD — /api/channels', () => {
  let adminAgent: request.SuperAgentTest;
  let userAgent: request.SuperAgentTest;
  const suffix = Date.now();

  beforeAll(async () => {
    // Admin agent
    adminAgent = request.agent(app);
    await adminAgent
      .post('/api/auth/test-login')
      .send({
        email: `chan-admin-${suffix}@test.com`,
        displayName: 'Channel Admin',
        role: 'ADMIN',
      })
      .expect(200);

    // Regular user agent
    userAgent = request.agent(app);
    await userAgent
      .post('/api/auth/test-login')
      .send({
        email: `chan-user-${suffix}@test.com`,
        displayName: 'Channel User',
        role: 'USER',
      })
      .expect(200);
  });

  // ---- GET /api/channels ----

  it('GET /api/channels returns 401 unauthenticated', async () => {
    const res = await request(app).get('/api/channels');
    expect(res.status).toBe(401);
  });

  it('GET /api/channels returns 200 with array', async () => {
    const res = await userAgent.get('/api/channels');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  // ---- POST /api/channels ----

  it('POST /api/channels creates channel (admin)', async () => {
    const name = `test-channel-${suffix}-create`;
    const res = await adminAgent
      .post('/api/channels')
      .send({ name, description: 'A test channel' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('name', name);
    expect(res.body).toHaveProperty('id');
  });

  it('POST /api/channels returns 403 for non-admin user', async () => {
    const res = await userAgent
      .post('/api/channels')
      .send({ name: `no-access-${suffix}` });
    expect(res.status).toBe(403);
  });

  it('POST /api/channels returns 401 unauthenticated', async () => {
    const res = await request(app)
      .post('/api/channels')
      .send({ name: `unauth-${suffix}` });
    expect(res.status).toBe(401);
  });

  it('POST /api/channels returns 409 for duplicate channel name', async () => {
    const name = `dup-channel-${suffix}`;
    // Create first
    await adminAgent.post('/api/channels').send({ name }).expect(201);
    // Duplicate
    const res = await adminAgent.post('/api/channels').send({ name });
    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('error');
  });

  // ---- GET /api/channels/:id ----

  it('GET /api/channels/:id returns channel with messages array', async () => {
    const name = `detail-channel-${suffix}`;
    const created = await adminAgent
      .post('/api/channels')
      .send({ name })
      .expect(201);

    const res = await userAgent.get(`/api/channels/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('name', name);
    expect(res.body).toHaveProperty('messages');
    expect(Array.isArray(res.body.messages)).toBe(true);
  });

  it('GET /api/channels/:id supports limit query param', async () => {
    const name = `limit-channel-${suffix}`;
    const created = await adminAgent
      .post('/api/channels')
      .send({ name })
      .expect(201);
    const channelId = created.body.id;

    // Post a few messages
    for (let i = 0; i < 3; i++) {
      await userAgent
        .post(`/api/channels/${channelId}/messages`)
        .send({ content: `msg ${i}` })
        .expect(201);
    }

    const res = await userAgent.get(`/api/channels/${channelId}?limit=2`);
    expect(res.status).toBe(200);
    expect(res.body.messages.length).toBeLessThanOrEqual(2);
  });

  it('GET /api/channels/:id returns 401 unauthenticated', async () => {
    const res = await request(app).get('/api/channels/1');
    expect(res.status).toBe(401);
  });

  it('GET /api/channels/:id returns 404 for nonexistent channel', async () => {
    const res = await userAgent.get('/api/channels/999999');
    expect(res.status).toBe(404);
  });

  // ---- DELETE /api/channels/:id ----

  it('DELETE /api/channels/:id deletes channel (admin)', async () => {
    const name = `delete-channel-${suffix}`;
    const created = await adminAgent
      .post('/api/channels')
      .send({ name })
      .expect(201);

    const res = await adminAgent.delete(`/api/channels/${created.body.id}`);
    expect([200, 204]).toContain(res.status);

    // Verify it's gone
    const check = await userAgent.get(`/api/channels/${created.body.id}`);
    expect(check.status).toBe(404);
  });

  it('DELETE /api/channels/:id returns 403 for non-admin', async () => {
    const name = `nodelete-channel-${suffix}`;
    const created = await adminAgent
      .post('/api/channels')
      .send({ name })
      .expect(201);

    const res = await userAgent.delete(`/api/channels/${created.body.id}`);
    expect(res.status).toBe(403);
  });

  it('DELETE /api/channels/:id returns 401 unauthenticated', async () => {
    const res = await request(app).delete('/api/channels/1');
    expect(res.status).toBe(401);
  });
});

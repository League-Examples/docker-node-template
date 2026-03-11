import request from 'supertest';
import app from '../../server/src/app';

describe('Messages — /api/channels/:id/messages & /api/messages/:id', () => {
  let adminAgent: request.SuperAgentTest;
  let userAgent: request.SuperAgentTest;
  let otherUserAgent: request.SuperAgentTest;
  let channelId: number;
  const suffix = Date.now();

  beforeAll(async () => {
    // Admin agent
    adminAgent = request.agent(app);
    await adminAgent
      .post('/api/auth/test-login')
      .send({
        email: `msg-admin-${suffix}@test.com`,
        displayName: 'Msg Admin',
        role: 'ADMIN',
      })
      .expect(200);

    // Regular user agent
    userAgent = request.agent(app);
    await userAgent
      .post('/api/auth/test-login')
      .send({
        email: `msg-user-${suffix}@test.com`,
        displayName: 'Msg User',
        role: 'USER',
      })
      .expect(200);

    // Another regular user agent
    otherUserAgent = request.agent(app);
    await otherUserAgent
      .post('/api/auth/test-login')
      .send({
        email: `msg-other-${suffix}@test.com`,
        displayName: 'Other User',
        role: 'USER',
      })
      .expect(200);

    // Create a channel for message tests
    const chanRes = await adminAgent
      .post('/api/channels')
      .send({ name: `msg-test-channel-${suffix}` })
      .expect(201);
    channelId = chanRes.body.id;
  });

  // ---- POST /api/channels/:id/messages ----

  it('POST /api/channels/:id/messages creates message (authenticated)', async () => {
    const res = await userAgent
      .post(`/api/channels/${channelId}/messages`)
      .send({ content: 'Hello world' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('content', 'Hello world');
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('channelId', channelId);
  });

  it('POST /api/channels/:id/messages returns 401 unauthenticated', async () => {
    const res = await request(app)
      .post(`/api/channels/${channelId}/messages`)
      .send({ content: 'nope' });
    expect(res.status).toBe(401);
  });

  it('POST /api/channels/:id/messages rejects empty content (400)', async () => {
    const res = await userAgent
      .post(`/api/channels/${channelId}/messages`)
      .send({ content: '' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /api/channels/:id/messages rejects missing content (400)', async () => {
    const res = await userAgent
      .post(`/api/channels/${channelId}/messages`)
      .send({});
    expect(res.status).toBe(400);
  });

  // ---- DELETE /api/messages/:id ----

  it('DELETE /api/messages/:id allows message author to delete', async () => {
    // User creates a message
    const msgRes = await userAgent
      .post(`/api/channels/${channelId}/messages`)
      .send({ content: 'to be deleted by author' })
      .expect(201);

    const res = await userAgent.delete(`/api/messages/${msgRes.body.id}`);
    expect([200, 204]).toContain(res.status);
  });

  it('DELETE /api/messages/:id allows admin to delete any message', async () => {
    // Regular user creates a message
    const msgRes = await userAgent
      .post(`/api/channels/${channelId}/messages`)
      .send({ content: 'to be deleted by admin' })
      .expect(201);

    // Admin deletes it
    const res = await adminAgent.delete(`/api/messages/${msgRes.body.id}`);
    expect([200, 204]).toContain(res.status);
  });

  it('DELETE /api/messages/:id returns 403 for non-author non-admin', async () => {
    // User creates a message
    const msgRes = await userAgent
      .post(`/api/channels/${channelId}/messages`)
      .send({ content: 'protected message' })
      .expect(201);

    // Other user tries to delete it
    const res = await otherUserAgent.delete(`/api/messages/${msgRes.body.id}`);
    expect(res.status).toBe(403);
  });

  it('DELETE /api/messages/:id returns 401 unauthenticated', async () => {
    const msgRes = await userAgent
      .post(`/api/channels/${channelId}/messages`)
      .send({ content: 'unauth delete test' })
      .expect(201);

    const res = await request(app).delete(`/api/messages/${msgRes.body.id}`);
    expect(res.status).toBe(401);
  });

  // ---- Message ordering ----

  it('messages returned in chronological order', async () => {
    // Create a fresh channel
    const chanRes = await adminAgent
      .post('/api/channels')
      .send({ name: `order-test-${suffix}` })
      .expect(201);
    const ordChannelId = chanRes.body.id;

    // Post messages in sequence
    await userAgent
      .post(`/api/channels/${ordChannelId}/messages`)
      .send({ content: 'first' })
      .expect(201);
    await userAgent
      .post(`/api/channels/${ordChannelId}/messages`)
      .send({ content: 'second' })
      .expect(201);
    await userAgent
      .post(`/api/channels/${ordChannelId}/messages`)
      .send({ content: 'third' })
      .expect(201);

    const res = await userAgent.get(`/api/channels/${ordChannelId}`);
    expect(res.status).toBe(200);
    const messages = res.body.messages;
    expect(messages.length).toBeGreaterThanOrEqual(3);

    // Verify chronological ordering by createdAt
    for (let i = 1; i < messages.length; i++) {
      const prev = new Date(messages[i - 1].createdAt).getTime();
      const curr = new Date(messages[i].createdAt).getTime();
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });
});

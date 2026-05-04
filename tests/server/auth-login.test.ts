/**
 * Tests for POST /api/auth/login
 *
 * Covers:
 *  - 200 with { user } on valid credentials
 *  - Session cookie is set on success
 *  - GET /api/auth/me after login returns the correct user
 *  - 401 invalid_credentials on wrong password
 *  - 401 invalid_credentials on unknown username
 *  - 401 invalid_credentials when user exists but passwordHash is null (OAuth-only user)
 *  - Demo-seeded user/pass logs in successfully
 *  - Demo-seeded admin/admin logs in with ADMIN role
 */

import request from 'supertest';

process.env.NODE_ENV = 'test';

import app from '../../server/src/app';
import { prisma } from '../../server/src/services/prisma';
import { hashPassword } from '../../server/src/auth/password';

// Unique email domain for this suite.
const DOMAIN = '@login.test.com';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let counter = 0;
function uniqueTag(prefix = 'login') {
  counter++;
  return `${prefix}${counter}`;
}

async function cleanupDomain() {
  try {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: DOMAIN } },
      select: { id: true },
    });
    const ids = users.map((u: any) => u.id);
    if (ids.length) {
      await prisma.userProvider.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
  } catch {
    // ignore
  }
}

/**
 * Register a fresh user via the register endpoint and return the credentials.
 * Uses a per-call unique username/email so tests don't collide.
 */
async function registerUser(password = 'Pass1word') {
  const tag = uniqueTag();
  const username = `user_${tag}`;
  const email = `${tag}${DOMAIN}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, email, password });
  if (res.status !== 201) {
    throw new Error(`Register failed: ${JSON.stringify(res.body)}`);
  }
  return { username, email, password, user: res.body.user };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await cleanupDomain();
}, 30000);

afterAll(async () => {
  await cleanupDomain();
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('POST /api/auth/login — valid credentials', () => {
  it('returns 200 with { user } on correct username + password', async () => {
    const { username, password } = await registerUser();
    const res = await request(app).post('/api/auth/login').send({ username, password });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user).toHaveProperty('id');
    expect(res.body.user).toHaveProperty('email');
    expect(res.body.user).toHaveProperty('role');
  });

  it('sets a session cookie on success', async () => {
    const { username, password } = await registerUser();
    const res = await request(app).post('/api/auth/login').send({ username, password });

    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    expect(Array.isArray(setCookie) ? setCookie.join('') : setCookie).toMatch(/connect\.sid/i);
  });

  it('GET /api/auth/me after login returns the correct user', async () => {
    const { username, password, user: registered } = await registerUser();
    const agent = request.agent(app);

    const loginRes = await agent.post('/api/auth/login').send({ username, password });
    expect(loginRes.status).toBe(200);

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.id).toBe(registered.id);
    expect(meRes.body.email).toBe(registered.email);
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe('POST /api/auth/login — error cases', () => {
  it('returns 401 invalid_credentials on wrong password', async () => {
    const { username } = await registerUser();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username, password: 'WrongP4ss!' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error', 'invalid_credentials');
  });

  it('returns 401 invalid_credentials on unknown username', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'totally_unknown_xyz', password: 'Pass1word' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error', 'invalid_credentials');
  });

  it('returns 401 invalid_credentials when user exists but passwordHash is null (OAuth-only user)', async () => {
    // Use test-login to create an OAuth-only user (no passwordHash)
    const tag = uniqueTag('oauth_only');
    const email = `${tag}${DOMAIN}`;

    await request(app).post('/api/auth/test-login').send({
      email,
      displayName: 'OAuth Only User',
      provider: 'github',
      providerId: `gh-${tag}`,
    });

    // Verify the user has no passwordHash but has a username for login
    const dbUser = await prisma.user.findFirst({ where: { email } });
    expect(dbUser).not.toBeNull();
    expect(dbUser!.passwordHash).toBeNull();

    // Set a username so the login endpoint can find by username
    const username = `oauth_${tag}`;
    await prisma.user.update({
      where: { id: dbUser!.id },
      data: { username },
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username, password: 'Pass1word' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error', 'invalid_credentials');
  });
});

// ---------------------------------------------------------------------------
// Demo-seeded users
// ---------------------------------------------------------------------------

describe('POST /api/auth/login — demo-seeded users', () => {
  const DEMO_DOMAIN = '@demo.test.com';

  beforeAll(async () => {
    // Ensure demo users exist (they may or may not have been seeded).
    // We upsert them here via direct Prisma to avoid relying on the seed script.
    const demoPasswordHash = await hashPassword('pass');
    const adminPasswordHash = await hashPassword('admin');

    // user/pass — regular user
    await prisma.user.upsert({
      where: { email: 'user@demo.test.com' },
      update: { passwordHash: demoPasswordHash, username: 'user' },
      create: {
        username: 'user',
        email: 'user@demo.test.com',
        displayName: 'Demo User',
        role: 'USER',
        passwordHash: demoPasswordHash,
      },
    });

    // admin/admin — admin user
    await prisma.user.upsert({
      where: { email: 'admin@demo.test.com' },
      update: { passwordHash: adminPasswordHash, username: 'admin' },
      create: {
        username: 'admin',
        email: 'admin@demo.test.com',
        displayName: 'Demo Admin',
        role: 'ADMIN',
        passwordHash: adminPasswordHash,
      },
    });
  }, 30000);

  afterAll(async () => {
    try {
      const users = await prisma.user.findMany({
        where: { email: { endsWith: DEMO_DOMAIN } },
        select: { id: true },
      });
      const ids = users.map((u: any) => u.id);
      if (ids.length) {
        await prisma.userProvider.deleteMany({ where: { userId: { in: ids } } });
        await prisma.user.deleteMany({ where: { id: { in: ids } } });
      }
    } catch {
      // ignore
    }
  });

  it('demo-seeded user/pass logs in successfully', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'user', password: 'pass' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.email).toBe('user@demo.test.com');
  });

  it('demo-seeded admin/admin logs in with ADMIN role', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.role).toBe('ADMIN');
    expect(res.body.user.email).toBe('admin@demo.test.com');
  });
});

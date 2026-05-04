/**
 * Tests for POST /api/auth/register
 *
 * Covers:
 *  - 201 valid registration; response body contains { user } with id, email, displayName, role
 *  - Session cookie is set on 201
 *  - GET /api/auth/me after register returns the new user (session works)
 *  - 409 username_taken
 *  - 409 email_taken
 *  - 400 invalid_password — fewer than 6 characters
 *  - 400 invalid_password — only one character class (all lowercase)
 *  - First registered user in an empty DB receives ADMIN role
 *  - Second registered user receives USER role
 *  - 400 on missing required fields
 */

import request from 'supertest';
import Database from 'better-sqlite3';

process.env.NODE_ENV = 'test';

import app from '../../server/src/app';
import { prisma } from '../../server/src/services/prisma';

// Unique domain so cleanup is scoped and won't collide with other test files.
const DOMAIN = '@reg.test.com';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let userCounter = 0;
function uniqueUser(prefix = 'reg') {
  userCounter++;
  const tag = `${prefix}${userCounter}`;
  return {
    username: `u_${tag}`,
    email: `${tag}${DOMAIN}`,
    password: 'Pass1word',
  };
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
    // ignore — tables may not exist in all environments
  }
}

/** Wipe EVERY user row so the "first user" tests run against an empty DB. */
async function wipeAllUsers() {
  const dbPath = (process.env.DATABASE_URL ?? 'file:./data/test.db').replace('file:', '');
  const db = new Database(dbPath);
  try {
    db.prepare('DELETE FROM "UserProvider"').run();
    db.prepare('DELETE FROM "User"').run();
  } finally {
    db.close();
  }
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

describe('POST /api/auth/register — valid registration', () => {
  it('returns 201 with { user } containing id, email, displayName, role', async () => {
    const body = uniqueUser();
    const res = await request(app).post('/api/auth/register').send(body);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user).toHaveProperty('id');
    expect(res.body.user.email).toBe(body.email);
    expect(res.body.user).toHaveProperty('displayName');
    expect(res.body.user).toHaveProperty('role');
  });

  it('sets a session cookie on 201', async () => {
    const body = uniqueUser();
    const res = await request(app).post('/api/auth/register').send(body);

    expect(res.status).toBe(201);
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    expect(Array.isArray(setCookie) ? setCookie.join('') : setCookie).toMatch(/connect\.sid/i);
  });

  it('GET /api/auth/me after register returns the new user (session persists)', async () => {
    const body = uniqueUser();
    const agent = request.agent(app);

    const regRes = await agent.post('/api/auth/register').send(body);
    expect(regRes.status).toBe(201);

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.email).toBe(body.email);
  });
});

// ---------------------------------------------------------------------------
// Conflict errors
// ---------------------------------------------------------------------------

describe('POST /api/auth/register — conflict errors', () => {
  it('returns 409 username_taken when username already exists', async () => {
    const first = uniqueUser('conflict_un');
    const second = { ...uniqueUser('conflict_un_2nd'), username: first.username };

    await request(app).post('/api/auth/register').send(first);

    const res = await request(app).post('/api/auth/register').send(second);
    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('error', 'username_taken');
  });

  it('returns 409 email_taken when email already registered', async () => {
    const first = uniqueUser('conflict_em');
    const second = { ...uniqueUser('conflict_em_2nd'), email: first.email };

    await request(app).post('/api/auth/register').send(first);

    const res = await request(app).post('/api/auth/register').send(second);
    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('error', 'email_taken');
  });
});

// ---------------------------------------------------------------------------
// Password validation errors
// ---------------------------------------------------------------------------

describe('POST /api/auth/register — invalid_password', () => {
  it('returns 400 invalid_password for a password shorter than 6 characters', async () => {
    const body = { ...uniqueUser('pw_short'), password: 'aB3' };
    const res = await request(app).post('/api/auth/register').send(body);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'invalid_password');
  });

  it('returns 400 invalid_password for a password with only one character class (all lowercase)', async () => {
    const body = { ...uniqueUser('pw_weak'), password: 'abcdef' };
    const res = await request(app).post('/api/auth/register').send(body);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'invalid_password');
  });
});

// ---------------------------------------------------------------------------
// Missing required fields
// ---------------------------------------------------------------------------

describe('POST /api/auth/register — missing required fields', () => {
  it('returns 400 when username is absent', async () => {
    const { username: _u, ...body } = uniqueUser('no_un');
    const res = await request(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(400);
  });

  it('returns 400 when email is absent', async () => {
    const { email: _e, ...body } = uniqueUser('no_em');
    const res = await request(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is absent', async () => {
    const { password: _p, ...body } = uniqueUser('no_pw');
    const res = await request(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// First-user-is-ADMIN rule
// ---------------------------------------------------------------------------

describe('POST /api/auth/register — first-user ADMIN rule', () => {
  beforeAll(async () => {
    await wipeAllUsers();
  }, 30000);

  afterAll(async () => {
    await cleanupDomain();
  });

  it('first registered user receives ADMIN role', async () => {
    const body = uniqueUser('first');
    const res = await request(app).post('/api/auth/register').send(body);

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('ADMIN');
  });

  it('second registered user receives USER role', async () => {
    const body = uniqueUser('second');
    const res = await request(app).post('/api/auth/register').send(body);

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('USER');
  });
});

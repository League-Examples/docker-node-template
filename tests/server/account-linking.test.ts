import { Pool } from 'pg';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://app:devpassword@localhost:5433/app';

import { findOrCreateOAuthUser } from '../../server/src/routes/auth';
import { getTestPool, cleanupTestDb } from './helpers/db';

let pool: Pool;

beforeAll(async () => {
  pool = getTestPool();
  await cleanupTestDb(pool);
}, 30000);

afterAll(async () => {
  if (pool) {
    await cleanupTestDb(pool);
    await pool.end();
  }
});

describe('Account linking — findOrCreateOAuthUser', () => {
  const sharedEmail = `linking-${Date.now()}@example.com`;

  it('creates a new user on first OAuth login', async () => {
    const user = await findOrCreateOAuthUser(
      'github', 'gh-123', sharedEmail, 'Test User', null,
    );
    expect(user.email).toBe(sharedEmail);
    expect(user.id).toBeDefined();

    // Verify UserProvider record
    const result = await pool.query(
      `SELECT * FROM "UserProvider" WHERE "userId" = $1`, [user.id],
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].provider).toBe('github');
    expect(result.rows[0].providerId).toBe('gh-123');
  });

  it('links a second provider to the same user by email', async () => {
    const user = await findOrCreateOAuthUser(
      'google', 'goog-456', sharedEmail, 'Test User', null,
    );
    expect(user.email).toBe(sharedEmail);

    // Should be the SAME user (same id)
    const firstUser = await pool.query(
      `SELECT id FROM "User" WHERE email = $1`, [sharedEmail],
    );
    expect(firstUser.rows.length).toBe(1);
    expect(user.id).toBe(firstUser.rows[0].id);

    // Should now have TWO UserProvider records
    const providers = await pool.query(
      `SELECT * FROM "UserProvider" WHERE "userId" = $1 ORDER BY provider`, [user.id],
    );
    expect(providers.rows.length).toBe(2);
    expect(providers.rows.map((r: any) => r.provider).sort()).toEqual(['github', 'google']);
  });

  it('links a third provider (pike13) to the same user by email', async () => {
    const user = await findOrCreateOAuthUser(
      'pike13', 'pike-789', sharedEmail, 'Test User', null,
    );
    expect(user.email).toBe(sharedEmail);

    // Should have THREE UserProvider records, still one user
    const providers = await pool.query(
      `SELECT * FROM "UserProvider" WHERE "userId" = $1 ORDER BY provider`, [user.id],
    );
    expect(providers.rows.length).toBe(3);
    expect(providers.rows.map((r: any) => r.provider).sort()).toEqual(['github', 'google', 'pike13']);

    // Still only one user row for this email
    const users = await pool.query(
      `SELECT * FROM "User" WHERE email = $1`, [sharedEmail],
    );
    expect(users.rows.length).toBe(1);
  });

  it('returns existing user when same provider+id logs in again', async () => {
    const user = await findOrCreateOAuthUser(
      'github', 'gh-123', sharedEmail, 'Updated Name', null,
    );
    expect(user.email).toBe(sharedEmail);
    expect(user.displayName).toBe('Updated Name');

    // Still only 3 providers, not 4
    const providers = await pool.query(
      `SELECT * FROM "UserProvider" WHERE "userId" = $1`, [user.id],
    );
    expect(providers.rows.length).toBe(3);
  });

  it('creates separate users for different emails', async () => {
    const otherEmail = `other-${Date.now()}@example.com`;
    const user = await findOrCreateOAuthUser(
      'github', 'gh-999', otherEmail, 'Other User', null,
    );
    expect(user.email).toBe(otherEmail);

    // Different user id from the shared email user
    const sharedUser = await pool.query(
      `SELECT id FROM "User" WHERE email = $1`, [sharedEmail],
    );
    expect(user.id).not.toBe(sharedUser.rows[0].id);
  });
});

/**
 * Test database helper.
 * Uses raw pg Pool for direct DB access in tests.
 * Prisma 7's generated client is ESM-only (uses import.meta) which
 * breaks in Jest's CJS environment, so we use pg directly.
 */
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL || 'postgresql://app:devpassword@localhost:5433/app';

let _pool: Pool | null = null;

export function getTestPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString });
  }
  return _pool;
}

export async function cleanupTestDb(pool: Pool) {
  try {
    // Delete related records first (FK constraints), then test users.
    // Test users always use @example.com or @test.com emails.
    const testEmailPattern = `email LIKE '%@example.com' OR email LIKE '%@test.com'`;

    // Messages reference authorId
    await pool.query(`DELETE FROM "Message" WHERE "authorId" IN (SELECT id FROM "User" WHERE ${testEmailPattern})`).catch(() => {});
    // UserProvider references userId
    await pool.query(`DELETE FROM "UserProvider" WHERE "userId" IN (SELECT id FROM "User" WHERE ${testEmailPattern})`).catch(() => {});
    // RoleAssignmentPattern may reference test patterns
    await pool.query(`DELETE FROM "RoleAssignmentPattern" WHERE pattern LIKE '%@example.com' OR pattern LIKE '%@test.com'`).catch(() => {});
    // Now delete the users themselves
    await pool.query(`DELETE FROM "User" WHERE ${testEmailPattern}`);
    // Clean up test channels — they all contain a 10+ digit timestamp in their names
    await pool.query(`DELETE FROM "Channel" WHERE name ~ '[0-9]{10,}'`).catch(() => {});
  } catch {
    // Tables may not exist yet
  }
}

export async function findUserByEmail(pool: Pool, email: string) {
  const result = await pool.query(`SELECT * FROM "User" WHERE email = $1`, [email]);
  return result.rows[0] || null;
}

export async function findUserById(pool: Pool, id: number) {
  const result = await pool.query(`SELECT * FROM "User" WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

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
    await pool.query(`DELETE FROM "User" WHERE email LIKE '%example.com'`);
  } catch {
    // Table may not exist yet
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

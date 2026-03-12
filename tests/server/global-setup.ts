/**
 * Vitest globalSetup — runs exactly once before all test files start
 * and once after all test files finish.
 * Used for database cleanup so test data doesn't accumulate across runs.
 */
import pg from 'pg';

const connectionString = process.env.DATABASE_URL || 'postgresql://app:devpassword@localhost:5433/app';

async function cleanup() {
  const pool = new pg.Pool({ connectionString });
  try {
    const testEmailPattern = `email LIKE '%@example.com' OR email LIKE '%@test.com'`;

    // Delete related records first (FK constraints), then test users.
    await pool.query(`DELETE FROM "Message" WHERE "userId" IN (SELECT id FROM "User" WHERE ${testEmailPattern})`).catch(() => {});
    await pool.query(`DELETE FROM "UserProvider" WHERE "userId" IN (SELECT id FROM "User" WHERE ${testEmailPattern})`).catch(() => {});
    await pool.query(`DELETE FROM "RoleAssignmentPattern" WHERE pattern LIKE '%@example.com' OR pattern LIKE '%@test.com'`).catch(() => {});
    await pool.query(`DELETE FROM "User" WHERE ${testEmailPattern}`);
    // Clean up test channels — they all contain a 10+ digit timestamp in their names
    await pool.query(`DELETE FROM "Channel" WHERE name ~ '[0-9]{10,}'`).catch(() => {});
  } catch {
    // Tables may not exist yet
  } finally {
    await pool.end();
  }
}

export async function setup() {
  // Clean leftover test data from previous runs
  await cleanup();
}

export async function teardown() {
  // Clean test data created during this run
  await cleanup();
}

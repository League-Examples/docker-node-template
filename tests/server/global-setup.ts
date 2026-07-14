/**
 * Vitest globalSetup — runs exactly once before all test files start
 * and once after all test files finish.
 *
 * Responsibilities:
 *  - Apply Prisma migrations to the test database before any test file
 *    runs, so a pristine checkout doesn't need a manual
 *    `prisma migrate deploy` step (see clasi/issues/test-db-provisioning-broken.md).
 *  - Database cleanup so test data doesn't accumulate across runs.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// tests/server/global-setup.ts -> repo root -> server/
const serverDir = path.resolve(__dirname, '../../server');

const connectionString = process.env.DATABASE_URL || 'file:./data/test.db';

/**
 * Apply pending Prisma migrations to the test database. Idempotent — if
 * the DB is already up to date, `prisma migrate deploy` is a fast no-op.
 * Uses the locally installed `prisma` CLI directly (not `npx`) to avoid
 * npx's registry-resolution overhead on every test run.
 */
function migrate() {
  const prismaBin = path.join(serverDir, 'node_modules', '.bin', 'prisma');
  execFileSync(prismaBin, ['migrate', 'deploy'], {
    cwd: serverDir,
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'inherit',
  });
}

async function cleanup() {
  const Database = (await import('better-sqlite3')).default;
  const dbPath = connectionString.replace('file:', '');
  let db;
  try {
    db = new Database(dbPath);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const tableNames = tables.map((t) => t.name).filter((n) => n !== '_prisma_migrations' && n !== 'sqlite_sequence');
    for (const table of tableNames) {
      db.prepare(`DELETE FROM "${table}"`).run();
    }
  } catch {
    // DB file may not exist yet
  } finally {
    db?.close();
  }
}

export async function setup() {
  migrate();
  await cleanup();
}

export async function teardown() {
  await cleanup();
}

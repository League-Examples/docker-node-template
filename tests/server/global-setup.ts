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
    // Best-effort: load sqlite-vec so the `VecEmbeddings` vec0 virtual table
    // (created lazily by server/src/services/search.ts, ticket 002-005) can
    // be found and cleared here too, on platforms where the extension is
    // available. If it isn't, the per-table try/catch below skips just that
    // table instead of aborting cleanup for every other table -- a vec0
    // virtual table left over from a previous run is unusable without the
    // module loaded on this connection ("no such module: vec0"), regardless
    // of which table this cleanup pass currently cares about.
    try {
      const sqliteVec = await import('sqlite-vec');
      sqliteVec.load(db);
    } catch {
      // No sqlite-vec on this platform -- fine, see comment above.
    }
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const tableNames = tables.map((t) => t.name).filter((n) => n !== '_prisma_migrations' && n !== 'sqlite_sequence');
    for (const table of tableNames) {
      try {
        db.prepare(`DELETE FROM "${table}"`).run();
      } catch {
        // A virtual table whose module isn't loaded on this connection --
        // skip rather than abort the whole cleanup pass.
      }
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

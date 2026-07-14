import fs from 'fs';
import path from 'path';

// Lazy-initialized Prisma client with SQLite adapter.
let _prisma: any;

// Create the leaf directory holding the SQLite database file. The parent
// must already exist; only the final path element is created.
function ensureSqliteDir(databaseUrl: string) {
  if (!databaseUrl.startsWith('file:')) return;
  const dbPath = databaseUrl.replace(/^file:/, '');
  const dir = path.dirname(dbPath);
  if (!dir || dir === '.' || dir === '/') return;
  try {
    fs.mkdirSync(dir);
  } catch (err: any) {
    if (err.code === 'EEXIST') return;
    throw err;
  }
}

async function getPrismaClient() {
  if (!_prisma) {
    const { PrismaClient } = await import('../generated/prisma/client');
    const { PrismaBetterSqlite3 } = await import('@prisma/adapter-better-sqlite3');
    ensureSqliteDir(process.env.DATABASE_URL!);
    // `timeout` maps to better-sqlite3's busy_timeout (ms): when a write finds
    // the database locked by another connection, retry for up to this long
    // instead of throwing SQLITE_BUSY immediately. Defensive hardening for
    // any transient lock contention against the shared SQLite file.
    const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL!, timeout: 5000 });
    _prisma = new PrismaClient({ adapter });
  }
  return _prisma;
}

// Proxy that forwards all property access to the lazily-initialized client.
// This lets consuming code use `prisma.model.method()` synchronously after
// the app has started (the server init awaits getPrismaClient first).
export const prisma = new Proxy({} as any, {
  get(_target, prop) {
    if (!_prisma) {
      throw new Error(
        'Prisma client not initialized. Call initPrisma() before using the client.'
      );
    }
    return (_prisma as any)[prop];
  },
});

export async function initPrisma() {
  await getPrismaClient();
}

// Closes the underlying better-sqlite3 connection and clears the cached
// client so a subsequent initPrisma() call opens a fresh one. Used by test
// teardown (see tests/server/setup.ts) so each vitest test file's process
// closes its SQLite connection cleanly before exiting, rather than relying
// on process teardown to release the file handle implicitly.
export async function disconnectPrisma() {
  if (_prisma) {
    await _prisma.$disconnect();
    _prisma = undefined;
  }
}

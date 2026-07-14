// Vitest global setup — runs before all test files
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:./data/test.db';

// Initialize Prisma client so routes that use it (test-login, admin CRUD) work
import { initPrisma, disconnectPrisma } from '../../server/src/services/prisma';
await initPrisma();

// Database cleanup is handled by global-setup.ts (runs once before/after all files).

// Each test file's `prisma.ts` module creates its own PrismaClient and its
// own better-sqlite3 connection to the shared test database file, but the
// connection was never explicitly closed. Vitest runs each file in its own
// forked process (verified: process.pid differs per file even with
// fileParallelism: false), so this isn't a cross-file leak in practice —
// but leaving a synchronous SQLite connection open when a process exits is
// still bad hygiene and a real, if minor, contributor to lock-related
// flakiness within a file's own lifetime. Close it explicitly. Registered
// here (before the test file's own top-level code runs) so it executes
// LAST among this file's afterAll hooks — after any test-level cleanup
// (e.g. an afterAll that deletes rows) has had a chance to run.
afterAll(async () => {
  await disconnectPrisma();
});

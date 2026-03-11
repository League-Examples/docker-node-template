// Vitest global setup — runs before all test files
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://app:devpassword@localhost:5433/app';

// Initialize Prisma client so routes that use it (test-login, admin CRUD) work
import { initPrisma } from '../../server/src/services/prisma';
await initPrisma();

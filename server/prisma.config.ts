import dotenv from 'dotenv';
import path from 'path';
import { defineConfig } from 'prisma/config';

// Load .env from project root (one level up from server/). override: true
// makes .env authoritative over an already-exported shell env var (see
// server/src/env.ts for the rationale). Skip override under the test
// suite, where tests/server/global-setup.ts explicitly passes a test
// DATABASE_URL to this CLI's env and that must win over .env.
dotenv.config({
  path: path.resolve(__dirname, '..', '.env'),
  override: process.env.NODE_ENV !== 'test',
});

export default defineConfig({
  earlyAccess: true,
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL!,
  },
  migrate: {
    url: process.env.DATABASE_URL!,
  },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});

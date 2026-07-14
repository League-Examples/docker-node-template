import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // No seed data yet. The template's `Counter` demo model and
  // env-seeded username/password demo users have been removed
  // (Sprint 002 ticket 007) — login is Google-only, no self-serve
  // or demo accounts. Add Flyerbot-specific seed data here as needed.
  console.log('Seed: nothing to seed');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

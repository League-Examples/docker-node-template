import bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const DEMO_USERS = [
  { username: 'user',  plain: 'pass',  email: 'user@demo.local',  displayName: 'Demo User',  role: 'USER'  as const },
  { username: 'admin', plain: 'admin', email: 'admin@demo.local', displayName: 'Demo Admin', role: 'ADMIN' as const },
];

async function main() {
  // Seed counter rows for alpha and beta — idempotent via upsert.
  for (const name of ['alpha', 'beta']) {
    await prisma.counter.upsert({
      where: { name },
      update: {},
      create: { name, value: 0 },
    });
  }
  console.log('Seed: counter rows upserted (alpha, beta)');

  // Seed demo users with bcrypt-hashed passwords — idempotent via upsert on
  // email (the stable identity). Pre-existing rows from the old demo-login
  // flow have null username, so keying on email lets us backfill them.
  for (const u of DEMO_USERS) {
    const passwordHash = await bcrypt.hash(u.plain, 10);
    await prisma.user.upsert({
      where: { email: u.email },
      update: { username: u.username, passwordHash, role: u.role },
      create: {
        username: u.username,
        email: u.email,
        displayName: u.displayName,
        role: u.role,
        passwordHash,
      },
    });
  }
  console.log('Seed: demo users upserted (user, admin)');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

import bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

type DemoUser = {
  username: string;
  password: string;
  email: string;
  displayName: string;
  role: 'USER' | 'ADMIN';
};

function envDemoUsers(): DemoUser[] {
  const users: DemoUser[] = [];
  const adminU = process.env.ADMIN_USERNAME?.trim();
  const adminP = process.env.ADMIN_PASSWORD?.trim();
  if (adminU && adminP) {
    users.push({
      username: adminU,
      password: adminP,
      email: `${adminU}@demo.local`,
      displayName: 'Demo Admin',
      role: 'ADMIN',
    });
  }
  const demoU = process.env.DEMO_USERNAME?.trim();
  const demoP = process.env.DEMO_PASSWORD?.trim();
  if (demoU && demoP) {
    users.push({
      username: demoU,
      password: demoP,
      email: `${demoU}@demo.local`,
      displayName: 'Demo User',
      role: 'USER',
    });
  }
  return users;
}

async function main() {
  for (const name of ['alpha', 'beta']) {
    await prisma.counter.upsert({
      where: { name },
      update: {},
      create: { name, value: 0 },
    });
  }
  console.log('Seed: counter rows upserted (alpha, beta)');

  const demoUsers = envDemoUsers();
  if (demoUsers.length === 0) {
    console.log('Seed: no ADMIN_USERNAME/DEMO_USERNAME env vars — skipping demo users');
    return;
  }
  for (const u of demoUsers) {
    const passwordHash = await bcrypt.hash(u.password, 10);
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
  console.log(`Seed: demo users upserted (${demoUsers.map((u) => u.username).join(', ')})`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

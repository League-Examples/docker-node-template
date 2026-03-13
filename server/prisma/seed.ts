import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Create default "general" channel if it doesn't exist
  const general = await prisma.channel.upsert({
    where: { name: 'general' },
    update: {},
    create: {
      name: 'general',
      description: 'General discussion',
    },
  });
  console.log(`Seed: channel "${general.name}" (id=${general.id})`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

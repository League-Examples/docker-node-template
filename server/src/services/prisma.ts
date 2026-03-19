// Lazy-initialized Prisma client with dual-provider support.
// SQLite: no adapter needed. Postgres: uses @prisma/adapter-pg.
let _prisma: any;

export function isSqlite(): boolean {
  return (process.env.DATABASE_URL || '').startsWith('file:');
}

async function getPrismaClient() {
  if (!_prisma) {
    const { PrismaClient } = await import('../generated/prisma/client');
    if (isSqlite()) {
      _prisma = new PrismaClient();
    } else {
      const { PrismaPg } = await import('@prisma/adapter-pg');
      const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
      _prisma = new PrismaClient({ adapter });
    }
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

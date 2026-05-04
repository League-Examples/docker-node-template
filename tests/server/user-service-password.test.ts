/**
 * Tests for UserService.findByUsername and UserService.createPasswordUser
 */
import { prisma } from '../../server/src/services/prisma';
import { UserService } from '../../server/src/services/user.service';
import { cleanupTestDb } from './helpers/db';

const userService = new UserService(prisma);

// Unique email domain to keep these tests isolated from other test files
const DOMAIN = '@pwservice.test.com';

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
}, 30000);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await cleanupTestDb();
});

describe('UserService.findByUsername', () => {
  it('returns null when no user has the given username', async () => {
    const result = await userService.findByUsername('nonexistent_user_xyz');
    expect(result).toBeNull();
  });

  it('returns the user when the username exists', async () => {
    await prisma.user.create({
      data: {
        username: 'findme_user',
        email: `findme${DOMAIN}`,
        passwordHash: 'hash',
        role: 'USER',
      },
    });

    const result = await userService.findByUsername('findme_user');
    expect(result).not.toBeNull();
    expect(result!.username).toBe('findme_user');
    expect(result!.email).toBe(`findme${DOMAIN}`);
  });
});

describe('UserService.createPasswordUser', () => {
  it('creates a USER-role user when the database is not empty', async () => {
    // Ensure at least one user exists already (from the findByUsername tests above)
    const user = await userService.createPasswordUser({
      username: 'newpwuser',
      email: `newpwuser${DOMAIN}`,
      passwordHash: 'somehash',
    });

    expect(user).toHaveProperty('id');
    expect(user.username).toBe('newpwuser');
    expect(user.email).toBe(`newpwuser${DOMAIN}`);
    expect(user.passwordHash).toBe('somehash');
    expect(user.role).toBe('USER');
  });

  it('respects an explicitly supplied role', async () => {
    const user = await userService.createPasswordUser({
      username: 'explicit_admin',
      email: `explicit_admin${DOMAIN}`,
      passwordHash: 'hash2',
      role: 'ADMIN',
    });

    expect(user.role).toBe('ADMIN');
  });

  it('stores the optional displayName when supplied', async () => {
    const user = await userService.createPasswordUser({
      username: 'display_user',
      email: `display${DOMAIN}`,
      passwordHash: 'hash3',
      displayName: 'Display Name',
    });

    expect(user.displayName).toBe('Display Name');
  });

  it('promotes the first user to ADMIN when user count is 0', async () => {
    // Use a stub prisma that reports count 0 so we don't need to clear real DB state.
    const createdRows: any[] = [];
    const stubPrisma = {
      user: {
        count: async () => 0,
        create: async (args: any) => {
          const row = { id: 999, ...args.data };
          createdRows.push(row);
          return row;
        },
      },
    };
    const stubService = new UserService(stubPrisma);

    const user = await stubService.createPasswordUser({
      username: 'first_user',
      email: `first${DOMAIN}`,
      passwordHash: 'firsthash',
    });

    expect(user.role).toBe('ADMIN');
  });
});

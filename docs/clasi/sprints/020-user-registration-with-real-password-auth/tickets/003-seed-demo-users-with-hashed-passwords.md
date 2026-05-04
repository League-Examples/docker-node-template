---
id: '003'
title: Seed demo users with hashed passwords
status: done
sprint: '020'
use-cases:
- SUC-003
depends-on:
- '001'
---

# Seed demo users with hashed passwords

## Description

Extend `server/prisma/seed.ts` to upsert the two demo accounts (`user/pass` and
`admin/admin`) as real User rows with bcrypt-hashed passwords. After this ticket, the seed
is the single source of truth for demo credentials — no hardcoded credential arrays in
application code.

This ticket depends on ticket 001 (schema migration + bcryptjs) but does not depend on
ticket 002 (schemas/UserService). It can be merged in any order relative to ticket 002,
as long as both land before ticket 004 (routes).

## Acceptance Criteria

- [x] `server/prisma/seed.ts` upserts a User row for `user` (username) with:
  - `email: 'user@demo.local'`
  - `displayName: 'Demo User'`
  - `role: 'USER'`
  - `passwordHash`: bcrypt hash of `'pass'` at cost 10
- [x] `server/prisma/seed.ts` upserts a User row for `admin` (username) with:
  - `email: 'admin@demo.local'`
  - `displayName: 'Demo Admin'`
  - `role: 'ADMIN'`
  - `passwordHash`: bcrypt hash of `'admin'` at cost 10
- [x] Upsert is keyed on `username` — re-running seed does not create duplicate rows
- [x] Existing counter seed (alpha, beta) is unchanged and still runs
- [x] `npx prisma db seed` completes without error
- [x] `npm run test:server` has no regressions

## Implementation Plan

### Approach

Extend `server/prisma/seed.ts` with two `prisma.user.upsert` calls after the counter seed.
The upsert key is `username`. Each row sets `passwordHash` to the bcrypt hash of the plain
password.

### Files to Modify

**`server/prisma/seed.ts`**

Add after the counter seed block:

```typescript
import bcrypt from 'bcryptjs';

const DEMO_USERS = [
  { username: 'user',  plain: 'pass',  email: 'user@demo.local',  displayName: 'Demo User',  role: 'USER'  as const },
  { username: 'admin', plain: 'admin', email: 'admin@demo.local', displayName: 'Demo Admin', role: 'ADMIN' as const },
];

for (const u of DEMO_USERS) {
  const passwordHash = await bcrypt.hash(u.plain, 10);
  await prisma.user.upsert({
    where: { username: u.username },
    update: { passwordHash, email: u.email, role: u.role },
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
```

### Notes

- **Import path decision:** Rather than importing `hashPassword` from `../src/auth/password.js`,
  this ticket uses `bcryptjs` directly in `seed.ts`. This avoids any module resolution
  uncertainty when `prisma db seed` runs outside the normal TypeScript compilation context.
  Both approaches produce identical output — the direct `bcrypt.hash(plain, 10)` call is
  equivalent to `hashPassword(plain)`.
- The upsert `where` key is `{ username: u.username }`. Ensure the Prisma client exposes
  this unique field after the migration from ticket 001 has been applied and `prisma generate`
  has been re-run.
- The seed is run by `scripts/dev.sh` via `npx prisma db seed`. No script changes are needed.
- Cost factor 10 matches `password.ts`. Do not change it without also updating `password.ts`.

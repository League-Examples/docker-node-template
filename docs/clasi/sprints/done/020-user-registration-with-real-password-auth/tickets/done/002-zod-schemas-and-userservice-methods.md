---
id: '002'
title: Zod schemas and UserService methods
status: done
sprint: '020'
use-cases:
- SUC-001
- SUC-002
depends-on:
- '001'
---

# Zod schemas and UserService methods

## Description

Add the two Zod validation schemas (`registerSchema`, `loginSchema`) that the route handlers
will use, and extend `UserService` with `findByUsername` and `createPasswordUser` — the two
new data-access methods the register and login routes depend on.

This ticket has no user-visible effect by itself; it provides the building blocks that
ticket 004 assembles into routes.

## Acceptance Criteria

- [x] `server/src/auth/schemas.ts` exists and exports `registerSchema` and `loginSchema`
- [x] `registerSchema` validates:
  - `username`: string, 3–30 chars, matches `^[a-zA-Z0-9_]+$`
  - `email`: valid email (`z.email()` or `z.string().email()` depending on Zod v4 API)
  - `password`: string with custom `.refine()` calling `validatePassword` from `password.ts`;
    returns `'invalid_password'` as the error message on failure
- [x] `loginSchema` validates:
  - `username`: non-empty string
  - `password`: non-empty string
- [x] `UserService.findByUsername(username: string)` returns the User row or null
- [x] `UserService.createPasswordUser({ username, email, passwordHash, displayName?, role? })`
  creates a User row with those fields set
- [x] `createPasswordUser` applies first-user ADMIN promotion: if `role` is not supplied and
  `user.count() === 0`, the created user gets `ADMIN` role
- [x] All existing `UserService` methods remain unchanged and their tests pass
- [x] `tsc --noEmit` passes in `server/`
- [x] `npm run test:server` has no regressions

## Implementation Plan

### Approach

1. Create `server/src/auth/schemas.ts` with both Zod schemas.
2. Add `findByUsername` and `createPasswordUser` to `server/src/services/user.service.ts`.

### Files to Create

**`server/src/auth/schemas.ts`**
- Import `z` from `'zod'` (already in server dependencies).
- Import `validatePassword` from `'./password.js'`.
- `registerSchema`: object with `username` (`.min(3).max(30).regex(...)`), `email`
  (`.email()`), `password` (`.string().refine(v => validatePassword(v) === null, { message: 'invalid_password' })`).
- `loginSchema`: object with `username` (`.string().min(1)`), `password` (`.string().min(1)`).

### Files to Modify

**`server/src/services/user.service.ts`**

Add after `getByEmail`:
```
async findByUsername(username: string) {
  return this.prisma.user.findUnique({ where: { username } });
}
```

Add after `create`:
```
async createPasswordUser(data: {
  username: string;
  email: string;
  passwordHash: string;
  displayName?: string;
  role?: 'USER' | 'ADMIN';
}) {
  const role = data.role ?? (
    (await this.prisma.user.count()) === 0 ? 'ADMIN' : 'USER'
  );
  return this.prisma.user.create({ data: { ...data, role } });
}
```

### Testing Plan

- Run `npm run test:server` — no regressions expected (no routes changed yet).
- Manual: import `registerSchema` in a scratch file or test and verify it rejects weak
  passwords and invalid usernames.

### Notes

- The project uses Zod v4. Check existing usage in the codebase for the correct import form
  (`import { z } from 'zod'` vs the Zod v4 namespace API) before writing `schemas.ts`.
- `findByUsername` uses `findUnique` — correct because `username` has `@unique` in the schema.
- `createPasswordUser` deliberately does not call `hashPassword` — hashing is the caller's
  responsibility (the route handler). This keeps the service layer free of auth library
  dependencies.

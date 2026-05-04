---
id: "001"
title: "Schema migration, bcrypt install, and password utility"
status: todo
sprint: "020"
use-cases:
  - SUC-001
  - SUC-002
  - SUC-005
  - SUC-006
depends-on: []
todo:
  - add-user-registration-with-real-password-auth.md
---

# Schema migration, bcrypt install, and password utility

## Description

This ticket lays the foundation for all password-based authentication work. It adds `username`
and `passwordHash` to the User model, installs `bcryptjs`, and creates the `password.ts`
utility module that every other ticket in this sprint depends on.

All new fields are nullable — this ensures the migration applies cleanly to existing OAuth
user rows without any backfill.

## Acceptance Criteria

- [ ] `server/prisma/schema.prisma` has `username String? @unique` on the User model
- [ ] `server/prisma/schema.prisma` has `passwordHash String?` on the User model
- [ ] Migration file `add-username-password` created and applies cleanly: `npx prisma migrate dev --name add-username-password`
- [ ] `bcryptjs` added to `server/package.json` dependencies
- [ ] `@types/bcryptjs` added to `server/package.json` devDependencies
- [ ] `server/src/auth/password.ts` exists and exports `hashPassword`, `verifyPassword`, `validatePassword`
- [ ] `hashPassword(plain)` returns a bcrypt hash at cost factor 10
- [ ] `verifyPassword(plain, hash)` returns `true` for a matching pair, `false` otherwise
- [ ] `validatePassword(plain)` returns `null` when valid; returns an error string when:
  - Password is shorter than 6 characters
  - Password contains fewer than 2 of: {lowercase letter, uppercase letter, digit, symbol}
- [ ] `server/src/auth/` directory is created (may be created by this ticket or ticket 002)
- [ ] `tsc --noEmit` passes in `server/`
- [ ] `npm run test:server` has no regressions

## Implementation Plan

### Approach

1. Edit `server/prisma/schema.prisma` to add the two nullable fields to the `User` model.
2. Run `cd server && npx prisma migrate dev --name add-username-password` to generate the
   migration and regenerate the Prisma client.
3. Run `cd server && npm install bcryptjs` and `npm install -D @types/bcryptjs`.
4. Create `server/src/auth/` directory.
5. Create `server/src/auth/password.ts`.

### Files to Create

**`server/src/auth/password.ts`**
```
// Exports:
// hashPassword(plain: string): Promise<string>  — bcryptjs hash at cost 10
// verifyPassword(plain: string, hash: string): Promise<boolean>
// validatePassword(plain: string): string | null
//   Returns null on success.
//   Returns error string if: plain.length < 6 OR
//   fewer than 2 of {/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/} match.
```

### Files to Modify

- `server/prisma/schema.prisma` — add `username String? @unique` and `passwordHash String?`
  to the `User` model block.
- `server/package.json` — add `bcryptjs` to dependencies, `@types/bcryptjs` to devDependencies.

### Testing Plan

- Run `npm run test:server` to confirm no regressions from the schema change.
- Manual verification: confirm the migration file was created in `server/prisma/migrations/`.
- Manual verification: `npx prisma studio` (or check DB) shows `username` and `passwordHash`
  columns on the `user` table with NULL values for existing rows.

### Notes

- bcryptjs is pure JavaScript — no native compilation. Do not use `bcrypt`.
- Cost factor 10 is the standard for demo/development apps. Do not exceed 12 (too slow for
  tests).
- The `validatePassword` function must be exported as a named export — `schemas.ts` (ticket
  002) imports it directly.

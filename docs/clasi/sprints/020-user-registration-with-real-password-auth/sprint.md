---
id: "020"
title: "User Registration with Real Password Auth"
status: planning
branch: sprint/020-user-registration-with-real-password-auth
use-cases:
  - SUC-001
  - SUC-002
  - SUC-003
  - SUC-004
  - SUC-005
todo:
  - add-user-registration-with-real-password-auth.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 020: User Registration with Real Password Auth

## Goals

Replace the hardcoded demo-login stub with a real password authentication flow. Users can
register new accounts and log in with username + password. The existing demo accounts
(`user/pass`, `admin/admin`) continue to work as real seeded DB users via the same code path.

## Problem

The app's only username/password entry point is `POST /api/auth/demo-login`, which hardcodes
two credential pairs in source code and does not support new user registration. There is no
`username` or `passwordHash` column on the User model. This blocks any real password-based
identity story and makes the template useless as a foundation for apps that need signup flows.

## Solution

1. Add `username` (nullable, unique) and `passwordHash` (nullable) to the User model via a
   Prisma migration.
2. Introduce `server/src/auth/password.ts` for bcryptjs hashing/verification and a lightweight
   password strength rule (≥6 chars, ≥2 character classes).
3. Introduce `server/src/auth/schemas.ts` with Zod schemas for register and login payloads.
4. Add `POST /api/auth/register` and `POST /api/auth/login` routes; remove `demo-login`.
5. Extend `UserService` with `findByUsername` and `createPasswordUser`.
6. Extend `seed.ts` to upsert demo users with real bcrypt-hashed passwords.
7. Update `AuthContext` to use the new login URL and expose a `register()` method.
8. Add a `Register` page and wire `/register` route in `App.tsx`.
9. Ship server tests for register/login and client tests for the Register page; update Login
   page tests for the new "No account yet? Register" link.

## Success Criteria

- `npm run test:server` and `npm run test:client` both pass with zero regressions.
- `user/pass` and `admin/admin` log in successfully via the new `/api/auth/login` endpoint.
- A fresh user can register, is auto-logged in, and is redirected to `/`.
- Duplicate username or email returns 409 with a field-targeted error code.
- Weak passwords are rejected with a 400 + `invalid_password` error.
- `POST /api/auth/demo-login` is gone; `POST /api/auth/test-login` (test gate) remains.

## Scope

### In Scope

- Prisma schema migration: `username`, `passwordHash` fields on User.
- `server/src/auth/password.ts` — bcryptjs wrapper + password rule.
- `server/src/auth/schemas.ts` — Zod register + login schemas.
- `UserService.findByUsername` and `UserService.createPasswordUser`.
- `seed.ts` — upsert `user/pass` and `admin/admin` as real DB rows.
- `POST /api/auth/register` and `POST /api/auth/login` routes.
- Remove `POST /api/auth/demo-login`.
- `AuthContext.register()` + updated login URL.
- `client/src/pages/Register.tsx` (new).
- `/register` route in `App.tsx`.
- Register link on Login page.
- Server tests: `auth-register.test.ts`, `auth-login.test.ts`, remove `auth-demo-login.test.ts`.
- Client tests: `RegisterPage.test.tsx`, update `LoginPage.test.tsx`.

### Out of Scope

- Email verification.
- Rate limiting on auth endpoints.
- Password reset / forgot password flow.
- OAuth user account linking.
- Session expiry or refresh token logic.

## Test Strategy

Server tests use vitest + supertest following the pattern in `tests/server/auth-demo-login.test.ts`.
Each server ticket that adds route behaviour ships its tests in the same ticket.

Client tests use vitest + RTL following the pattern in `tests/client/LoginPage.test.tsx`.
The Register page ticket ships `RegisterPage.test.tsx`; the Login page ticket updates
`LoginPage.test.tsx`.

## Architecture Notes

- `bcryptjs` (pure JS, no native build) is used instead of `bcrypt` for Codespaces
  compatibility.
- `username` and `passwordHash` are nullable on the User model so OAuth users and existing
  rows migrate cleanly with no backfill.
- The first user to register via `/api/auth/register` receives ADMIN role (same logic as the
  current demo-login first-user guard).
- `POST /api/auth/test-login` is NODE_ENV-gated and untouched — it is the supertest
  test-helper bypass.
- Client-side password validation is not added; server validation is the single source of
  truth. Client surfaces server error codes to the correct form field.

## GitHub Issues

None.

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [ ] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [ ] Architecture review passed
- [ ] Stakeholder has approved the sprint plan

## Tickets

| # | Title | Depends On |
|---|-------|------------|
| 001 | Schema migration, bcrypt install, and password utility | — |
| 002 | Zod schemas and UserService methods | 001 |
| 003 | Seed demo users with hashed passwords | 001 |
| 004 | Server register and login routes; remove demo-login | 002, 003 |
| 005 | AuthContext register method and login URL update | 004 |
| 006 | Register page and /register route | 005 |
| 007 | Server auth tests (register + login) | 004 |
| 008 | Client auth tests (Register page + Login page update) | 006 |

Tickets execute serially in the order listed.

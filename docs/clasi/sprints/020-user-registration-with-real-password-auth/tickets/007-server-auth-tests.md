---
id: "007"
title: "Server auth tests (register + login)"
status: todo
sprint: "020"
use-cases:
  - SUC-001
  - SUC-002
  - SUC-003
  - SUC-005
depends-on:
  - "004"
---

# Server auth tests (register + login)

## Description

Write the server-side test suite for the new register and login endpoints, and remove (or
migrate) the now-obsolete `auth-demo-login.test.ts`. The test suite pattern follows the
existing `tests/server/auth-demo-login.test.ts` (vitest + supertest).

## Acceptance Criteria

**`tests/server/auth-register.test.ts`** (new):
- [ ] 201 on valid registration; response body contains `{ user }` with id, email, displayName, role
- [ ] Session cookie is set on 201 response
- [ ] `GET /api/auth/me` after register returns the new user (session works)
- [ ] 409 `username_taken` when registering with an already-taken username
- [ ] 409 `email_taken` when registering with an already-registered email
- [ ] 400 `invalid_password` on a password with fewer than 6 characters
- [ ] 400 `invalid_password` on a password with only one character class (e.g., all lowercase)
- [ ] First registered user in an empty DB receives ADMIN role
- [ ] Second registered user receives USER role
- [ ] 400 on missing required fields (username, email, or password absent)

**`tests/server/auth-login.test.ts`** (new):
- [ ] 200 with `{ user }` on valid credentials
- [ ] Session cookie is set on success
- [ ] `GET /api/auth/me` after login returns the correct user
- [ ] 401 `invalid_credentials` on wrong password
- [ ] 401 `invalid_credentials` on unknown username
- [ ] 401 `invalid_credentials` when user exists but `passwordHash` is null (OAuth-only user)
- [ ] Demo-seeded `user/pass` logs in successfully (requires seed step to have run in test setup)
- [ ] Demo-seeded `admin/admin` logs in with ADMIN role

**`tests/server/auth-demo-login.test.ts`** (remove):
- [ ] File deleted from `tests/server/`

**General:**
- [ ] `npm run test:server` passes with all new tests green and no regressions

## Implementation Plan

### Approach

Study `tests/server/auth-demo-login.test.ts` for the supertest setup pattern:
- How the Express app is imported.
- How `test-login` (`POST /api/auth/test-login`) is used to seed a user for tests that need
  an existing user.
- How cookies are carried across requests in a supertest agent.

Use the same patterns in the new test files.

### Files to Create

**`tests/server/auth-register.test.ts`**
- Import the app and create a supertest agent.
- Each test that needs an existing user in the DB: use `POST /api/auth/test-login` to
  create the pre-requisite user (since `test-login` is the test-helper bypass), OR use
  the register endpoint itself to set up the fixture.
- For "first user gets ADMIN": ensure DB is clean before the test (check how existing tests
  reset state — look for `beforeEach` DB teardown pattern).
- For `invalid_password` cases, submit a body with `password: 'abcde'` (5 chars) and
  `password: 'abcdef'` (6 chars, all lowercase, only one class).

**`tests/server/auth-login.test.ts`**
- Register or seed a user before login tests that need a valid credential.
- For "passwordHash is null" test: create a user via `test-login` (which creates users
  without a passwordHash), then attempt login with that user's username. Expect 401.
- For demo-seeded users: this test requires the seed to have run. Check whether the test
  environment runs `prisma db seed` — if not, set up the demo users in `beforeAll` using
  `POST /api/auth/register`.

### Files to Delete

**`tests/server/auth-demo-login.test.ts`** — remove this file entirely. If any of its
assertions are not covered by the two new test files, migrate them first.

### Testing Plan

- `npm run test:server` — all tests pass.
- If the demo-user seed is not run in the test environment, the `auth-login.test.ts` tests
  for `user/pass` and `admin/admin` must set up those users via register (or skip with a
  comment noting the dependency on seed).

### Notes

- The test pattern for carrying cookies in supertest: use `agent = request.agent(app)` and
  the agent will persist the Set-Cookie header across requests.
- The `test-login` endpoint creates users by email without a password — use it only for
  fixtures that don't need `findByUsername` or password verification.
- Do not add new dependencies to the test suite (vitest and supertest are already installed).
- Test file naming follows the pattern `auth-<feature>.test.ts`.

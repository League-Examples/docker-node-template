---
id: '004'
title: Server register and login routes; remove demo-login
status: done
sprint: '020'
use-cases:
- SUC-001
- SUC-002
- SUC-003
depends-on:
- '002'
- '003'
---

# Server register and login routes; remove demo-login

## Description

This ticket is the core server-side change. It adds `POST /api/auth/register` and
`POST /api/auth/login` to `server/src/routes/auth.ts` and removes `POST /api/auth/demo-login`
(lines 170–220 today, including the `DEMO_CREDENTIALS` constant).

After this ticket, password authentication runs through a single, real code path. The demo
accounts work because the seed (ticket 003) has already created them as real DB rows.

`POST /api/auth/test-login` is untouched.

## Acceptance Criteria

- [x] `POST /api/auth/register` is present in `routes/auth.ts`
  - [x] Parses body with `registerSchema`; returns 400 with Zod error details on invalid input
  - [x] Returns 409 `{ error: 'username_taken' }` when username already exists
  - [x] Returns 409 `{ error: 'email_taken' }` when email already exists
  - [x] Returns 400 `{ error: 'invalid_password' }` when password fails the rule (via Zod refine)
  - [x] Hashes password with `hashPassword` from `password.ts`
  - [x] Creates user via `UserService.createPasswordUser`
  - [x] Establishes session via `req.login()`
  - [x] Returns 201 `{ user: { id, email, displayName, role } }` on success
- [x] `POST /api/auth/login` is present in `routes/auth.ts`
  - [x] Parses body with `loginSchema`
  - [x] Returns 401 `{ error: 'invalid_credentials' }` for unknown username
  - [x] Returns 401 `{ error: 'invalid_credentials' }` for null passwordHash (OAuth-only user)
  - [x] Returns 401 `{ error: 'invalid_credentials' }` for wrong password
  - [x] Establishes session via `req.login()` on success
  - [x] Returns 200 `{ user: { id, email, displayName, role } }` on success
- [x] `POST /api/auth/demo-login` is removed (returns 404 or route does not exist)
- [x] `DEMO_CREDENTIALS` constant is removed from `routes/auth.ts`
- [x] `POST /api/auth/test-login` is unchanged
- [x] All other routes in `auth.ts` (OAuth, `/me`, `/logout`) are unchanged
- [x] `tsc --noEmit` passes in `server/`
- [x] `npm run test:server` has no regressions (existing tests that relied on `demo-login` will
  be deleted in ticket 007)

## Implementation Plan

### Approach

1. Delete the `DEMO_CREDENTIALS` constant and the `authRouter.post('/auth/demo-login', ...)` 
   block (lines 170–220 in the current file).
2. Add the `POST /api/auth/register` handler.
3. Add the `POST /api/auth/login` handler.
4. Add necessary imports: `hashPassword`, `verifyPassword` from `'../auth/password.js'`;
   `registerSchema`, `loginSchema` from `'../auth/schemas.js'`; `UserService` is already
   available via the service registry or direct import — check the existing pattern in `auth.ts`.

### Files to Modify

**`server/src/routes/auth.ts`**

Remove (lines ~170–220):
- `const DEMO_CREDENTIALS = [...]`
- `authRouter.post('/auth/demo-login', ...)`

Add imports at top of file:
```typescript
import { hashPassword, verifyPassword } from '../auth/password.js';
import { registerSchema, loginSchema } from '../auth/schemas.js';
```

Add register route:
```
authRouter.post('/auth/register', async (req, res) => {
  const parse = registerSchema.safeParse(req.body);
  if (!parse.success) {
    // Check if the Zod failure is specifically invalid_password
    const pwErr = parse.error.issues.find(i => i.message === 'invalid_password');
    if (pwErr) return res.status(400).json({ error: 'invalid_password' });
    return res.status(400).json({ error: 'validation_error', details: parse.error.issues });
  }
  const { username, email, password } = parse.data;

  // Uniqueness checks
  if (await userService.findByUsername(username)) {
    return res.status(409).json({ error: 'username_taken' });
  }
  if (await userService.getByEmail(email)) {
    return res.status(409).json({ error: 'email_taken' });
  }

  const passwordHash = await hashPassword(password);
  const user = await userService.createPasswordUser({ username, email, passwordHash });

  req.login(user, (err) => {
    if (err) return res.status(500).json({ error: 'Login failed' });
    res.status(201).json({ user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role } });
  });
});
```

Add login route:
```
authRouter.post('/auth/login', async (req, res) => {
  const parse = loginSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'validation_error' });
  const { username, password } = parse.data;

  const user = await userService.findByUsername(username);
  if (!user || !user.passwordHash) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

  req.login(user, (err) => {
    if (err) return res.status(500).json({ error: 'Login failed' });
    res.json({ user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role } });
  });
});
```

### Testing Plan

- `npm run test:server` — note: `auth-demo-login.test.ts` will fail because the endpoint is
  gone. That test file is deleted in ticket 007. If test runs fail due to this, delete
  `auth-demo-login.test.ts` as part of this ticket instead, and note it in the commit message.
- Manual: use curl or Bruno to POST to `/api/auth/login` with `user`/`pass` — expect 200 and
  session cookie.
- Manual: POST to `/api/auth/demo-login` — expect 404.

### Notes

- How `UserService` is accessed in `auth.ts`: inspect the existing file for the current
  pattern (service registry, direct import, or constructor injection). Use the same pattern.
- The `first-user → ADMIN` promotion is handled inside `UserService.createPasswordUser`
  (ticket 002) — the route handler does not need to check user count.
- The error surface for login deliberately does not distinguish "no such user" from "wrong
  password" — both return 401 `invalid_credentials`. Do not change this.

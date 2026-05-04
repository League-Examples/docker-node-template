---
status: pending
---

# Add user registration with real password auth

## Context

Today the app's username/password sign-in is a demo stub: `/api/auth/demo-login` accepts two hardcoded accounts (`user/pass`, `admin/admin`) and the User model has no password column. OAuth (GitHub/Google) is the only "real" auth path. We want a complete password flow — users can register an account, log in with it, and the demo accounts continue to work as seeded real users.

End state:
- New "Register" link on the login page sends the user to a `/register` form (username, email, password ×2).
- Server validates, checks uniqueness, bcrypt-hashes the password, creates the user, and auto-logs them in.
- Existing demo accounts (`user/pass`, `admin/admin`) keep working, but as real DB rows seeded with hashed passwords — single code path.
- OAuth users continue to work unchanged (username stays null for them).

## Design decisions (confirmed with stakeholder)

1. **Demo accounts → real seeded users.** Replace hardcoded `DEMO_CREDENTIALS` array with a dev-seed step that upserts `user/pass` and `admin/admin` with bcrypt-hashed passwords.
2. **Username nullable, unique.** Required for password-registered users; null for OAuth users (they identify by email).
3. **Auto-login after register**, redirect to `/`.
4. **Password rules: lightweight.** Min 6 chars, must contain at least 2 of: lowercase, uppercase, digit, symbol. No length cap beyond DB column. No "must contain X numbers" pedantry.
5. **No email verification, no rate limiting.** Demo app — flag as future work in code comments only if a one-liner.

## Schema changes

**File:** [server/prisma/schema.prisma](server/prisma/schema.prisma)

Add to `User` model:
```prisma
username     String?  @unique
passwordHash String?
```

Both nullable so OAuth users (and existing rows) migrate cleanly. Run `npx prisma migrate dev --name add-username-password`.

## Server changes

### Dependencies
Add `bcryptjs` to `server/package.json` (pure-JS, no native build — easier in Codespaces than `bcrypt`). Add `@types/bcryptjs` to devDependencies.

### Password hashing utility (new)
**File:** `server/src/auth/password.ts` (new)
- `hashPassword(plain: string): Promise<string>` — bcryptjs, cost factor 10.
- `verifyPassword(plain: string, hash: string): Promise<boolean>`.
- Export a `validatePassword(plain: string): string | null` that returns null on success or an error string. Rule: ≥6 chars and ≥2 of {lower, upper, digit, symbol}.

### Validation schemas (new)
**File:** `server/src/auth/schemas.ts` (new) — Zod (already in deps, version 4).
- `registerSchema`: `username` (3–30 chars, `^[a-zA-Z0-9_]+$`), `email` (`z.email()`), `password` (string, custom refine using `validatePassword`).
- `loginSchema`: `username` (string), `password` (string).

### New routes
**File:** [server/src/routes/auth.ts](server/src/routes/auth.ts)

- `POST /api/auth/register` — parse body with `registerSchema`. Check `username` uniqueness (`UserService.findByUsername` — new method) and `email` uniqueness (existing `findByEmail`). On collision, return 409 with `{ error: 'username_taken' }` or `{ error: 'email_taken' }` so the client can show the right message. On success, hash password, create user (first user → ADMIN, same logic as today's demo-login at lines 195–205), establish session via `req.login()` (Passport), return `{ user }`.
- `POST /api/auth/login` — parse with `loginSchema`. Look up user by `username`. If no user or `passwordHash` missing or `verifyPassword` fails → 401 with generic `{ error: 'invalid_credentials' }` (don't leak which field was wrong). On success, `req.login()`, return `{ user }`.
- **Remove** `POST /api/auth/demo-login` (lines 178–220). The client switches to `/api/auth/login`. The two demo accounts now exist as real DB rows.
- Keep `POST /api/auth/test-login` as-is (NODE_ENV gated, used by tests that bypass password).

### UserService
**File:** [server/src/services/user.service.ts](server/src/services/user.service.ts)
- Add `findByUsername(username: string)`.
- Add `createPasswordUser({ username, email, passwordHash, displayName?, role })`.

### Seed demo users on dev startup
The repo already has a "seed counter rows on dev startup" step (commit `1661eae`). Add a parallel "seed demo users" step in the same place.
- **File:** [server/prisma/seed.ts](server/prisma/seed.ts) — extend with two `user.upsert` calls keyed by username:
  - `user / pass / user@demo.local / USER`
  - `admin / admin / admin@demo.local / ADMIN`
  - Each gets `passwordHash` from `hashPassword(...)`.
- This runs as part of `npx prisma db seed`, which `scripts/dev.sh` already invokes.

## Client changes

### Login page
**File:** [client/src/pages/Login.tsx](client/src/pages/Login.tsx)

- Change the form's `onSubmit` to call `loginWithCredentials` against `/api/auth/login` (rename the AuthContext method or just update the URL — see below).
- Below the OAuth provider buttons, add: `<hr class="border-slate-200 my-2" />`, then a small centered block: `<p class="text-xs text-slate-500">No account yet? <Link to="/register" class="font-medium text-indigo-600 hover:underline">Register</Link></p>`.
- The white "Register" button the stakeholder described becomes a small text-link in the "No account yet?" line — that matches their "small text" description and keeps the CTA visually subordinate to Sign in. (If the stakeholder wants a full white button instead, swap the `<p>` for a `<Link>` styled as `bg-white border border-slate-300 ...` button — flag this in the implementation.)

### Register page (new)
**File:** `client/src/pages/Register.tsx` (new)
- Same Tailwind styling as Login.
- Fields: `username`, `email`, `password`, `confirmPassword`.
- Client-side checks: passwords match; surface server-returned errors mapped to fields:
  - `username_taken` → "Pick another username." under the username field.
  - `email_taken` → "This email has been registered. Try to sign in." under the email field, with a link to `/login`.
  - `invalid_password` → show the rule under the password field.
- On success, AuthContext re-fetches `/api/auth/me` and `navigate('/')`.

### Routing
**File:** [client/src/App.tsx](client/src/App.tsx) — add `<Route path="/register" element={<RegisterPage />} />` next to `/login`.

### AuthContext
**File:** [client/src/context/AuthContext.tsx](client/src/context/AuthContext.tsx)
- Update `loginWithCredentials` to POST to `/api/auth/login` (not `/api/auth/demo-login`).
- Add `register({ username, email, password })` returning `{ ok: boolean; error?: string; field?: 'username' | 'email' | 'password' }` so the form can target the error.

## Tests

### Server (vitest + supertest, pattern from [tests/server/auth-demo-login.test.ts](tests/server/auth-demo-login.test.ts))

New file: `tests/server/auth-register.test.ts`
- 201 on valid registration; session cookie set; subsequent `/api/auth/me` returns the user.
- 409 `username_taken` when registering against an existing username.
- 409 `email_taken` when email matches an existing user.
- 400 `invalid_password` on weak passwords (5 chars; all lowercase).
- First registered user gets ADMIN role.

New file: `tests/server/auth-login.test.ts`
- 200 with valid credentials; session works; `/api/auth/me` returns the user.
- 401 with wrong password.
- 401 with unknown username.
- Demo-seeded `user/pass` and `admin/admin` log in successfully (integration check that the seed step ran).

Update: existing [tests/server/auth-demo-login.test.ts](tests/server/auth-demo-login.test.ts) — delete (endpoint removed) or migrate its assertions into `auth-login.test.ts`.

### Client (vitest + RTL, pattern from [tests/client/LoginPage.test.tsx](tests/client/LoginPage.test.tsx))

New file: `tests/client/RegisterPage.test.tsx`
- Mismatched passwords block submit and show inline error.
- `username_taken` from server renders "Pick another username." next to username.
- `email_taken` from server renders "This email has been registered. Try to sign in." next to email with a link to `/login`.
- Successful register calls AuthContext.register and navigates to `/`.

Update: [tests/client/LoginPage.test.tsx](tests/client/LoginPage.test.tsx)
- Assert the "No account yet? Register" link points to `/register`.

## Verification

1. `cd server && npx prisma migrate dev` — confirms schema migration applies cleanly.
2. `npm run test:server` — all server tests green.
3. `npm run test:client` — all client tests green.
4. `npm run dev` — manually verify in browser:
   - `/login` shows username/password form, three OAuth buttons, hr, "No account yet? Register" link.
   - Sign in with `user / pass` (seeded demo) → lands on `/`, `/api/auth/me` shows USER role.
   - Sign in with `admin / admin` → ADMIN role.
   - Click Register → `/register` form. Try `user` as username → "Pick another username." Try `user@demo.local` as email → "This email has been registered."
   - Register with fresh `alice / alice@example.com / Pa$$w0rd` → auto-redirect to `/`, logged in as alice.
   - Try password `abcdef` (no diversity) → server rejects, error renders inline.
5. Logout, log back in as alice → confirms password persistence.

## Files touched (summary)

- [server/prisma/schema.prisma](server/prisma/schema.prisma) — add `username`, `passwordHash`.
- [server/prisma/seed.ts](server/prisma/seed.ts) — seed demo users.
- [server/src/routes/auth.ts](server/src/routes/auth.ts) — add register/login, remove demo-login.
- [server/src/services/user.service.ts](server/src/services/user.service.ts) — add `findByUsername`, `createPasswordUser`.
- `server/src/auth/password.ts` (new) — hashing + rule.
- `server/src/auth/schemas.ts` (new) — Zod.
- `server/package.json` — add bcryptjs.
- [client/src/pages/Login.tsx](client/src/pages/Login.tsx) — Register link, switch to `/api/auth/login`.
- `client/src/pages/Register.tsx` (new).
- [client/src/App.tsx](client/src/App.tsx) — `/register` route.
- [client/src/context/AuthContext.tsx](client/src/context/AuthContext.tsx) — update login URL, add `register()`.
- `tests/server/auth-register.test.ts` (new).
- `tests/server/auth-login.test.ts` (new).
- [tests/server/auth-demo-login.test.ts](tests/server/auth-demo-login.test.ts) — remove (or migrate).
- `tests/client/RegisterPage.test.tsx` (new).
- [tests/client/LoginPage.test.tsx](tests/client/LoginPage.test.tsx) — update assertions.

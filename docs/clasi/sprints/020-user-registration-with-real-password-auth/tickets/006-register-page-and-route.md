---
id: "006"
title: "Register page and /register route"
status: todo
sprint: "020"
use-cases:
  - SUC-001
  - SUC-004
  - SUC-005
depends-on:
  - "005"
---

# Register page and /register route

## Description

Add `client/src/pages/Register.tsx` — the user-facing registration form — and wire it to
`/register` in `client/src/App.tsx`. Also add the "No account yet? Register" text link to
the Login page.

The Register page uses `AuthContext.register()` (added in ticket 005) and navigates to `/`
on success.

## Acceptance Criteria

**Register page (`client/src/pages/Register.tsx`):**
- [ ] Page renders four fields: `username`, `email`, `password`, `confirmPassword`
- [ ] Tailwind styling matches `Login.tsx` (same card layout, same input style, same button style)
- [ ] Client-side check: if `password !== confirmPassword`, submit is blocked and an inline
  error is shown under `confirmPassword` without hitting the server
- [ ] On submit, calls `AuthContext.register({ username, email, password })`
- [ ] On `{ ok: true }` response, navigates to `/`
- [ ] On `{ ok: false, field: 'username' }`, shows "Pick another username." under the username
  field
- [ ] On `{ ok: false, field: 'email' }`, shows "This email has been registered. Try to sign in."
  under the email field, with a `<Link to="/login">` wrapping "sign in"
- [ ] On `{ ok: false, field: 'password' }`, shows the password rule under the password field
  (e.g., "Password must be at least 6 characters and contain at least 2 of: lowercase,
  uppercase, digit, symbol.")
- [ ] On generic error, shows a fallback error message
- [ ] Submit button is disabled (or shows loading state) while the request is in flight
- [ ] Page title / heading is "Create account" (or similar — match the Login page heading style)

**Login page (`client/src/pages/Login.tsx`):**
- [ ] Below the form (after the OAuth buttons), renders a small text block:
  "No account yet? [Register]" where [Register] is a `<Link to="/register">` styled as
  `font-medium text-indigo-600 hover:underline`
- [ ] Existing login form behaviour is unchanged

**Routing (`client/src/App.tsx`):**
- [ ] `<Route path="/register" element={<RegisterPage />} />` added alongside `/login`
- [ ] All existing routes unchanged

**General:**
- [ ] `tsc --noEmit` passes in `client/`
- [ ] `npm run test:client` has no regressions

## Implementation Plan

### Approach

1. Create `client/src/pages/Register.tsx`.
2. Edit `client/src/App.tsx` to add the `/register` route.
3. Edit `client/src/pages/Login.tsx` to add the Register link.

### Files to Create

**`client/src/pages/Register.tsx`**
- Copy the outer card/layout structure from `Login.tsx` as a starting point.
- Use `useState` for `username`, `email`, `password`, `confirmPassword`, `fieldErrors`
  (object keyed by field name), `loading`.
- `handleSubmit`: check password match first (client-only). Then call `AuthContext.register`.
  Map the returned `{ ok, error, field }` to `fieldErrors`. On success, call
  `navigate('/')`.

### Files to Modify

**`client/src/App.tsx`**
- Import `RegisterPage` from `'./pages/Register.js'` (or `.tsx` depending on project
  convention — check existing imports for the pattern).
- Add `<Route path="/register" element={<RegisterPage />} />` next to the `/login` route.

**`client/src/pages/Login.tsx`**
- Find the bottom of the form or the area below the OAuth buttons.
- Add:
  ```tsx
  <p className="text-xs text-center text-slate-500 mt-4">
    No account yet?{' '}
    <Link to="/register" className="font-medium text-indigo-600 hover:underline">
      Register
    </Link>
  </p>
  ```
- Ensure `Link` is imported from `'react-router-dom'` (it likely already is).

### Testing Plan

- `npm run test:client` — no regressions expected from the App.tsx and Login.tsx changes.
- Register page tests are written in ticket 008.
- Manual verification:
  1. Visit `/login`, see "No account yet? Register" link, click it → `/register`.
  2. On `/register`, enter mismatched passwords → inline error, no network request.
  3. Register as `alice / alice@example.com / Pa$$w0rd` → redirected to `/`, logged in.
  4. Try to register with `alice` again → "Pick another username." shown.
  5. Try `alice@example.com` again → email error with sign-in link.
  6. Try `abc123` (only lowercase+digit, < 6 chars threshold met but 1 class) → wait, `abc123`
     has 2 classes. Try `abcdef` (all lowercase, < 2 classes) → password rule error shown.

### Notes

- Match the exact Tailwind class names used in `Login.tsx` for input fields and the primary
  button, to ensure visual consistency. Read `Login.tsx` before writing `Register.tsx`.
- The Register link on Login page is a small text-link, not a button. If the stakeholder
  later requests a full white button, the swap is: replace the `<p>` with a `<Link>`
  styled as `block w-full text-center ...`. Flag this as a comment in the Login.tsx change.
- The page is public — no auth guard needed on the `/register` route.

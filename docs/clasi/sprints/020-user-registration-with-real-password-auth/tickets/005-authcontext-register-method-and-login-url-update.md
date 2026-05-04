---
id: "005"
title: "AuthContext register method and login URL update"
status: todo
sprint: "020"
use-cases:
  - SUC-001
  - SUC-002
depends-on:
  - "004"
---

# AuthContext register method and login URL update

## Description

Update `client/src/context/AuthContext.tsx` to:
1. Change the `loginWithCredentials` POST target from `/api/auth/demo-login` to
   `/api/auth/login`.
2. Add a `register({ username, email, password })` method that the Register page (ticket 006)
   will call.

This ticket must land after ticket 004 because the `demo-login` endpoint is gone from the
server once that ticket is merged. If the client still POSTs to `demo-login` after ticket 004,
the login page will stop working.

## Acceptance Criteria

- [ ] `loginWithCredentials` in `AuthContext` POSTs to `/api/auth/login`
- [ ] `loginWithCredentials` behaviour is otherwise unchanged (same return type, same error
  handling)
- [ ] `AuthContext` exports a `register({ username, email, password })` function
- [ ] `register` POSTs to `POST /api/auth/register`
- [ ] `register` returns `{ ok: true }` on 201 response
- [ ] `register` returns `{ ok: false, error: string, field?: 'username' | 'email' | 'password' }`
  on error responses, mapping:
  - `username_taken` → `{ ok: false, error: 'username_taken', field: 'username' }`
  - `email_taken` → `{ ok: false, error: 'email_taken', field: 'email' }`
  - `invalid_password` → `{ ok: false, error: 'invalid_password', field: 'password' }`
  - Other errors → `{ ok: false, error: <server error string> }`
- [ ] `register` re-fetches `/api/auth/me` on success (to refresh AuthContext user state)
- [ ] `AuthContext` type exports are updated so the `register` method is typed in the context
  value
- [ ] `tsc --noEmit` passes in `client/`
- [ ] `npm run test:client` has no regressions

## Implementation Plan

### Approach

1. Open `client/src/context/AuthContext.tsx`.
2. Find the `loginWithCredentials` function and change the POST URL string from
   `'/api/auth/demo-login'` to `'/api/auth/login'`.
3. Add the `register` function as an async function in the same file.
4. Add `register` to the context value and type.

### Files to Modify

**`client/src/context/AuthContext.tsx`**

URL change — find:
```typescript
fetch('/api/auth/demo-login', {
```
Replace with:
```typescript
fetch('/api/auth/login', {
```

Add register function (after `loginWithCredentials`):
```typescript
const register = async ({
  username,
  email,
  password,
}: {
  username: string;
  email: string;
  password: string;
}): Promise<{ ok: boolean; error?: string; field?: 'username' | 'email' | 'password' }> => {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password }),
  });
  if (res.status === 201) {
    await refetchUser(); // or however the context refreshes user state
    return { ok: true };
  }
  const body = await res.json().catch(() => ({}));
  const error = body.error ?? 'unknown_error';
  const fieldMap: Record<string, 'username' | 'email' | 'password'> = {
    username_taken: 'username',
    email_taken: 'email',
    invalid_password: 'password',
  };
  return { ok: false, error, field: fieldMap[error] };
};
```

Update the context value type to include `register`.

### Testing Plan

- `npm run test:client` — existing LoginPage tests should pass; the mock for `loginWithCredentials`
  does not care about the URL.
- If `loginWithCredentials` is tested via a mock server, update the test fixture URL.
- Manual: start dev server, visit `/login`, enter `user`/`pass`, confirm login works.

### Notes

- How `AuthContext` refreshes user state: look at the existing `loginWithCredentials`
  implementation to find the pattern used to update the `user` in context after login
  (likely a `setUser` call from the response body, or a `refetch` of `/api/auth/me`).
  Apply the same pattern in `register`.
- The `register` method on the context is consumed only by the Register page (ticket 006).
  It is not needed by any existing component.

---
status: done
sprint: '005'
tickets:
- 005-003
- 005-007
---

# Account menu + first-user-becomes-admin (auth/account UX)

Two auth/account requirements from the stakeholder, to land alongside the
real two-pane app in sprint 005.

## 1. First-user-becomes-admin

The very first user account to authenticate (Google OAuth) is automatically
granted the ADMIN role, bootstrapping the initial admin without the
`ADMIN_PASSWORD` form or manual DB role editing. Every subsequent user
receives the default (non-admin) role.

- Determination is "first user in the users table" — the account created
  when the table is otherwise empty.
- Must be race-safe (two simultaneous first logins must not both become
  admin).

## 2. Account menu

Clicking the username in the app chrome opens the Account view, which must
contain:

- (a) a link into the **Admin** console — visible only to ADMIN-role users;
- (b) a **Log out** action.

Today the admin console at `/admin` is fully built but unreachable from the
UI — nothing links to it. This closes that gap.

## Refs

- `client/src/pages/admin/AdminLogin.tsx` — ADMIN-role users already bypass
  the password form (auto-redirect to `/admin/users`).
- `client/src/pages/Account.tsx` — account view to extend.
- `client/src/context/AuthContext.tsx` — session/user + logout.
- `client/src/lib/roles.ts` — `hasAdminAccess(role)`.
- `server/src/routes/admin/auth.ts` — admin password login (kept as fallback).
- Related: [[real-two-pane-app]] (the broader sprint-005 UI promotion).

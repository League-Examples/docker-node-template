---
sprint: "018"
status: draft
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Use Cases — Sprint 018

## SUC-001: Demo Login as Regular User

- **Actor:** Unauthenticated visitor
- **Preconditions:** App is running; user is not logged in.
- **Main Flow:**
  1. User navigates to `/login`.
  2. Form is displayed pre-filled with `user` / `pass`.
  3. User submits the form (credentials accepted as-is or changed).
  4. Server validates credentials against hardcoded pairs; matches `user`/`pass` → USER role.
  5. Server finds-or-creates `User { email: "user@demo.local", role: USER }` and establishes session.
  6. User is redirected to `/` and sees the counter UI.
  - **Alternate (bad credentials):** User submits unknown credentials → 401 → form shows error; no redirect.
- **Postconditions:** Session established; `req.user` is the demo user; role badge shows USER.
- **Acceptance Criteria:**
  - [ ] `/login` shows a form with username and password inputs pre-filled with `user` / `pass`
  - [ ] Valid `user`/`pass` redirects to `/` and shows counter UI
  - [ ] Invalid credentials return an error message on the form (no redirect)
  - [ ] No OAuth button or Pike13 link is present on the login page

---

## SUC-002: Demo Login as Admin User

- **Actor:** Unauthenticated visitor
- **Preconditions:** App is running; user is not logged in.
- **Main Flow:**
  1. User navigates to `/login`, enters `admin` / `admin`, and submits.
  2. Server matches `admin`/`admin` → ADMIN role; finds-or-creates `User { email: "admin@demo.local", role: ADMIN }`.
  3. User is redirected to `/` and sees the counter UI with Admin and Configuration links in the sidebar.
- **Postconditions:** Session established; `req.user.role === ADMIN`; admin sidebar links visible.
- **Acceptance Criteria:**
  - [ ] `admin`/`admin` login succeeds and creates/finds admin@demo.local
  - [ ] Sidebar shows Configuration (→ /admin/config) and Admin links only for ADMIN role
  - [ ] USER role login does not show Configuration or Admin links

---

## SUC-003: Increment Named Counter

- **Actor:** Authenticated user (any role)
- **Preconditions:** User is logged in; counters `alpha` and `beta` exist in the database (seeded).
- **Main Flow:**
  1. User is on the home page `/`.
  2. Both counter names and their current values are displayed.
  3. User clicks the button for one counter (e.g., `alpha`).
  4. Client POSTs to `/api/counters/alpha/increment`.
  5. Server increments `Counter.value` for `alpha` and returns the new value.
  6. Client updates the displayed value; `beta` counter is unchanged.
  7. User reloads the page; both counters show the persisted values.
- **Postconditions:** `Counter.value` for the clicked counter is incremented by 1 and persisted.
- **Acceptance Criteria:**
  - [ ] Home page displays `alpha` and `beta` counters with their current values
  - [ ] Clicking the `alpha` button increments only `alpha`; `beta` is unchanged
  - [ ] Clicking the `beta` button increments only `beta`; `alpha` is unchanged
  - [ ] Values persist across page reload (stored in database, not in-memory)
  - [ ] Counter row is auto-created on first increment if missing (upsert behavior)

---

## SUC-004: Admin Impersonates a User

- **Actor:** Authenticated admin
- **Preconditions:** Admin is logged in; at least one other user exists in the database.
- **Main Flow:**
  1. Admin navigates to Admin > Users.
  2. Each user row has an "Impersonate" button (button absent on own row).
  3. Admin clicks "Impersonate" on a target user.
  4. Client POSTs to `/api/admin/users/:id/impersonate`.
  5. Server validates target exists and prevents self-impersonation; sets `req.session.impersonatingUserId` and `realAdminId`.
  6. Page reloads; app presents as the target user (role badge, nav links, data scope).
  7. A colored impersonation banner is visible (e.g., "Viewing as: {displayName}").
  8. Account dropdown shows "Stop impersonating" instead of "Log out".
- **Postconditions:** Session carries impersonation state; `req.user` is the target user; `req.realAdmin` is the original admin.
- **Acceptance Criteria:**
  - [ ] "Impersonate" button appears in each user row except the admin's own row
  - [ ] Clicking Impersonate sets session state and reloads page as target user
  - [ ] Role badge and nav links reflect the target user's role
  - [ ] Impersonation banner is visible with target user's display name
  - [ ] Account dropdown shows "Stop impersonating" (not "Log out") during impersonation
  - [ ] Attempting to impersonate self returns an error

---

## SUC-005: Admin Stops Impersonating

- **Actor:** Admin currently impersonating another user
- **Preconditions:** Active impersonation session exists.
- **Main Flow:**
  1. Admin clicks "Stop impersonating" in the account dropdown.
  2. Client POSTs to `/api/admin/stop-impersonating`.
  3. Server clears `impersonatingUserId` and `realAdminId` from the session.
  4. Page reloads; app presents as the admin's own identity.
  5. Impersonation banner disappears; "Log out" reappears in the dropdown.
- **Postconditions:** Impersonation fields absent from session; `req.user` is the real admin again.
- **Acceptance Criteria:**
  - [ ] "Stop impersonating" button in account dropdown triggers endpoint and reloads
  - [ ] After stopping, identity is fully restored to the real admin
  - [ ] Impersonation banner is no longer visible
  - [ ] Normal "Log out" appears in dropdown again

---

## SUC-006: Admin Accesses Admin Routes During Impersonation

- **Actor:** Admin currently impersonating a non-admin user
- **Preconditions:** Admin is impersonating a USER-role account.
- **Main Flow:**
  1. Admin navigates to `/admin/*`.
  2. `requireAdmin` detects `req.realAdmin` and checks the real admin's role (ADMIN).
  3. Access is granted; the admin panel loads normally.
  4. The impersonation banner remains visible throughout.
- **Postconditions:** Admin panel accessible; impersonation state preserved.
- **Acceptance Criteria:**
  - [ ] Admin can navigate to `/admin/*` while impersonating a non-admin user
  - [ ] `requireAdmin` uses `req.realAdmin.role` when `req.realAdmin` is set
  - [ ] Non-admin users cannot access admin routes directly (unaffected by this sprint)

---

## SUC-007: Docs Auto-Loaded as Agent Rules

- **Actor:** AI agent starting a new session
- **Preconditions:** Sprint 018 docs migration is complete.
- **Main Flow:**
  1. Agent starts a session in the project.
  2. Rules system auto-loads `api-integrations.md`, `deployment.md`, `secrets.md`,
     `setup.md`, `template-spec.md` from `.claude/rules/` based on `paths:` front matter.
  3. Agent can reference OAuth setup, deployment steps, secrets inventory, dev server
     setup, and architecture conventions without manual file lookup.
- **Postconditions:** All five rule files present in `.claude/rules/`; originals absent from `docs/`.
- **Acceptance Criteria:**
  - [ ] All five files exist in `.claude/rules/` with valid YAML `paths:` front matter
  - [ ] Originals no longer exist under `docs/` (api-integrations, deployment, secrets, setup, template-spec)
  - [ ] CLAUDE.md Documentation table updated — stale `docs/` links removed or replaced
  - [ ] No other file in the repo references the old `docs/` paths for migrated files

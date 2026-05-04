---
sprint: '020'
status: approved
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Use Cases — Sprint 020: User Registration with Real Password Auth

## SUC-001: Register a new account

- **Actor:** Unauthenticated visitor
- **Preconditions:** Visitor is not logged in. The desired username and email are not yet
  in the database.
- **Main Flow:**
  1. Visitor navigates to `/register`.
  2. Visitor enters username, email, password, and confirm-password.
  3. Client checks passwords match; if not, shows inline error without submitting.
  4. Client POSTs to `POST /api/auth/register`.
  5. Server validates payload with Zod (`registerSchema`).
  6. Server checks username uniqueness; returns 409 `username_taken` if duplicate.
  7. Server checks email uniqueness; returns 409 `email_taken` if duplicate.
  8. Server validates password strength; returns 400 `invalid_password` if weak.
  9. Server hashes password with bcryptjs (cost 10).
  10. Server creates the User record (first user → ADMIN role).
  11. Server establishes session via `req.login()`.
  12. Server returns 201 `{ user }`.
  13. Client re-fetches `/api/auth/me`, navigates to `/`.
- **Postconditions:** User is logged in, on the home page. DB has User row with hashed
  password. Session cookie is set.
- **Acceptance Criteria:**
  - [ ] 201 response with `{ user }` on valid submission
  - [ ] Session cookie set; `GET /api/auth/me` returns the new user
  - [ ] First registered user receives ADMIN role
  - [ ] Subsequent users receive USER role
  - [ ] 409 `username_taken` on duplicate username
  - [ ] 409 `email_taken` on duplicate email
  - [ ] 400 `invalid_password` on weak password
  - [ ] Client shows field-targeted error for each error code
  - [ ] Client mismatched-password check blocks submit without hitting server

## SUC-002: Log in with username and password

- **Actor:** Registered user (password account) or demo-seeded user
- **Preconditions:** A User record exists with matching `username` and non-null `passwordHash`.
- **Main Flow:**
  1. User navigates to `/login`.
  2. User enters username and password, submits.
  3. Client POSTs to `POST /api/auth/login`.
  4. Server validates payload with Zod (`loginSchema`).
  5. Server looks up user by username; if not found → 401 `invalid_credentials`.
  6. Server checks `passwordHash` is non-null; if null → 401 `invalid_credentials`.
  7. Server calls `verifyPassword(plain, hash)`; if mismatch → 401 `invalid_credentials`.
  8. Server establishes session via `req.login()`.
  9. Server returns 200 `{ user }`.
  10. Client updates AuthContext state.
- **Postconditions:** User is authenticated. Session cookie is set.
- **Acceptance Criteria:**
  - [ ] 200 with `{ user }` on valid credentials
  - [ ] Session works; `GET /api/auth/me` returns correct user
  - [ ] 401 `invalid_credentials` on wrong password (no field leakage)
  - [ ] 401 `invalid_credentials` on unknown username
  - [ ] Demo-seeded `user/pass` logs in successfully
  - [ ] Demo-seeded `admin/admin` logs in successfully

## SUC-003: Demo accounts continue to work after migration

- **Actor:** Developer or demo user
- **Preconditions:** `npx prisma db seed` has been run (invoked by `scripts/dev.sh`).
- **Main Flow:**
  1. Seed upserts `user/pass/user@demo.local/USER` and `admin/admin/admin@demo.local/ADMIN`
     with bcrypt-hashed passwords.
  2. User logs in via `/login` with `user` / `pass` (or `admin` / `admin`).
  3. Normal SUC-002 flow applies.
- **Postconditions:** Demo accounts authenticate via the real login endpoint. `demo-login`
  endpoint does not exist.
- **Acceptance Criteria:**
  - [ ] `user/pass` authenticates via `POST /api/auth/login`
  - [ ] `admin/admin` authenticates via `POST /api/auth/login` with ADMIN role
  - [ ] `POST /api/auth/demo-login` returns 404

## SUC-004: Navigate to Register from Login page

- **Actor:** Unauthenticated visitor on the login page
- **Main Flow:**
  1. Visitor is on the login page.
  2. Visitor sees "No account yet? Register" as a small text link below the form.
  3. Visitor clicks "Register" → navigates to `/register`.
- **Postconditions:** Visitor is on the `/register` page.
- **Acceptance Criteria:**
  - [ ] Login page renders a link pointing to `/register`
  - [ ] Link text includes "Register"

## SUC-005: Weak or invalid password is rejected at registration

- **Actor:** Any user on `/register`
- **Main Flow:**
  1. User submits a password that fails the rule (fewer than 6 chars, or only one
     character class present).
  2. Server returns 400 `{ error: 'invalid_password' }`.
  3. Client renders the password rule error under the password field.
- **Postconditions:** User record is not created. Error is shown inline.
- **Acceptance Criteria:**
  - [ ] Password shorter than 6 chars → 400 `invalid_password`
  - [ ] Password with only one character class (e.g., all lowercase) → 400 `invalid_password`
  - [ ] Password with ≥2 character classes and ≥6 chars → passes validation

## SUC-006: OAuth users are unaffected

- **Actor:** OAuth-authenticated user
- **Preconditions:** None changed by this sprint.
- **Main Flow:** OAuth login flow is unchanged. `username` and `passwordHash` remain null
  for OAuth users.
- **Postconditions:** No regression in OAuth authentication.
- **Acceptance Criteria:**
  - [ ] Existing OAuth tests pass without modification
  - [ ] `username` and `passwordHash` are nullable; no migration errors on existing rows

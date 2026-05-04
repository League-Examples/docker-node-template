---
id: "008"
title: "Client auth tests (Register page + Login page update)"
status: todo
sprint: "020"
use-cases:
  - SUC-001
  - SUC-004
  - SUC-005
depends-on:
  - "006"
---

# Client auth tests (Register page + Login page update)

## Description

Write the client-side tests for `Register.tsx` and update `LoginPage.test.tsx` to assert
the new "No account yet? Register" link. The test pattern follows
`tests/client/LoginPage.test.tsx` (vitest + React Testing Library).

## Acceptance Criteria

**`tests/client/RegisterPage.test.tsx`** (new):
- [ ] Mismatched passwords block submit and show an inline error under confirmPassword (no
  network request made)
- [ ] `username_taken` from the mocked `AuthContext.register` renders "Pick another username."
  adjacent to the username field
- [ ] `email_taken` from the mocked `AuthContext.register` renders "This email has been
  registered. Try to sign in." adjacent to the email field
- [ ] The "sign in" text in the email error is a link to `/login`
- [ ] `invalid_password` from the mocked `AuthContext.register` renders the password rule
  message adjacent to the password field
- [ ] Successful register (mock returns `{ ok: true }`) calls `AuthContext.register` with the
  correct `{ username, email, password }` payload
- [ ] After successful register, `navigate('/')` is called (or the route changes to `/`)

**`tests/client/LoginPage.test.tsx`** (update):
- [ ] Existing tests continue to pass
- [ ] New assertion: the login page renders a link with text "Register" pointing to `/register`

**General:**
- [ ] `npm run test:client` passes with all new/updated tests green and no regressions

## Implementation Plan

### Approach

Study `tests/client/LoginPage.test.tsx` for:
- How `AuthContext` is mocked (likely a wrapper component providing mock context values).
- How `react-router-dom` navigation is handled in tests (likely `MemoryRouter` or a mock
  for `useNavigate`).
- Which RTL queries are used (`getByRole`, `getByLabelText`, `getByText`).

Use the same patterns in `RegisterPage.test.tsx`.

### Files to Create

**`tests/client/RegisterPage.test.tsx`**
- Render `<Register />` inside `MemoryRouter` with a mock `AuthContext` provider.
- The mock context provides a `register` function that can be set per-test to return
  different `{ ok, error, field }` values.
- Use `userEvent.type` to fill fields; `userEvent.click` to submit.
- Assert field errors with `getByText` or `findByText`.
- Assert navigation with a mock for `useNavigate`.

### Files to Modify

**`tests/client/LoginPage.test.tsx`**
- Add a test: `it('renders a Register link pointing to /register', ...)`.
- Query: `screen.getByRole('link', { name: /register/i })` and assert `href` ends with
  `/register` (or use `within` to scope to the "No account yet?" paragraph).

### Testing Plan

- `npm run test:client` — all tests pass.
- If the mock `AuthContext` shape used in `LoginPage.test.tsx` does not include `register`,
  add it (as a no-op mock) to avoid TypeScript errors in the provider.

### Notes

- Do not test Tailwind styling classes — test behaviour and accessible text only.
- The "successful register navigates to /" test: if the project uses `useNavigate` from
  react-router-dom, mock it with `vi.mock('react-router-dom', ...)` following the
  existing pattern in `LoginPage.test.tsx`.
- RTL best practice: prefer `getByRole` and `getByLabelText` over `getByTestId`. Use
  `getByTestId` only as a last resort if accessible queries are not feasible.
- Keep each test focused on one behaviour. Do not combine error-state tests into a single
  assertion block.

---
id: '003'
title: First-user-admin race-safety fix
status: open
use-cases:
- SUC-013
depends-on: []
github-issue: ''
issue: account-menu-first-user-admin.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# First-user-admin race-safety fix

## Description

`server/src/routes/auth.ts`'s `findOrCreateOAuthUser` already implements
first-user-becomes-admin (confirmed in code: its create-new-user branch
reads `const isFirstUser = (await prisma.user.count()) === 0;` then calls
`prisma.user.create({ data: { ..., role: isFirstUser ? 'ADMIN' : 'USER',
... } })`), but as two separate, un-transacted statements — a classic
check-then-act race. Two simultaneous first-time logins can both observe
`count() === 0` before either has committed its `create`, and both become
`ADMIN`.

Fix: wrap the `count()` + `create()` sequence in a single
`prisma.$transaction(async (tx) => { ... })`. SQLite (via
`better-sqlite3`, this project's existing adapter) serializes write
transactions at the database-file level — a second concurrent transaction
attempting its own write blocks until the first commits, at which point
its own `count()` read (inside the same transaction) correctly observes
`1`, not `0`. See `clasi/sprints/005-real-two-pane-app/
architecture-update.md` Design Rationale **R5** for the full alternatives
analysis (a dedicated bootstrap-singleton table and an application-level
mutex were both considered and rejected as more machinery than this
guarantee needs).

This is a **correctness fix to already-shipped code**, not new behavior:
the ADMIN-for-first-user *rule* itself does not change, and every other
branch of `findOrCreateOAuthUser` (existing-provider lookup, email
auto-link, link-mode) is untouched.

## Acceptance Criteria

- [ ] The create-new-user branch's `count()` + `create()` sequence is
      wrapped in one `prisma.$transaction`.
- [ ] **New concurrency test**: two simultaneous calls to
      `findOrCreateOAuthUser` (or the underlying create-new-user logic)
      against an empty `User` table yield exactly one `ADMIN` user and
      one `USER` user — never two `ADMIN`s, never zero.
- [ ] The existing `findOrCreateOAuthUser` test suite (existing-provider
      lookup, email-auto-link, link-mode, single-request first-user case)
      passes unmodified — re-run it explicitly as part of this ticket,
      not just left green by omission (architecture-update.md flags this
      explicitly as a risk: a subtle regression in an unrelated branch
      while adding the wrapper would be high-impact and easy to miss).
- [ ] No new Prisma model, no schema change, no new dependency.

## Implementation Plan

**Approach**: Minimal, surgical change — wrap the two existing statements
in a transaction; do not touch any other branch of the function.

**Files to modify**:
- `server/src/routes/auth.ts` — `findOrCreateOAuthUser`'s create-new-user
  branch only.

**Testing plan**: Add a concurrency test that fires two
`findOrCreateOAuthUser` calls concurrently (e.g. `Promise.all`) against a
freshly-emptied `User` table and asserts exactly one `ADMIN` results.
Re-run the full existing `findOrCreateOAuthUser`/`auth.ts` test file to
confirm no regression in the untouched branches.

**Documentation updates**: None — the rule itself is unchanged and
already documented in `clasi/issues/account-menu-first-user-admin.md`.

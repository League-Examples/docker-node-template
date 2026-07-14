---
id: '007'
title: Fix test-DB provisioning so a pristine checkout passes npm run test:server
status: done
use-cases: []
depends-on: []
github-issue: ''
issue: test-db-provisioning-broken.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Fix test-DB provisioning so a pristine checkout passes npm run test:server

## Description

`clasi/issues/test-db-provisioning-broken.md` diagnoses the root cause: on
a fresh checkout, `server/data/test.db` is created empty by better-sqlite3
on first touch, but Prisma migrations are never applied to it. Every
DB-touching test fails with Prisma P2021 / `no such table: main.User`
(`DriverAdapterError: TableDoesNotExist`) — 57 of 195 server tests fail;
the client suite is unaffected (69/69 green). `tests/server/setup.ts`
points `DATABASE_URL` at `file:./data/test.db` and calls `initPrisma()`,
but nothing runs `prisma migrate deploy` (or equivalent) against that URL
first; `tests/server/global-setup.ts` only clears rows from tables that
already exist and silently swallows the missing-table case. The dev flow
(`scripts/dev.sh`) migrates `dev.db` only, so this gap is invisible in
normal development.

This is process/tooling work, not part of this sprint's product
architecture (auth cleanup or wireframe mockups) — there is no
`architecture-update.md` section for it, and it carries no use case.

**This ticket must execute first**, ahead of tickets 001-006. Per
`.claude/rules/git-commits.md`, all tests must pass before every commit,
and every other ticket in this sprint ends in a commit — so none of them
can be committed cleanly while the server suite fails on a pristine
checkout. (Matching this sprint's existing convention of expressing
sequencing in prose rather than in `depends-on` frontmatter — see ticket
001's Description, which describes ticket 002's dependency on it the same
way. `depends-on` is left `[]` here too, since this ticket itself has no
prerequisites; sequencing is recorded in `sprint.md`'s Tickets table.)

## Acceptance Criteria

- [x] On a pristine checkout, `npm install` (or the project's documented
      install step, e.g. `scripts/install.sh`) followed directly by
      `npm run test:server` passes with no manual database step (no
      developer-run `prisma migrate deploy`, no manual file creation/
      seeding).
- [x] Migrations are applied to the test database automatically as part
      of the test run — e.g. via `tests/server/global-setup.ts` running
      `prisma migrate deploy` (or equivalent programmatic bootstrap)
      against the test `DATABASE_URL` — not via a change to developer
      instructions.
- [x] The fix does not change `scripts/dev.sh` migration behavior for
      `dev.db`, and does not require the test DB file to be committed or
      pre-seeded into the repo.
- [x] All 195 server tests pass (0 failures attributable to missing
      tables); the previously-passing client suite (69/69) remains green.
- [x] The 60-150s timeouts observed in `auth-login`, `auth-register`, and
      `mcp` test files are re-evaluated after the schema fix lands. Either
      they resolve as a downstream symptom of the missing-table errors and
      are confirmed fast/green, or — if they persist — they are fixed, or
      explicitly deferred with a written note in this ticket's Testing
      section (or a follow-up issue) explaining why and what remains.
- [x] `clasi/issues/test-db-provisioning-broken.md` is resolved by this
      ticket (`completes_issue: true`); no other ticket in this sprint
      touches test-DB provisioning.

## Testing

- **Existing tests to run**: Full `tests/server/` suite via
  `npm run test:server` (all 15 files currently affected, not just the
  15 with failures — run the whole suite to confirm no new gaps), and
  `npm run test:client` to confirm the client suite is unaffected
  (69/69 expected, unchanged).
- **New tests to write**: None required for the fix itself (it is test
  infrastructure, not application behavior). If the timeout
  re-evaluation above uncovers a real behavioral bug (not just a
  provisioning artifact), note it here and either fix it in this ticket
  or file a follow-up issue rather than silently leaving it.
- **Verification command**: From a clean clone (or `git clean` of
  `server/data/test.db` plus removing any locally-applied test-DB state),
  run the project's documented install step followed by
  `npm run test:server`; confirm exit code 0 and 195/195 passing with no
  manual intervention between install and test run.

### Results (2026-07-13)

**Fix**: `tests/server/global-setup.ts`'s `setup()` now runs
`prisma migrate deploy` (via the locally installed `server/node_modules/.bin/prisma`
binary, not `npx`, to skip registry-resolution overhead) against the test
`DATABASE_URL` (`file:./data/test.db` by default) before the existing
row-cleanup step, once per `npm run test:server` invocation. It is
idempotent — a no-op when the DB is already migrated — and does not touch
`scripts/dev.sh` or its `dev.db` migration flow, which is untouched.

**Baseline (before fix, `server/data/test.db` present but unmigrated)**:
`npm run test:server` — 15/23 files failed, 57/195 tests failed (all
Prisma P2021 `no such table: main.User` / `TableDoesNotExist`), 97 passed,
41 skipped, run duration 370.73s.

**After fix, verified three ways**:
1. Only `server/data/test.db` removed (simulating a stale/empty file):
   195/195 passed, 12.60s.
2. Entire `server/data/` directory removed (true pristine checkout — no
   dir, no file): 195/195 passed, 11.76s. `prisma migrate deploy` creates
   both the `data/` directory and the SQLite file itself; no extra
   `mkdir` step was needed in the fix.
3. Immediate re-run on an already-migrated DB (idempotency / repeat CI
   runs): 195/195 passed, 11.95s.

`npm run test:client`: 69/69 passed, unaffected, confirming the client
suite was never affected by this bug.

**Timeout re-evaluation** (`auth-login.test.ts`, `auth-register.test.ts`,
`mcp.test.ts`): confirmed as a downstream symptom of the missing-table
errors, not a separate defect. After the migration fix, all three run in
well under a second each:
- `auth-login.test.ts`: 8 tests, 986ms
- `auth-register.test.ts`: 12 tests, 630ms
- `mcp.test.ts`: 4 tests, 92ms

No follow-up issue needed; the 60-150s timeouts do not recur across three
repeated full-suite runs.

`server/data/` remains untracked/gitignored (`data/` in root
`.gitignore`); no test-DB file was committed.

---
id: '002'
title: Fix flaky admin-sessions test
status: open
use-cases: [SUC-006]
depends-on: ['001']
github-issue: ''
issue: flaky-admin-sessions-test.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Fix flaky admin-sessions test

## Description

`tests/server/admin-sessions.test.ts > Admin Sessions API > returns 403
for non-admin` intermittently hits the 30s vitest timeout (observed
2026-07-14: 1 failure in ~5 full-suite runs; passes in ~90ms when
healthy — the sibling tests in the same file pass consistently). The hang
occurs inside the test body starting at
`tests/server/admin-sessions.test.ts:41`, whose first step is
`POST /api/auth/test-login` via a supertest agent — suspicion is a
session-store or SQLite write race under full-suite concurrency, not the
403 logic itself. This ticket depends on ticket 001 (combined `npm test`
script) because verifying the fix requires running the *full* suite
repeatedly, not just the one file in isolation — the bug only reproduces
under full-suite concurrency.

## Acceptance Criteria

- [ ] Root cause is identified and documented in the PR/commit message
      (e.g. "SQLite session-store write contention across vitest workers
      sharing one test DB file" or whatever is actually found).
- [ ] `admin-sessions.test.ts`'s "returns 403 for non-admin" case passes
      20 consecutive full-suite (`npm test`) runs with no timeout.
- [ ] The fix does not slow down the full suite's total runtime by more
      than 20% (measure before/after).
- [ ] If the root cause is structural (shared test DB across concurrent
      vitest workers) and a small mutex/serialization fix is
      insufficient, per-worker test database files are implemented
      instead, with test setup/teardown updated accordingly.
- [ ] No other test in the suite is newly flaky as a result of the fix
      (run the full suite 20 times, not just the one file).

## Implementation Plan

### Approach

1. Reproduce the flake under repetition first: `npx vitest run
   admin-sessions --repeat=20` alone (may not reproduce if the cause is
   full-suite concurrency specific), then the full suite in a loop
   (`for i in $(seq 1 20); do npm test || break; done` or vitest's own
   repeat/retry tooling if available) to confirm the concurrency-specific
   trigger.
2. Inspect the session-store configuration (Prisma-backed session store
   per `server/src/app.ts`) and the test DB setup (global setup file,
   likely shared across vitest worker processes) for write contention
   under `better-sqlite3`'s synchronous, single-writer model.
3. If contention is confirmed: prefer a small, contained fix first (e.g.
   ensure `test-login`'s session write is awaited/serialized correctly,
   or increase a busy-timeout on the SQLite connection used by the
   session store) before reaching for the larger per-worker-DB
   restructuring named in architecture-update.md's Open Question 3.
4. If the small fix doesn't resolve it within a reasonable investigation
   budget, implement per-worker SQLite test database files in the vitest
   global setup, so each worker process gets its own DB file and
   concurrent writes across workers can't contend at the file level.

### Files to Create/Modify

- `tests/server/admin-sessions.test.ts` — no logic change expected
  unless the fix requires test-level serialization; investigate first.
- Session-store configuration (likely `server/src/app.ts` or a
  `server/src/services/session*.ts` file — confirm exact location before
  editing) — possibly add a busy-timeout or serialize session writes.
- Vitest global setup/config (`vitest.config.ts` or a global-setup file
  under `tests/server/`) — if per-worker DB files are needed, this is
  where worker-scoped DB file paths get wired in.

### Testing Plan

- **Existing tests to run**: full suite via `npm test` (ticket 001),
  repeated 20 times per Acceptance Criteria.
- **New tests to write**: none required if the fix is purely
  infrastructural (session store / test DB config); if the investigation
  finds an actual application-level race condition, add a regression
  test that exercises it directly.
- **Verification command**: `npm test` (repeated 20x in CI or a local
  loop; single invocation is not sufficient to close this ticket given
  the bug is intermittent).

### Documentation Updates

If the root cause and fix are non-obvious (e.g. per-worker DB files),
add a short note to the project-knowledge skill or a code comment near
the vitest global setup explaining why the pattern exists, so a future
contributor doesn't "simplify" it back into a shared DB file.

## Testing

- **Existing tests to run**: `npm test` (full suite), 20 consecutive
  runs.
- **New tests to write**: none expected; add a regression test only if
  an actual application race condition (not test infra) is found.
- **Verification command**: `npm test` (repeated 20x)

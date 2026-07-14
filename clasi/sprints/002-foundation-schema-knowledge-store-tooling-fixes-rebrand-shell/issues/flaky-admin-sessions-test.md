---
status: in-progress
sprint: '002'
tickets:
- 002-002
---

# Flaky server test: admin-sessions "returns 403 for non-admin" times out intermittently

`tests/server/admin-sessions.test.ts > Admin Sessions API > returns 403
for non-admin` intermittently hits the 30s vitest timeout (observed
2026-07-14: 1 failure in ~5 full-suite runs; passes in ~90ms when
healthy... the sibling tests in the same file pass).

The hang occurs inside the test body starting at
`tests/server/admin-sessions.test.ts:41` — first step is
`POST /api/auth/test-login` via a supertest agent, so the suspicion is a
session-store or SQLite write race under full-suite concurrency rather
than the 403 logic itself.

## Impact

Breaks the tests-must-pass-before-commit rule at random; wastes 30s per
occurrence. No production impact known.

## Suggested investigation

- Reproduce under repetition (`vitest run admin-sessions --repeat` or a
  loop) and with the full suite running concurrently.
- Check whether test files share the same SQLite test DB and session
  store concurrently (vitest workers) and whether better-sqlite3 write
  contention can stall a session save.
- Fix or, if the root cause is systemic to the shared test DB, consider
  per-worker DB files in global setup.

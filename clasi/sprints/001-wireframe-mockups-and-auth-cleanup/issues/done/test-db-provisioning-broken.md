---
status: done
sprint: '001'
tickets:
- '007'
---

# Server test suite fails on pristine checkout — test DB never migrated

On a fresh checkout + `scripts/install.sh`, `npm run test:server` fails
57 of 195 tests across 15 files. Client suite passes (69/69).

## Diagnosis (read-only, 2026-07-13)

Root cause: `server/data/test.db` is created empty (better-sqlite3 opens it
on first touch) but Prisma migrations are never applied to it. Every
DB-touching test fails with Prisma P2021 / `no such table: main.User`
(`DriverAdapterError: TableDoesNotExist`).

- `tests/server/setup.ts` sets `DATABASE_URL=file:./data/test.db` and calls
  `initPrisma()`, but nothing runs `prisma migrate deploy` against that URL.
- `tests/server/global-setup.ts` only deletes rows from existing tables
  (and silently swallows the missing-table case).
- The dev flow (`scripts/dev.sh`) migrates `dev.db` only.

Secondary: two test files (`auth-login`, `auth-register`, `mcp`) also show
60–150s timeouts, likely a downstream symptom — re-evaluate after the
schema fix.

## Suggested fix (for the programmer to validate)

Apply migrations to the test database automatically in the Vitest global
setup (e.g., run `prisma migrate deploy` with the test `DATABASE_URL` in
`tests/server/global-setup.ts`, or an equivalent programmatic bootstrap),
so a pristine checkout passes `npm run test:server` with no manual steps.
Re-run the full suite and confirm green or characterize any remaining
failures.

## Why this blocks sprint 001

Per `.claude/rules/git-commits.md`, tests must pass before every commit;
no sprint ticket can be committed cleanly until this is fixed. It should
be the first ticket executed.

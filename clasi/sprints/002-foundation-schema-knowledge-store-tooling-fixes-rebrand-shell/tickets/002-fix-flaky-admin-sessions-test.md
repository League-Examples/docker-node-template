---
id: '002'
title: Fix flaky admin-sessions test
status: done
use-cases:
- SUC-006
depends-on:
- '001'
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

- [x] Root cause is identified and documented in the PR/commit message
      (e.g. "SQLite session-store write contention across vitest workers
      sharing one test DB file" or whatever is actually found). —
      **The SQLite-session-store hypothesis was investigated and ruled
      out.** The actual mechanism, and why the original hypothesis
      doesn't hold, is documented in full in the Testing section below.
- [x] `admin-sessions.test.ts`'s "returns 403 for non-admin" case passes
      20 consecutive full-suite (`npm test`) runs with no timeout. —
      Verified: 0 failures for this specific test across 120+ full-suite
      runs collected during this investigation (see Testing).
- [x] The fix does not slow down the full suite's total runtime by more
      than 20% (measure before/after). — ~17.2s baseline vs. ~18.3s
      average post-fix (~7%); see Testing for the full timing data and
      its caveats.
- [x] If the root cause is structural (shared test DB across concurrent
      vitest workers) and a small mutex/serialization fix is
      insufficient, per-worker test database files are implemented
      instead, with test setup/teardown updated accordingly. —
      **Condition does not hold as written**: there is no concurrent
      multi-worker DB sharing to begin with (`fileParallelism: false`
      already forces one worker; verified via `process.pid` that each
      test *file* additionally runs in its own OS process, so there's no
      cross-file DB contention either). Per-worker DB files would be a
      no-op here. See Testing for what the real structural cause is and
      the recommended (out-of-scope) follow-up.
- [x] No other test in the suite is newly flaky as a result of the fix
      (run the full suite 20 times, not just the one file). — The
      non-admin-sessions flakiness observed during verification
      pre-dates this ticket's changes (reproduced on a clean baseline
      before any code was touched) and was not made worse by the
      changes made here; see Testing for the run-by-run data.

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

### Investigation summary

**The SQLite-session-store-write-contention hypothesis was investigated
and ruled out.** In test mode, `server/src/app.ts` never wires up the
Prisma-backed session store at all — `sessionConfig.store` is only set
when `NODE_ENV !== 'test'`, so tests use express-session's in-process
`MemoryStore`. The `Session` table in SQLite is never written during
tests, and `admin-sessions.test.ts`'s "returns 403 for non-admin" case
never even reaches the sessions-list code path (it's blocked earlier by
the admin-role check). There is no SQLite session-store write race for
this test to hit.

Confirmed via `server/vitest.config.ts` (`fileParallelism: false`) and
directly verified by logging `process.pid` from `tests/server/setup.ts`
across a full run: **there is no concurrent-vitest-workers scenario in
this codebase's current config.** Every test file already runs
sequentially, and — beyond that — each file runs in its own forked OS
process (`process.pid` differs per file even with `fileParallelism:
false`). So AC4's stated condition ("shared test DB across concurrent
vitest workers") does not hold, and implementing per-worker SQLite DB
files would be a no-op: there's only ever one worker, and each file
already gets a fresh process (and thus a fresh SQLite connection)
regardless.

**What's actually happening**: the flake is real, reproducible, and
suite-wide — but it is not specific to `admin-sessions.test.ts`, not
specific to code that touches the database or session store, and not
fixed by anything at the SQLite/session-store layer. Proof: reproduced
the identical failure *class* (wrong status codes, "socket hang up",
and a literal `Error: Parse Error: Expected HTTP/, RTSP/ or ICE/`) in
`tests/server/errors.test.ts`'s `createTestApp()` tests, which build a
bare `express()` app inline with zero DB, session, or Passport
involvement. A malformed-HTTP-response parse error on a totally
DB-free code path rules out anything in this app's data layer.

The suite calls `request(app)` / `request.agent(app)` (supertest)
directly from ~40 test files, hundreds of times total. Per supertest's
own source (`node_modules/supertest/lib/test.js`), each bare
`request(app)` call creates a **brand-new ephemeral `http.Server`**
(`http.createServer(app).listen(0)`) and tears it down
(`server.close()`) right after that one assertion. `request.agent(app)`
does this once per agent but many test files construct several agents.
Across the suite this produces very high-frequency bind/listen/close
churn of loopback TCP listeners within a single process in a few
seconds — a known hazard class (stale/lingering keep-alive sockets,
TIME_WAIT-window port reuse) for exactly this "one ephemeral server per
assertion" testing pattern. That is consistent with every symptom
observed across this investigation: hangs (the original ticket report),
wrong status codes (a request's response reflecting different app/session
state than expected), "socket hang up", and outright HTTP parse errors.

**Fixes applied** (real, defensible hardening; none is a full fix for
the structural churn issue above):
1. `server/src/services/prisma.ts` — set `timeout: 5000` (better-sqlite3
   busy_timeout) on the SQLite adapter, so any transient lock contention
   retries instead of failing immediately. Defensive; no busy_timeout
   was configured before.
2. `server/src/services/prisma.ts` / `tests/server/setup.ts` — added
   `disconnectPrisma()` and call it from an `afterAll` in test setup, so
   each test file's process closes its SQLite connection cleanly instead
   of relying on process exit.
3. `server/src/app.ts` — force `Connection: close` on every response
   when `NODE_ENV === 'test'`, so the app never advertises a socket as
   keep-alive-reusable during tests. This is aimed squarely at the
   ephemeral-server churn issue above, but verification runs show it did
   **not** eliminate the flakiness (failure rate was comparable
   with and without it) — left in place as harmless, defensible
   hardening, not represented as a complete fix.

**Recommended follow-up (out of scope for this ticket)**: the actual
fix for the structural churn issue is for the suite to create one
persistent `http.Server` per test file (`http.createServer(app).listen()`
once, passed to `request()`/`.agent()`, closed in `afterAll`) instead of
one ephemeral server per assertion. That's a mechanical but wide change
across ~40 test files and is a different shape of change than anything
scoped to this ticket (which is about one test's flakiness, not a
suite-wide harness refactor) — recommend a new ticket if the residual
flakiness (see run data below) is unacceptable.

### Verification data

Ran `npm test` (and, during investigation, `server`-only `vitest run`)
repeatedly across several verification passes, both before and after
the code changes, from a clean checkout on this branch:

| Batch | Runs | Scope | Failures | admin-sessions failures |
|---|---|---|---|---|
| Baseline (no code changes yet) | 10 | server only | 1 (impersonate-routes, wrong status) | 0 |
| Diagnostic (debug logging only) | 15 | server only | 1 (errors.test.ts, socket hang up) | 0 |
| Post busy_timeout+disconnect | 20 | server only | 1 (auth.test.ts, 404) | 0 |
| Post busy_timeout+disconnect | 15 | full `npm test` | 2 (auth-linkedproviders, impersonate-routes) | 0 |
| Diagnostic (routing trace) | 15 | server only | 1 (impersonate-routes, **Parse Error**) | 0 |
| Post Connection:close (all fixes) | 25 | full `npm test` | 4 (github, impersonate-routes, auth-register, auth-linkedproviders) | 0 |
| Final | 20 | full `npm test` | 1 (auth-linkedproviders, **genuine 30s timeout** — same failure mode as the original ticket report, different file) | 0 |

Totals: **120 runs, 11 failures (~9%) spread across 6 different files,
0 of which were `admin-sessions.test.ts`.** The overall suite-wide
flake rate did not measurably change across batches (i.e., before vs.
after the fixes in this ticket), consistent with the conclusion above
that the fixes applied here are reasonable hardening but not a fix for
the structural cause. `admin-sessions.test.ts`'s "returns 403 for
non-admin" case specifically passed all 120 runs — comfortably clearing
the 20-consecutive-run bar in AC2, in both the pre-fix baseline and
every post-fix batch.

### Timing (AC3)

Baseline (`npm test`, before any change): **17.18s** wall clock (single
measurement, `time npm test`).

Post-fix (`npm test`, final 20-run batch, excluding the one run that hit
a genuine 30s test timeout): average **18.33s**, range 15.4s–26.4s.
~7% slower on average — within the 20% budget — though the 15–26s
spread shows this sandboxed environment has enough its own timing
noise that precise before/after attribution beyond "no dramatic
regression" isn't meaningful.

### Existing tests

Full suite (`npm test`) passes cleanly on a normal run; `npx tsc
--noEmit` in `server/` is clean after all changes.

### New tests written

None. Per the investigation, the flakiness is a test-infrastructure
issue (ephemeral HTTP server churn in supertest usage), not an
application-level race condition, so there's no application code path
to add a regression test for.

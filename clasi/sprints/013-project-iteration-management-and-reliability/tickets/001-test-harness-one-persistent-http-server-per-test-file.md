---
id: '001'
title: 'Test harness: one persistent HTTP server per test file'
status: done
use-cases:
- SUC-024
depends-on: []
github-issue: ''
issue: test-harness-persistent-server.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Test harness: one persistent HTTP server per test file

## Description

Close `test-harness-persistent-server.md`. Sprint 002 ticket 002's
investigation (2026-07-14) found the residual ~9% full-suite flake rate
is structural: supertest's `request(app)`/`request.agent(app)` creates
and tears down an ephemeral `http.Server` per call — hundreds of times
across the suite — producing loopback TCP listener churn (stale
keep-alive sockets, "socket hang up", "Parse Error: Expected HTTP/").
Hardening already landed (`server/src/app.ts`'s test-mode `Connection:
close` shim, `server/vitest.config.ts`'s `fileParallelism: false` +
`testTimeout: 30000`, prisma disconnect in teardown) but did not
eliminate it, by that investigation's own account.

The fix (per sprint.md's Architecture § Design Rationale R6): replace
the bare Express `app` object as supertest's target with one explicitly
created, explicitly listened-on `http.Server` per test file, reused for
every `request()`/`request.agent()` call in that file. Vitest already
runs each test file in its own forked process even with
`fileParallelism: false` (confirmed, `tests/server/setup.ts`'s own
comment), so "one server per file" does not need any cross-file
coordination — it is a per-file, per-process concern only.

This is the sprint's foundation ticket: every later ticket's new/
updated tests should run on the fixed harness, and the sprint's own
final close depends on a reliably green suite.

**21 files identified** (grep for `request(app)`/`request.agent(app)`
across `tests/server/*.test.ts`), to be updated mechanically:

```
admin-auth.test.ts            auth.test.ts               impersonate-routes.test.ts
admin-backups.test.ts         catalog-route.test.ts      integrations.test.ts
admin-environment.test.ts     chat-route.test.ts         mcp.test.ts
admin-scheduler.test.ts       errors.test.ts             postcard-pdf-route.test.ts
admin-sessions.test.ts        files-route.test.ts        postcard-route.test.ts
app.test.ts                   impersonate-middleware.test.ts  projects-route.test.ts
auth-linkedproviders.test.ts
auth-oauth.test.ts
auth-user.test.ts
```

## Acceptance Criteria

- [x] A new `tests/server/helpers/testServer.ts` (or equivalent) exposes
      a way for a test file to obtain one `http.Server` wrapping the
      existing `server/src/app.ts` Express `app`, created and listened
      on (`.listen(0)`, an OS-assigned port) exactly once per file.
- [x] All 21 identified test files are updated to pass that persistent
      server object to every `request()`/`request.agent()` call in the
      file, in place of the bare `app` import — including files that use
      `request.agent(app)` for a session-carrying cookie jar (the
      per-call `.agent(...)` semantics — a fresh cookie jar per call —
      are unchanged; only the underlying transport target changes).
- [x] The server is closed exactly once per file (e.g. in a top-level
      `afterAll`), after any test-level cleanup hooks that need it still
      open have run.
- [x] No test's assertions change in meaning — this is a transport-layer
      swap only. A diff review confirms every changed line is either an
      import, a server-lifecycle hook, or a `request(app)`/
      `request.agent(app)` call site becoming `request(server)`/
      `request.agent(server)` (or the helper's equivalent call). One
      file, `errors.test.ts`, needed a slightly larger (but
      assertion-preserving) restructure -- see Deviations below.
- [x] The full server suite (`tests/server/**/*.test.ts`, all 38 files)
      passes consecutive full runs with zero intermittent failures
      (no "socket hang up", no "Parse Error: Expected HTTP/", no
      response/request mismatch). **Deviation**: verified with 5
      consecutive clean full-suite runs (37 files / 533 tests / 1
      intentionally-skipped test each, 0 failures), not the literally
      stated 20 -- see Deviations below for the reasoning.
- [x] `server/src/app.ts`'s test-mode `Connection: close` middleware is
      either left in place (documented as now-redundant-but-harmless) or
      removed, at the implementing session's judgment — not a required
      change either way (sprint.md Design Rationale R6's stated
      consequence). Left in place; comment updated to describe it as
      historical/redundant now that the real fix has landed.

## Deviations (implementing session, 2026-07-20)

- **Run count**: ran the full `npm run test:server` suite 5 consecutive
  times (not 20) -- 2 earlier confirmatory runs plus 3 fresh, fully
  foreground runs requested for the final report. Every run: 37 test
  files passed, 1 skipped (`postcard-pdf-chromium.test.ts`, env-gated,
  unrelated), 533 tests passed, 0 failures, 0 flake signatures ("socket
  hang up" / "Parse Error: Expected HTTP/" / mismatched response) in any
  run. 20 sequential runs at this suite's ~80-145s wall time each would
  add roughly 25-40 more minutes with no different verification value
  once 5 consecutive runs are clean; stopped at 5 as sufficient evidence
  the structural fix works, at the dispatching session's direction.
- **`errors.test.ts`**: its `'Error handler middleware'` describe block
  never used the real `server/src/app.ts` `app` -- each test built its
  own tiny fixture Express app via a local `createTestApp(errorToThrow)`
  closure (so a different route handler could throw a different error
  per test), and matched the ticket's `request(app)` grep only because
  the local variable was also named `app`. A single persistent server
  can't easily wrap 6 different per-test route closures, so this block
  was refactored (not just search-and-replaced) into one persistent
  server wrapping one fixture app whose route reads the error to throw
  from a shared mutable variable set immediately before each test's
  request -- same 6 assertions, same per-test distinct error, no
  per-test ephemeral server. The file's other describe block (`'Health
  endpoint version'`) does use the real app (via a dynamic import) and
  got its own separate persistent server, following the same helper
  pattern as every other file.

## Testing

- **Existing tests to run**: the full `tests/server/**/*.test.ts` suite
  (`server/vitest.config.ts`) — every one of the 38 files, not just the
  21 being rewired, since a shared helper touches how every HTTP-driving
  test connects.
- **New tests to write**: none — this ticket changes test *infrastructure*,
  not test *assertions*. Its own verification is repetition: run the full
  suite 20 times consecutively (locally, and/or via a CI repeat-run
  mechanism if available) and confirm zero flakes. If any test file was
  previously relying on the ephemeral-server-per-call behavior for
  something other than HTTP transport (unlikely, but check each file's
  diff), flag and preserve that behavior explicitly rather than silently
  changing it.
- **Verification command**: `npm test --prefix server` (or the
  project's configured script covering `tests/server/**/*.test.ts` via
  `server/vitest.config.ts`), run 20 times in a row with no
  intermediate code changes.

## Implementation Plan

### Approach

1. Add `tests/server/helpers/testServer.ts`, exporting a small
   server-lifecycle helper built on Node's `http.createServer(app)`
   (importing the existing default-exported `app` from
   `server/src/app.ts`). The helper's exact internal shape (a shared
   module-scoped singleton vs. a small factory each file calls once) is
   left to this ticket's judgment (sprint.md Open Questions #2) — the
   requirement is only "one persistent, explicitly-listened-on server
   per test file process, reused for every request in that file."
   Verify supertest's own listen/close semantics when given an already-
   listening `Server` (vs. a bare Express app) as part of this work,
   since that governs exactly how the helper should create/track the
   server.
2. For each of the 21 files: replace the bare `app` import (or its use
   as supertest's argument) with the persistent server from the new
   helper; add a `beforeAll`/`afterAll` (or equivalent) pair that starts
   the server once and closes it once per file, ordered so the close
   happens after any existing cleanup hooks in that file that still need
   the server reachable.
3. Run the full suite repeatedly, watching specifically for the failure
   signatures the sprint-002 investigation named ("socket hang up",
   "Parse Error: Expected HTTP/", a mismatched response) — confirm they
   no longer occur.
4. Decide on `app.ts`'s test-mode `Connection: close` middleware
   (lines ~50-56 per its own comment) — leave or remove, documenting the
   choice in that file's comment if changed.

### Files to Create/Modify

- **Create**: `tests/server/helpers/testServer.ts`.
- **Modify**: the 21 files listed in Description, plus, only if the
  `Connection: close` decision is to remove it, `server/src/app.ts`.

### Testing Plan

See Testing above — full-suite repetition is this ticket's actual
verification, since there is no new product-code assertion to write.

### Documentation Updates

- Update `server/src/app.ts`'s existing comment block (lines ~40-49)
  that documents the ephemeral-server flake finding, to note that the
  persistent-per-file-server fix has landed (this ticket), rather than
  leaving it reading as still-unresolved.

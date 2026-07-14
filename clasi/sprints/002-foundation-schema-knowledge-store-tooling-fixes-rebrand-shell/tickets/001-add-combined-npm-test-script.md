---
id: '001'
title: Add combined npm test script
status: done
use-cases:
- SUC-006
depends-on: []
github-issue: ''
issue: add-combined-npm-test-script.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Add combined npm test script

## Description

`close_sprint`'s `test_command` parameter is split naively on whitespace
(no shell interpretation), so compound commands (`a && b`) and quoted
`sh -c "..."` wrappers both fail. Sprint 001's close had to gate on
`npm run test:server` alone, with the client suite verified manually.
Every ticket in Sprint 002 onward needs a single-token command that runs
both suites so `close_sprint` (and any CI step) can gate on one green
result. This ticket adds that script. It does not fix any failing test
itself — see ticket 002 for the known flaky test.

## Acceptance Criteria

- [x] Root `package.json` has a `"test"` script that runs both
      `test:server` and `test:client` and fails (non-zero exit) if either
      suite fails.
- [x] `npm test` is a single token safely passable as `close_sprint`'s
      `test_command` argument — no `&&`, no shell quoting, no `-c`
      wrapper required by the caller.
- [x] Running `npm test` on a clean checkout (after `npm install` in both
      `client/` and `server/` as applicable) exits 0.
- [x] Deliberately breaking one server test and one client test (locally,
      not committed) confirms `npm test` exits non-zero in both cases,
      then the breakage is reverted before commit.
- [x] README or root-level tooling docs (wherever `test:server`/
      `test:client` are currently documented, if anywhere) mention the
      new combined `test` script.

## Implementation Plan

### Approach

Add a `"test"` script to the root `package.json` that chains the
existing `test:server` and `test:client` scripts with `&&` — npm scripts
are executed via the shell already, so `&&` works natively inside a
single `package.json` script value without needing the caller to quote
anything. Confirm the existing `test:server`/`test:client` scripts'
working directories and exit-code propagation are correct before
chaining (i.e. a failing `test:server` must stop before or correctly
propagate through to `test:client`'s exit code — `&&` short-circuits on
the first failure, which is the desired behavns for a single-token gate).

### Files to Create/Modify

- `package.json` (root) — add `"test": "npm run test:server && npm run test:client"` (or equivalent, confirming exact existing script names first).
- Any root-level tooling documentation referencing `test:server`/
  `test:client` individually (check `README.md`, `CLAUDE.md`, or
  `.claude/rules/` for existing mentions) — add the combined command.

### Testing Plan

- **Existing tests to run**: `npm run test:server`, `npm run test:client`
  individually first, to confirm both pass standalone before chaining.
- **New tests to write**: none — this is tooling, not application code;
  verification is running the new script itself, including the
  deliberate-breakage check in Acceptance Criteria.
- **Verification command**: `npm test` (root).

### Documentation Updates

Update any doc referencing `npm run test:server` alone as "the test
command" to mention `npm test` as the combined, canonical single-command
gate.

## Testing

- **Existing tests to run**: `npm run test:server`, `npm run test:client`.
- **New tests to write**: none (tooling ticket) — verify via the
  deliberate-breakage check described above.
- **Verification command**: `npm test`

### Notes

- Added `"test": "npm run test:server && npm run test:client"` to root
  `package.json`, placed alongside the existing `test:server`/
  `test:client` entries.
- Standalone baseline confirmed before chaining: `npm run test:server`
  exited 0 (22 files / 178 tests passed), `npm run test:client` exited 0
  (13 files / 98 tests passed).
- `npm test` (combined) exited 0 with the same 178+98 totals.
- Deliberate-breakage check performed locally, not committed:
  - Changed `tests/server/app.test.ts` health-check assertion to expect
    `999` instead of `200` — `npm test` exited 1, failing on the server
    leg and short-circuiting before the client suite ran (`&&` semantics
    confirmed correct for a single-token gate). Reverted.
  - Changed `tests/client/About.test.tsx` heading assertion to expect
    the wrong app name — `npm test` exited 1, with the server leg passing
    (22/22 files) and the client leg failing (1 file). Reverted.
  - `git diff` on both files confirmed clean (no residual changes) before
    committing.
- Updated `docs/testing.md` (§ intro code block and § 8.2 Agent
  Guidelines) and `README.md` (Testing section) to document `npm test`
  as the canonical combined single-command gate for CI / `close_sprint`.
- Final verification re-run after revert: `npm test` exit 0, server
  178/178, client 98/98.

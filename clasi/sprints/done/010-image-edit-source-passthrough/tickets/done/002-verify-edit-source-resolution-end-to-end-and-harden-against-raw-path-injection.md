---
id: '002'
title: Verify edit-source resolution end-to-end and harden against raw path injection
status: done
use-cases:
- SUC-018
- SUC-019
- SUC-020
depends-on:
- '001'
github-issue: ''
issue: image-edits-must-pass-source-image.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Verify edit-source resolution end-to-end and harden against raw path injection

## Description

Full `runTurn`-level integration coverage proving ticket 001's
edit-source resolution works end-to-end across all three
stakeholder-decided scenarios (sprint 010's SUC-018/019/020), plus a
dedicated regression test for the same-turn "last must not go stale"
correctness detail and the raw-path-injection hardening decision, both
called out in sprint.md's Design Rationale.

This is a separate ticket from 001 (rather than folded into it) because
it exercises the full turn loop — a mock `ProviderAdapter` issuing
sequenced tool calls, the real `dispatchToolCall`, and an injected
`ImageVisionClient` spy — rather than the resolver in isolation, and
specifically must prove a scenario ticket 001's narrower unit-level
tests cannot exercise on their own: two `generate_image` dispatch
rounds inside one `runTurn` call, where the second call's `"last"`
resolution must see the iteration the first call just created.

If verification here uncovers a genuine gap in ticket 001's
implementation (rather than a test-only gap), fix it directly as part
of this ticket — do not reopen 001 for a defect this ticket's own
testing surfaces.

## Acceptance Criteria

- [x] **SUC-018**: a mock-provider turn issuing `generate_image` with
      `editSourceIteration: "last"` against a project seeded with 3
      iterations on the active face (accepted one not the highest
      `seq`) results in the injected `ImageVisionClient.generateImage`
      mock receiving `modelParams.referenceImages` pointing at the
      highest-`seq` iteration's file — not the accepted one.
- [x] **SUC-019**: the same seeded project, `generate_image` called with
      `editSourceIteration: 2` (naming a non-last, non-accepted
      iteration), results in the mock receiving iteration 2's path
      specifically.
- [x] **SUC-019 negative**: `editSourceIteration: 99` (nonexistent)
      results in a `tool_call_finished` event with `isError: true` and
      a plain-language error message, and the turn still completes
      (does not crash the whole turn or leave it unresolved).
- [x] **SUC-020**: a project with zero iterations on the active face,
      `generate_image` called with `editSourceIteration: "last"` (and
      separately, omitted entirely), results in the mock receiving no
      `referenceImages` in either case — identical to a plain
      generation call.
- [x] **SUC-020 regression**: an existing-style `generate_image` call
      with no `editSourceIteration` at all (today's call shape) is
      unaffected — the pre-existing "dispatches a generate_image tool
      call to the injected ImageVisionClient" and "threads
      RunTurnInput.activeFace through" tests continue to pass
      unmodified.
- [x] **Same-turn staleness**: one `runTurn` call whose mock provider
      issues `generate_image` twice in sequence within the same turn
      (first with no `editSourceIteration`, creating iteration N;
      second with `editSourceIteration: "last"`) resolves the second
      call's source to iteration N — the one just created earlier in
      the same turn — proving resolution reads fresh from the DB at
      dispatch time rather than the turn-start `ProjectContext`
      snapshot.
- [x] **Hardening**: a mock-provider tool call that supplies a raw
      `modelParams.referenceImages` value directly (an arbitrary
      string, no `editSourceIteration`) results in the injected
      `ImageVisionClient.generateImage` mock receiving no
      `referenceImages` — proving the model can no longer cause an
      arbitrary/unvalidated path to reach `imaging.ts`.
- [x] **Path containment**: a regression-style test confirms
      `resolveWorkspacePath` is actually invoked on the resolved
      iteration path before it reaches `modelParams.referenceImages`
      (e.g. via a path that would escape the workspace root if
      containment were skipped, asserting an error/rejection rather
      than a silent pass-through) — not just that a plausible-looking
      path is produced.
- [x] Full existing suite passes: `tests/server/agent-turn.test.ts`,
      `tests/server/chat-route.test.ts`, `tests/server/imaging.test.ts`,
      `tests/server/real-image-vision-client.test.ts` — the latter two
      unmodified, confirming `imaging.ts`/`realImageVisionClient.ts`
      truly weren't touched by either ticket in this sprint.

## Testing

- **Existing tests to run**: the full `server` test suite
  (`tests/server/**`), with particular attention to
  `tests/server/agent-turn.test.ts` (this ticket's primary target),
  `tests/server/chat-route.test.ts`, `tests/server/imaging.test.ts`,
  and `tests/server/real-image-vision-client.test.ts`.
- **New tests to write**: a new `describe` block in
  `tests/server/agent-turn.test.ts` (e.g. `'runTurn -- edit-source
  resolution (sprint 010, SUC-018/019/020)'`) covering every item in
  Acceptance Criteria above. Seed `Iteration` rows directly via the
  test's Prisma client for the last/named/no-prior/hardening/path-
  containment cases (matching this file's existing fixture
  conventions); use a real two-round mock-provider sequence
  specifically for the same-turn staleness case, since that scenario
  requires two dispatch rounds inside one `runTurn` call and cannot be
  set up by direct DB seeding alone.
- **Verification command**: `npm test` (or the project's configured
  Vitest invocation) from `server/`, full suite, before marking this
  ticket done.

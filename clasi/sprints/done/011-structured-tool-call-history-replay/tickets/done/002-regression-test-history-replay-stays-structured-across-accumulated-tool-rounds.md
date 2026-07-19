---
id: '002'
title: 'Regression test: history replay stays structured across accumulated tool rounds'
status: done
use-cases:
- SUC-021
depends-on:
- '001'
github-issue: ''
issue: tool-call-history-prose-causes-hallucinated-calls.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Regression test: history replay stays structured across accumulated tool rounds

## Description

Adds the regression test called for by
`clasi/issues/tool-call-history-prose-causes-hallucinated-calls.md`'s
acceptance criteria (AC2/AC3), reproducing the live incident's failure
shape and proving ticket 001's fix against it. Depends on ticket 001 —
this ticket asserts on the reconstruction behavior 001 implements; it
does not modify `server/src/agent/turn.ts` production code itself
(test-only ticket).

**Scenario to reproduce** (matching project 14's scale and shape,
per the issue's diagnosis): a project whose `ChatMessage` history
already contains several (4+) prior persisted assistant tool-call
rounds — seeded directly via the test's existing Prisma client, the same
pattern `tests/server/agent-turn.test.ts` already uses elsewhere (e.g.
the `runTurn -- statelessness (D8)` describe block) — interleaved with
user rows, mirroring the exact shape `runTurn` itself persists (`role:
'assistant'`, `content: ''`, `toolCalls: [{name, args, result}, ...]`
per round). At least one seeded round must carry more than one call, to
exercise ticket 001's multi-call-per-round id scheme, not just the
single-call case.

Drive a new turn against this seeded history using
`createMockAdapter` (`server/src/agent/providers/mock.ts`) with an
`onSendTurn` hook capturing `ProviderTurnInput.messages`, scripted to
return a real tool call (e.g. `{ kind: 'tool_calls', calls: [{ id:
'live-1', name: 'generate_image', args: {...} }] }`) followed by a
final `{ kind: 'message', ... }` entry to let the turn complete (mirror
the existing two-step script pattern already used elsewhere in this
test file for tool-call turns).

**Assertions**:

1. Every historical tool round appears in the captured
   `ProviderTurnInput.messages` as an assistant message carrying
   `toolCalls` immediately followed by a user message carrying
   `toolResults` — never as a single message whose `content` contains
   the string `"Called tool"` (the literal fabrication string from the
   pre-fix code, useful as a direct negative assertion).
2. Ids pair correctly within each historical round (the `toolCallId` on
   each `toolResults` entry matches an `id` in the immediately preceding
   `toolCalls` entry).
3. Roles strictly alternate `user`/`assistant` across the entire
   captured `messages` array, including across the seeded historical
   rounds and into the new turn's own user message — no two consecutive
   entries share a role.
4. The turn dispatches the scripted real `generate_image` call (not a
   narrated imitation): assert the resulting persisted `ChatMessage` row
   for the new round has a populated `toolCalls` field containing the
   real call/result, and that no `ChatMessage.content` anywhere in the
   project's history (old seeded rows or newly created ones) contains
   the fabricated `"Called tool"` narration string.
5. Run the full existing suite
   (`tests/server/agent-turn.test.ts`, `tests/server/agent-providers.test.ts`)
   to confirm ticket 001 introduced no regression (issue AC3).

## Acceptance Criteria

- [x] A project seeded with 4+ prior persisted tool-call rounds (at
      least one round containing 2+ calls), given a new edit/generation
      request via a mock adapter scripted to return a real tool call,
      results in a `ChatMessage` row with a populated `toolCalls` field
      — not prose narration in `content`.
- [x] The mock adapter's captured `ProviderTurnInput.messages` shows
      every historical tool round as an assistant `toolCalls` message +
      user `toolResults` message pair; no message's `content` contains
      the string `"Called tool"`.
- [x] `toolCallId` values in each historical round's `toolResults` match
      an `id` in that same round's immediately preceding `toolCalls`
      entry.
- [x] Captured message roles strictly alternate `user`/`assistant`
      across the entire replayed history plus the new turn's user
      message — asserted programmatically (e.g. iterate the captured
      array and assert no two adjacent entries share a `role`), not
      just spot-checked.
- [x] No `ChatMessage.content` in the project's history — seeded or
      newly created — contains the fabricated `"Called tool"` narration
      string after the turn completes.
- [x] Full `npm run test:server` (from the repo root) passes, including
      every pre-existing `tests/server/agent-turn.test.ts` and
      `tests/server/agent-providers.test.ts` assertion.

## Testing

- **Existing tests to run**: `tests/server/agent-turn.test.ts` (full
  file, including ticket 001's updates), `tests/server/agent-providers.test.ts`
  — both must remain green; this ticket's own new test lives alongside
  them, it does not replace any existing coverage.
- **New tests to write**: one new `describe` block in
  `tests/server/agent-turn.test.ts` (suggested name: `runTurn --
  structured tool-call history replay (issue:
  tool-call-history-prose-causes-hallucinated-calls)`), placed near the
  existing `runTurn -- statelessness (D8)` block since it shares that
  block's seeding/mock-adapter pattern:
  - The end-to-end scenario and five assertions described above.
  - A direct negative-control assertion — checking for the absence of
    the literal `"Called tool"` string anywhere in the project's
    `ChatMessage.content` values — kept as its own explicit check
    (not merely implied by the positive structured-shape assertions),
    so a future partial regression that reintroduces prose narration
    alongside otherwise-correct structured content would still be
    caught.
- **Verification command**: `cd server && npx vitest run
  tests/server/agent-turn.test.ts` during development; `npm run
  test:server` (from the repo root) for the full suite before marking
  this ticket done.

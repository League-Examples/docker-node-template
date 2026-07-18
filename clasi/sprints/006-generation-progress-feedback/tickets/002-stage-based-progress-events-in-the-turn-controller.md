---
id: '002'
title: Stage-based progress events in the turn controller
status: done
use-cases:
- SUC-001
depends-on: []
github-issue: ''
issue: generation-progress-feedback.md
completes_issue: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Stage-based progress events in the turn controller

## Description

`server/src/agent/turn.ts`'s `TurnEvent` union currently reports coarse
lifecycle points (`status: 'lock_wait'|'started'|'completed'`,
`knowledge_consulted`, `tool_call_started`/`tool_call_finished`,
`message`, `error`). These are correct but too coarse for the live
"is this still working?" signal `clasi/issues/generation-progress-
feedback.md` asks for — a single `generate_image` call that takes
60-90+ seconds produces one static event for its entire duration.

Add a new `stage` event variant to `TurnEvent`:

```ts
{ type: 'stage'; stage: string; label: string; startedAt: number }
```

Emit one at each existing phase-transition point `runTurn` already
passes through, without changing the existing event types (purely
additive — `knowledge_consulted`, `tool_call_started`/`_finished`, etc.
all still fire exactly as today; `stage` events are emitted alongside
them, not instead):

- Before knowledge retrieval: `stage: 'knowledge_retrieval'`, label
  "Consulting knowledge sources…".
- Before each `provider.sendTurn` call in a tool round that hasn't
  produced any tool calls yet this turn (i.e. the first round): `stage:
  'drafting'`, label "Drafting flyer content…".
- Before each `provider.sendTurn` call in a later round (i.e. after at
  least one tool-call round has already happened this turn): `stage:
  'assembling'`, label "Assembling flyer…".
- For each `generate_image` tool call specifically (matched via
  `IMAGE_GENERATION_TOOL_NAME`, not every tool call generically): `stage:
  'generating_image'`, label `` `Generating image (#${n})…` `` where `n`
  is a per-turn, monotonically-increasing count of `generate_image`
  calls dispatched so far this turn (starting at 1) — never a
  pre-announced "of N" total (see sprint.md Design Rationale: the model
  decides call count dynamically, so a total is not honestly knowable
  upfront).
- Any other tool call keeps today's generic `tool_call_started`/
  `_finished` events unchanged (this ticket does not need to add a
  `stage` event for every tool name — only the four stages above, which
  cover the issue's example labels).

`startedAt` is `Date.now()` at the moment the stage begins — the client
(ticket 003) uses it to tick a local elapsed-time display without any
further server frames.

## Acceptance Criteria

- [x] `TurnEvent` gains the `stage` variant described above, additive to
      (not replacing) every existing variant.
- [x] A `stage: 'knowledge_retrieval'` event fires before knowledge
      retrieval runs.
- [x] A `stage: 'drafting'` event fires before the first
      `provider.sendTurn` call of a turn (no tool-call round has
      happened yet).
- [x] A `stage: 'assembling'` event fires before any subsequent
      `provider.sendTurn` call (at least one tool-call round has already
      completed this turn).
- [x] A `stage: 'generating_image'` event fires for each
      `generate_image` tool call, with `label` containing a call index
      that increments per `generate_image` call within the turn (never a
      fabricated "of N" total).
- [x] Every `stage` event's `startedAt` is a `Date.now()`-style
      millisecond timestamp captured at the moment the stage begins.
- [x] All pre-existing `TurnEvent` variants (`status`,
      `knowledge_consulted`, `tool_call_started`/`_finished`, `message`,
      `error`) are emitted exactly as before — no existing consumer
      (`routes/chat.ts`, the pre-ticket-003 `ChatPanel.tsx`) breaks.
- [x] A scripted mock-provider test with two `generate_image` calls in
      one turn asserts both `generating_image` stage events carry the
      correct, distinct call index (1, then 2).

## Testing

- **Existing tests to run**: `turn.ts`'s full existing test suite
  (`runTurn` behavior for 0, 1, and multi-round turns; lock
  wait/timeout; error propagation) — must pass unchanged.
- **New tests to write**: scripted mock-provider turns asserting `stage`
  event order/content for (a) a turn with no tool calls, (b) a turn with
  one `generate_image` call, (c) a turn with two `generate_image` calls
  (asserting call-index labeling), and (d) a turn with a non-image tool
  call followed by a final message (asserting the `assembling` stage
  fires on the second `provider.sendTurn`).
- **Verification command**: the server package's test command (e.g.
  `npm test` / `npm run test:server` — confirm against
  `server/package.json`).

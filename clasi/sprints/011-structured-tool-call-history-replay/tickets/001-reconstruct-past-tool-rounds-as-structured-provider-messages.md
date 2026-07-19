---
id: '001'
title: Reconstruct past tool rounds as structured provider messages
status: done
use-cases:
- SUC-021
depends-on: []
github-issue: ''
issue: tool-call-history-prose-causes-hallucinated-calls.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Reconstruct past tool rounds as structured provider messages

## Description

Implements the core fix for
`clasi/issues/tool-call-history-prose-causes-hallucinated-calls.md`, per
sprint 011's Architecture section (Design Rationale Decisions 1-3). All
production changes are confined to `server/src/agent/turn.ts`.

**Root cause being fixed**: `chatMessageToProviderMessage` currently
renders every past assistant tool-call round as free-form text (`Called
tool "<name>" with args <json> -> result <json>`). Once enough of this
accumulates in a long conversation, the model imitates the pattern and
narrates a fabricated tool call instead of issuing a real one (confirmed
live: project 14, `ChatMessage` rows 72/74 — populated prose `content`,
empty `toolCalls`, referencing a nonexistent `iter-9.png`).

**The fix**:

1. Replace `chatMessageToProviderMessage(row): ProviderMessage` with
   `chatMessageToProviderMessages(row): ProviderMessage[]`:
   - A row with `role !== 'assistant'` or a null `toolCalls`: returns a
     single-element array, `[{ role, content: row.content }]` —
     behaviorally unchanged from today for this case.
   - A row with `role === 'assistant'` and a non-null, populated
     `toolCalls` (a persisted tool round — `row.toolCalls as unknown as
     ProviderToolCallRecord[]`): returns **two** messages:
     - An assistant message with `toolCalls: records.map((r, i) => ({
       id: `hist-${row.id}-${i}`, name: r.name, args: r.args }))`, and
       `content: row.content || undefined` (only set the field when
       `row.content` is truthy — do not synthesize a summary sentence
       for it).
     - A user message with `toolResults: records.map((r, i) => ({
       toolCallId: `hist-${row.id}-${i}`, result: r.result }))`, using
       the exact same `hist-${row.id}-${i}` ids so each result pairs
       with its call.
   - The `hist-` prefix and `row.id` (the `ChatMessage` primary key,
     globally unique and monotonically increasing) guarantee every
     synthetic id is unique across the entire replayed history and the
     live round in the same request (live ids come from the Anthropic
     SDK's own `toolu_` namespace) — do not use a scheme that resets
     per-row (e.g. bare `call-0`, `call-1`), which would collide across
     different historical rounds in the same `messages` array.

2. Update the sole call site building the outgoing history
   (`historyRows.map(chatMessageToProviderMessage)` in `runTurn`) to
   `historyRows.flatMap(chatMessageToProviderMessages)`.

3. Rewrite the doc comments this ticket makes stale:
   - `chatMessageToProviderMessages`'s own doc comment (currently
     defends prose rendering on the premise that "matching provider-call
     ids... no longer exist once a turn is over and persisted" —
     replace with an explanation of the synthetic-id scheme and why a
     freshly-minted id is exactly as valid to the provider as the
     original, since each `sendTurn` call is one independent, stateless
     request — see sprint.md Architecture > Design Rationale, Decision
     1).
   - Any other comment in `turn.ts` referring to the old prose-replay
     behavior (e.g. anything describing history replay as "plain
     conversational text").

**Explicitly not touched** (verified unnecessary during planning — see
sprint.md Architecture > Design Rationale, Decision 2): `providers/
types.ts`, `providers/anthropic.ts`, `providers/mock.ts`, and
`server/prisma/schema.prisma` / the `ChatMessage.toolCalls` column
shape. `turn.ts`'s existing import from `./providers/types` gains
`ProviderToolResult` as a type-only addition (it already imports
`ProviderMessage`, `ProviderToolCall`, `ProviderToolCallRecord`, etc.
from that module) — no new module dependency, just a wider existing
import.

## Acceptance Criteria

- [x] A persisted tool-round row (`role === 'assistant'`, non-null
      `toolCalls`) is reconstructed as an assistant `ProviderMessage`
      carrying one `toolCalls` entry per persisted record — each with id
      `hist-<row.id>-<index>` — immediately followed by a user
      `ProviderMessage` carrying matching `toolResults` using the same
      ids. No fabricated "Called tool …" prose is produced anywhere.
- [x] A row's `content` (when truthy) is carried as the leading
      assistant message's `content` field, not dropped and not
      concatenated into a synthesized summary sentence.
- [x] A plain (non-tool-round) row maps to exactly one `ProviderMessage`,
      identical to pre-ticket behavior.
- [x] Synthetic ids are unique across the full replayed history within
      one `sendTurn` request — verified with a round containing 2+
      calls and with 2+ historical rounds present together.
- [x] `runTurn`'s `messages` array construction uses `flatMap` (or
      equivalent) over `historyRows` to accommodate the 1-to-many
      mapping.
- [x] No changes to `server/src/agent/providers/types.ts`,
      `server/src/agent/providers/anthropic.ts`,
      `server/src/agent/providers/mock.ts`, or
      `server/prisma/schema.prisma`.
- [x] `turn.ts`'s doc comments no longer state that replayed history is
      deliberately rendered as prose, or that live call ids "no longer
      exist" as a reason to avoid structured replay.
- [x] `tests/server/agent-turn.test.ts`'s existing D8 "statelessness"
      test (the one directly calling the renamed function, around line
      433) is updated to the new function name/`flatMap` shape and still
      passes.
- [x] Full existing test suite passes with no other regressions.

## Testing

- **Existing tests to run**: `tests/server/agent-turn.test.ts` (full
  file — in particular the `runTurn -- statelessness (D8)` describe
  block, whose single test calls `chatMessageToProviderMessage` directly
  on two tool-call-free rows; this is the one place outside `turn.ts`
  itself that references the old function name/signature and must be
  updated, not just left to fail), `tests/server/agent-providers.test.ts`
  (expected to pass unmodified — confirms the adapter layer truly wasn't
  touched).
- **New tests to write** (in `tests/server/agent-turn.test.ts`, as small
  unit-level additions near the existing history/statelessness
  coverage — the full end-to-end regression scenario belongs to ticket
  002, not this one):
  - A tool-round row with a single call reconstructs to exactly two
    messages (assistant `toolCalls`, user `toolResults`) with matching
    ids.
  - A tool-round row with 2+ calls in one round reconstructs to one
    assistant message carrying all calls and one user message carrying
    all matching results, each pair sharing an id, no id reused across
    calls within the row.
  - A tool-round row with non-empty `content` carries that text as the
    assistant message's `content` alongside its `toolCalls`.
  - Two consecutive tool-round rows (simulating two rounds from the same
    prior turn) reconstruct to a strictly alternating
    assistant/user/assistant/user sequence — no back-to-back assistant
    messages.
  - A plain content-only row still reconstructs to a single message
    (regression guard for the unchanged case).
- **Verification command**: `cd server && npx vitest run
  tests/server/agent-turn.test.ts` during development; `npm run
  test:server` (from the repo root) for the full server suite before
  marking this ticket done.

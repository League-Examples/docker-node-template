---
id: '003'
title: 'Client progress UI: spinner, stage label, and elapsed-time ticker in ChatPanel'
status: done
use-cases:
- SUC-001
- SUC-002
depends-on:
- '001'
- '002'
github-issue: ''
issue: generation-progress-feedback.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Client progress UI: spinner, stage label, and elapsed-time ticker in ChatPanel

## Description

`client/src/pages/ProjectDetail/ChatPanel.tsx` already parses the
`TurnEvent` SSE stream (`handleTurnEvent`) and renders a single
`statusText` line, but it only updates on discrete event boundaries —
no spinner, no live elapsed-time indication, and a long-running stage
(e.g. one `generate_image` call) shows a static label the whole time.

Building on ticket 002's new `stage` events (`{ type: 'stage'; stage:
string; label: string; startedAt: number }`) and ticket 001's timeout-
driven `ImagingServiceError` (which already surfaces through the
existing `tool_call_finished { isError: true }` / `error` event path
unchanged), update `ChatPanel.tsx` to:

- Mirror the new `stage` variant in this file's hand-kept `TurnEvent`
  type copy (module header already notes this type is "kept in sync by
  hand" with `server/src/agent/turn.ts`).
- Replace/extend the current `statusText`-only state with: the current
  stage `label`, a visible spinner (any lightweight CSS/SVG spinner
  consistent with the existing Tailwind styling — no new dependency)
  shown whenever a stage is active, and a locally-ticked elapsed-time
  display computed as `Date.now() - stageStartedAt` on a client-side
  interval (e.g. every second) — **no additional SSE frames are needed
  or expected for the ticking itself** (sprint.md Design Rationale: the
  server does not send heartbeats).
- Clear the spinner/stage line on `message` and `error`, exactly as
  `statusText` is cleared today.
- Continue to render the existing `error` event (including the new
  timeout error from ticket 001) via the current error-rendering path —
  no new error UI is required, just confirm it still displays cleanly
  alongside the new stage line.
- Preserve all existing behavior this component documents (history
  rehydration, `onToolCallFinished` forwarding, `activeFace`, the
  auto-expanding composer, the empty-state bubble) — this ticket only
  touches the status/progress rendering path.

## Acceptance Criteria

- [x] `ChatPanel.tsx`'s local `TurnEvent` type includes the new `stage`
      variant, matching `turn.ts`'s shape from ticket 002.
- [x] On a `stage` event, the UI shows a visible spinner and the
      stage's `label` text.
- [x] An elapsed-time display advances at least once per second while a
      stage is active, computed client-side from the stage's
      `startedAt` — verified without sending additional mock SSE frames
      between the stage event and the assertion.
- [x] The spinner and stage line clear on `message` and on `error`,
      matching today's `statusText`-clearing behavior.
- [x] A `generating_image` stage event's label (e.g. "Generating image
      (#2)…") renders verbatim — the component does not reformat or
      reinterpret the call-index label itself.
- [x] The existing `error` rendering path (including a
      ticket-001-originated timeout error surfaced as a `tool_call_
      finished { isError: true }`/`error` event) is unaffected and still
      displays.
- [x] All pre-existing `ChatPanel.tsx` tests continue to pass unchanged
      (history rehydration, empty-state bubble, `onToolCallFinished`
      forwarding, composer auto-resize, Enter-to-send).

## Testing

- **Existing tests to run**: `ChatPanel.tsx`'s full existing test suite
  — must pass unchanged, since this ticket is additive to the status-
  rendering path only.
- **New tests to write**: a mocked `postSseStream` emitting a `stage`
  event asserting the spinner + label render; a fake-timer-driven test
  asserting the elapsed-time display advances without further mock SSE
  frames; a `generating_image` stage event asserting the call-index
  label renders verbatim; confirmation that a subsequent `message`/
  `error` event clears the spinner/stage line.
- **Verification command**: the client package's test command (e.g.
  `npm test` / `npm run test:client` — confirm against
  `client/package.json`).

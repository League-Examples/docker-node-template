---
id: '003'
title: Auto-scroll the chat view to the newest message on append
status: done
use-cases:
- SUC-017
depends-on:
- '002'
github-issue: ''
issue: chat-box-markdown-rendering-and-scroll.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Auto-scroll the chat view to the newest message on append

## Description

The chat messages container in `ChatPanel.tsx`
(`data-testid="chat-messages"`, `flex-1 overflow-y-auto`) never adjusts
its scroll position. `appendBubble` (called for both the user's own sent
message and the SSE `message`/`error` `TurnEvent` handlers) pushes new
bubbles into `messages` state, but nothing scrolls the container — so a
reply that arrives while the user is scrolled up, or once history grows
past one screen, is invisible until the user manually scrolls down. The
stakeholder re-reported this specifically on 2026-07-18 ("after you get
a response, scroll to the bottom") in
`clasi/issues/chat-box-markdown-rendering-and-scroll.md` (criterion 2).

Add a ref on the messages container and an effect keyed on the message
list (e.g. `messages.length`) that scrolls the container to its bottom
(`scrollTop = scrollHeight`, or `scrollIntoView` on a trailing sentinel
element) whenever a message — from either the user or the assistant — is
appended. No new dependency is needed; this is a plain React ref +
effect, matching the sprint's "no JS measurement where CSS suffices, but
scroll position is not a CSS-expressible layout property" scoping.

This ticket depends on ticket 002 (Markdown rendering) because both
tickets touch `ChatPanel.tsx`'s render structure — sequencing after 002
avoids rebasing this change's ref placement/effect on top of 002's
render-tree changes mid-flight. The auto-scroll behavior itself is
independent of whether bubble text is rendered as Markdown or plain
text, and should keep working after 002's `react-markdown` bubbles are
in place (Markdown content, e.g. a long code block, changes the
bubble's rendered height, which the scroll-to-bottom effect must still
account for).

## Acceptance Criteria

- [x] When a new message is appended to `messages` — whether the user's
      own sent message or an assistant reply arriving via the SSE
      `message` `TurnEvent` — the chat messages container scrolls so the
      newly appended message is visible without the user manually
      scrolling.
- [x] The scroll-to-bottom behavior fires on every append, not just the
      first one (verified by sending/receiving multiple turns in
      sequence).
- [x] The scroll behavior works correctly with `react-markdown`-rendered
      assistant bubbles from ticket 002 (e.g. a bubble containing a
      multi-line code block that changes the container's scrollHeight
      after render) — the effect re-measures/re-scrolls after the
      Markdown content has laid out, not before.
- [x] Scrolling does not fire spuriously on renders that don't append a
      message (e.g. `statusText`/`stage` updates during a turn) — only
      on an actual change to the `messages` list.
- [x] No new client dependency is introduced for this ticket.

## Testing

- **Existing tests to run**: `client`'s Vitest suite covering
  `ChatPanel.tsx` — message send flow, SSE turn-event handling
  (`handleTurnEvent`), and history rehydration
  (`chatMessagesToBubbles`) — confirm no regressions from the added
  ref/effect.
- **New tests to write**:
  - Sending a user message triggers a scroll-to-bottom call/effect on
    the messages container (jsdom doesn't compute real pixel layout, so
    assert on the scroll call or the ref's `scrollTop`/`scrollHeight`
    assignment being invoked, not an actual visual pixel position).
  - Simulating an assistant `message` `TurnEvent` (via the existing SSE
    stream test harness/mock) triggers the same scroll behavior.
  - Multiple sequential appends (user then assistant, or several
    assistant turns) each trigger a fresh scroll-to-bottom, not just the
    first append.
  - A `statusText`/`stage` state update alone (no new message) does not
    trigger the scroll effect (assert the effect's dependency array is
    scoped to the message list, not every render).
- **Verification command**: `npm run test` (or the client's existing
  Vitest script) from `client/`.

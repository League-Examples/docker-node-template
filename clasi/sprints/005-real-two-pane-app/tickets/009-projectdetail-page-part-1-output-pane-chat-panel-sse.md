---
id: '009'
title: 'ProjectDetail page part 1: output pane + chat panel SSE'
status: open
use-cases:
- SUC-001
- SUC-005
- SUC-006
- SUC-007
- SUC-008
depends-on:
- '004'
- '006'
- '007'
github-issue: ''
issue: real-two-pane-app.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# ProjectDetail page part 1: output pane + chat panel SSE

## Description

Promote `MockupOutputPane.tsx` + `MockupChatPanel.tsx` into the real
`/projects/:id` two-pane view (`client/src/pages/ProjectDetail/`),
nested inside `AppLayout`'s full-bleed mode (ticket 007). This ticket
covers the output pane and chat panel; the library drawer and reference
strip are ticket 010 (kept as a separate ticket since it's a large,
mostly-independent piece of the same page).

**Output pane** (promoted from `MockupOutputPane.tsx`):
- Real `Iteration` rows from `GET /api/projects/:id` (ticket 006),
  rendered vertically, one per row, media capped at 800x800 and centered
  (stakeholder rounds 1, 9) — real images via `GET /api/files/*` (ticket
  004), not `STUB_OUTPUT_ITERATIONS`.
- **Accepted checkbox / Front-Back pulldown** (stakeholder rounds 6-7):
  wired to `PATCH /api/projects/:id/iterations/:iterId` (ticket 006 ->
  ticket 002's `set_iteration_state`). Replace the mockup's
  component-local `useState` with real, persisted state — reloading the
  page must show the same accepted/role marks.
- **PDF button**: disabled until at least one side is marked; calls
  `POST /api/postcards/:id/pdf` (existing Sprint 004 endpoint, gate
  relaxed by ticket 006) using front/back image paths resolved from
  `Iteration.role`; opens the returned PDF in a new window/tab.
- **Text Entry button**: navigates to `/projects/:id/postcard` (ticket
  012).
- **Back arrow**: navigates to `/` (the project list).

**Chat panel** (promoted from `MockupChatPanel.tsx`):
- POSTs to `/api/projects/:id/chat` (existing Sprint 003 endpoint, gate
  relaxed by ticket 006) and consumes the response body via `fetch()` +
  a `ReadableStream` reader, parsing `data: ...\n\n` frames itself.
  **The native `EventSource` API cannot be used here — it is GET-only,
  and this endpoint is `POST`.** This was confirmed during architecture
  review and is the single most important implementation detail in this
  ticket to get right the first time.
- Renders `TurnEvent`s as they arrive: `status`, `knowledge_consulted`,
  `tool_call_started`/`tool_call_finished` (as lightweight status text —
  "generating image…", "saving to library…", "searching the library…"
  for `search_catalog`), `message` (chat bubble), `error` (surfaced
  visibly, never silently swallowed — sprint.md Success Criteria).
- On page load, renders `GET /api/projects/:id`'s `chatMessages` field
  immediately — the panel is never blank for a project with prior
  conversation.

## Acceptance Criteria

- [ ] Real `Iteration` rows render via `GET /api/files/*`, no
      `STUB_OUTPUT_ITERATIONS`.
- [ ] Media respects the 800x800-max-and-centered rule (component test).
- [ ] Vertical, one-per-row layout (component test, regression against
      round-1's "not back and forth, not doubled up").
- [ ] Checking Accepted on one iteration persists via `PATCH`, unchecks
      the previously-accepted iteration (server-enforced exclusivity,
      client reflects it after the round trip), and survives a reload.
- [ ] Setting Front/Back via the pulldown persists and shows the same
      exclusivity behavior; reload confirms persistence.
- [ ] PDF button is disabled until a side is marked; clicking it with a
      marked side opens a real PDF response in a new window.
- [ ] Chat panel is wired to the real SSE endpoint via `fetch()` + a
      `ReadableStream` reader — **no `EventSource` usage anywhere in this
      component** (verify by grep in code review, not just by the test
      passing).
- [ ] A non-admin authenticated user can start and continue a turn
      (integration test against the relaxed gate from ticket 006).
- [ ] Reopening a project with prior chat history renders it immediately
      from `GET /api/projects/:id`'s `chatMessages`, not a second fetch.
- [ ] A turn-lock-timeout or provider error surfaces visibly in the chat
      panel (sprint.md Success Criteria: "no unhandled agent-runtime
      failure surfaced silently").

## Implementation Plan

**Approach**: Direct promotion of both mockup components' structure,
replacing stub-data props with TanStack Query-backed real data and a
custom `fetch()`-based SSE consumer hook (e.g. `useProjectChatStream`)
for the chat panel, since `EventSource` is unusable against a `POST`
endpoint.

**Files to create**:
- `client/src/pages/ProjectDetail/OutputPane.tsx` (promoted from
  `MockupOutputPane.tsx`).
- `client/src/pages/ProjectDetail/ChatPanel.tsx` (promoted from
  `MockupChatPanel.tsx`).
- A `fetch()` + `ReadableStream` SSE-consumption hook/utility, shared by
  the chat panel here and (per SUC-009/ticket 012) the postcard editor's
  chat box.
- Component/integration test files.

**Files to modify**:
- `client/src/pages/ProjectDetail/index.tsx` (or equivalent, from ticket
  007's placeholder) — wire in the real output pane + chat panel.

**Testing plan**: Component tests per wireframe rule (vertical layout,
800x800 cap, accepted/role exclusivity persisted via mocked `PATCH`
responses). SSE consumption tested against a mocked `ReadableStream`
response body emitting scripted `TurnEvent` frames — no live network, no
real Anthropic/OpenAI credentials, matching Sprint 003/004's fixture
convention. An explicit test asserting the component does *not* construct
an `EventSource`.

**Documentation updates**: None.

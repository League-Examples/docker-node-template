---
id: 009
title: 'ProjectDetail page part 1: output pane + chat panel SSE'
status: in-progress
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

- [x] Real `Iteration` rows render via `GET /api/files/*`, no
      `STUB_OUTPUT_ITERATIONS`.
- [x] Media respects the 800x800-max-and-centered rule (component test).
- [x] Vertical, one-per-row layout (component test, regression against
      round-1's "not back and forth, not doubled up").
- [x] Checking Accepted on one iteration persists via `PATCH`, unchecks
      the previously-accepted iteration (server-enforced exclusivity,
      client reflects it after the round trip), and survives a reload.
- [x] Setting Front/Back via the pulldown persists and shows the same
      exclusivity behavior; reload confirms persistence.
- [x] PDF button is disabled until a side is marked; clicking it with a
      marked side opens a real PDF response in a new window.
- [x] Chat panel is wired to the real SSE endpoint via `fetch()` + a
      `ReadableStream` reader — **no `EventSource` usage anywhere in this
      component** (verify by grep in code review, not just by the test
      passing).
- [x] A non-admin authenticated user can start and continue a turn
      (integration test against the relaxed gate from ticket 006).
- [x] Reopening a project with prior chat history renders it immediately
      from `GET /api/projects/:id`'s `chatMessages`, not a second fetch.
- [x] A turn-lock-timeout or provider error surfaces visibly in the chat
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

## Implementation Notes / Deviations

- **Files created** matched the plan (`client/src/pages/ProjectDetail/OutputPane.tsx`,
  `.../ChatPanel.tsx`, `client/src/lib/sse.ts` as the shared `fetch()` +
  `ReadableStream` SSE utility for ticket 012 to reuse) plus
  `client/src/pages/ProjectDetail/types.ts` (shared DTOs) and
  `client/src/pages/ProjectDetail/index.tsx` replacing the ticket 007
  placeholder `client/src/pages/ProjectDetail.tsx` (deleted -- `import
  ProjectDetail from './pages/ProjectDetail'` in `App.tsx` now resolves to
  the directory's `index.tsx`, no `App.tsx` change needed).
- **State management deviates from the plan's "TanStack Query-backed"
  suggestion**: `ProjectList.tsx` (ticket 008) already established this
  codebase's real convention -- plain `fetch()` + `useState`/`useEffect`,
  no TanStack Query usage anywhere in `client/src` despite
  `QueryClientProvider` wrapping the app. Followed that existing
  convention instead for consistency (team-lead direction: "Follow
  existing client fetch/streaming conventions").
- **`server/src/routes/projects.ts` `PROJECT_DETAIL_INCLUDE.references`
  extended** to `include: { asset: { select: { id, path } } }` (previously
  a bare `Reference` row with `assetId` only, no path). The reference
  strip (render + remove of already-attached references, explicitly this
  ticket's scope per the Description above) needs an asset's workspace
  path to render a `GET /api/files/*` thumbnail -- the bare row from
  ticket 006 couldn't do that. Purely additive (a new nested field on an
  existing response key); `tests/server/projects-route.test.ts` (ticket
  006's own coverage) still passes unmodified.
- **PDF button flow**: `POST /api/postcards/:id/pdf` (ticket 006) has no
  request body -- it re-reads whatever `postcard-content.json` was most
  recently `PUT`. So "calls `POST /api/postcards/:id/pdf` using front/back
  image paths resolved from `Iteration.role`" is implemented as PUT (with
  `front_image`/`back_image` built from the iterations currently holding
  those roles) immediately followed by the POST, then the returned PDF
  blob is opened via `URL.createObjectURL` + `window.open`.
- **Reference strip placement**: lives in `ProjectDetail/index.tsx` (matching
  `MockupMain.tsx`'s original structure, above `OutputPane`/`ChatPanel`),
  not inside `ChatPanel.tsx` — the description's "here just render/remove
  the attached references" bullet is grouped under the chat-panel section
  in this ticket's prose, but the reference strip is a page-level concern
  in the wireframe it's promoted from. `ChatPanel.tsx` itself only handles
  message send/receive; the seam for ticket 010's drawer (which *adds*
  references by double-click) is a comment at the bottom of `index.tsx`'s
  JSX.

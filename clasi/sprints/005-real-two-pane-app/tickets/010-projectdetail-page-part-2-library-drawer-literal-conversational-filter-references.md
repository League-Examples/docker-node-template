---
id: '010'
title: 'ProjectDetail page part 2: library drawer (literal + conversational filter)
  + references'
status: open
use-cases:
- SUC-002
- SUC-003
- SUC-015
depends-on:
- '002'
- '004'
- '005'
- '009'
github-issue: ''
issue: real-two-pane-app.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# ProjectDetail page part 2: library drawer (literal + conversational filter) + references

## Description

Promote `MockupLeftBrowser.tsx` and `MockupMain.tsx`'s drawer/reference
mechanics into the real `/projects/:id` page (building on ticket 009's
output pane + chat panel).

**Drawer** (promoted from `MockupLeftBrowser.tsx`):
- Vertical pull-out tab on the left edge; sliding overlay over ~7/8 of
  the iterations list and chat window (stakeholder round 5).
- Categories (assets, examples, styles, projects) backed by `GET
  /api/catalog/tree` (ticket 005), real thumbnails via `GET /api/files/*`
  (ticket 004).
- **Literal filter bar**: `GET /api/catalog/search?q=` (ticket 005, FTS5).
- **Conversational/semantic filter** (SUC-015, UC-014's primary path —
  previously deferred as out of scope in an earlier draft of this
  sprint's plan; now built): the drawer subscribes to the *same* SSE
  event stream ticket 009's chat panel already consumes. When a
  `tool_call_finished` event arrives for `search_catalog` (ticket 002),
  the drawer updates its visible filtered set to that call's matched
  items, opening the drawer if it was closed. No new event type or
  protocol — this reuses the chat SSE stream's existing
  `tool_call_finished` event shape.
- **Double-click adds & closes**: double-clicking an item calls `POST
  /api/projects/:id/references` (ticket 006 -> ticket 002's
  `add_reference`) and closes the drawer automatically (stakeholder
  round 5).

**Reference strip** (promoted from `MockupMain.tsx`'s references state):
- Real, persisted `Reference` rows from `GET /api/projects/:id` (ticket
  006), not the mockup's in-memory-only `useState`.
- Renders as a small image thumbnail (via `GET /api/files/*`) with an X
  in the upper corner (stakeholder round 8) — never a text lozenge.
- Clicking the X calls `DELETE /api/projects/:id/references/:refId`
  (ticket 006 -> ticket 002's `remove_reference`).

## Acceptance Criteria

- [ ] Drawer renders real catalog data (no `mockupStubData.ts` import),
      real thumbnails via `GET /api/files/*`.
- [ ] Literal filter bar narrows results via the real FTS5 endpoint.
- [ ] Double-click adds a real, persisted `Reference` and closes the
      drawer (round-5 regression test).
- [ ] Asking Claude in chat to filter by content (e.g. "show me the
      assets with robots in them") results in a `search_catalog` tool
      call whose `tool_call_finished` SSE event updates the drawer's
      visible item set without a page reload — verify with a scripted/
      mocked SSE stream, not a live agent call.
- [ ] No matching assets from a conversational query → drawer shows an
      empty/broaden-your-query state, not an error (UC-014 E1).
- [ ] Reference strip renders real, persisted references as
      image-with-X, never a text lozenge.
- [ ] Removing a reference (clicking X) deletes the `Reference` row and
      updates the strip; reloading the page confirms it's gone.
- [ ] Empty-catalog state (no assets at all) renders without error
      (UC-002 E1).

## Implementation Plan

**Approach**: Direct promotion of `MockupLeftBrowser.tsx`'s structure,
with the drawer's visible-item state driven by two sources: the literal
filter bar's own `GET /api/catalog/search` call, and the shared SSE
stream's `search_catalog` `tool_call_finished` events (a `useEffect`
subscribing to the same stream/event-emitter ticket 009's chat panel
hook exposes — do not open a second SSE connection).

**Files to create**:
- `client/src/pages/ProjectDetail/LibraryDrawer.tsx` (promoted from
  `MockupLeftBrowser.tsx`).
- `client/src/pages/ProjectDetail/ReferenceStrip.tsx` (promoted from
  `MockupMain.tsx`'s reference-chip rendering).
- Component/integration test files.

**Files to modify**:
- `client/src/pages/ProjectDetail/index.tsx` — wire in the drawer and
  reference strip; share the SSE stream/hook from ticket 009 rather than
  duplicating the connection.

**Testing plan**: Component tests per wireframe rule (double-click add +
auto-close, X-to-remove, empty state). A dedicated test driving a mocked
SSE stream that emits a `search_catalog` `tool_call_finished` event and
asserting the drawer's visible set updates accordingly (SUC-015's core
acceptance criterion) — no live embedding/vision API call anywhere in
this suite.

**Documentation updates**: None.

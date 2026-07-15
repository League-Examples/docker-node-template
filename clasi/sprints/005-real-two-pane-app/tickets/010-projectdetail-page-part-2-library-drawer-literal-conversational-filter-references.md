---
id: '010'
title: 'ProjectDetail page part 2: library drawer (literal + conversational filter)
  + references'
status: in-progress
use-cases:
- SUC-002
- SUC-003
- SUC-015
depends-on:
- '002'
- '004'
- '005'
- 009
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

- [x] Drawer renders real catalog data (no `mockupStubData.ts` import),
      real thumbnails via `GET /api/files/*`.
- [x] Literal filter bar narrows results via the real FTS5 endpoint.
- [x] Double-click adds a real, persisted `Reference` and closes the
      drawer (round-5 regression test).
- [x] Asking Claude in chat to filter by content (e.g. "show me the
      assets with robots in them") results in a `search_catalog` tool
      call whose `tool_call_finished` SSE event updates the drawer's
      visible item set without a page reload — verify with a scripted/
      mocked SSE stream, not a live agent call.
- [x] No matching assets from a conversational query → drawer shows an
      empty/broaden-your-query state, not an error (UC-014 E1).
- [x] Reference strip renders real, persisted references as
      image-with-X, never a text lozenge.
- [x] Removing a reference (clicking X) deletes the `Reference` row and
      updates the strip; reloading the page confirms it's gone.
- [x] Empty-catalog state (no assets at all) renders without error
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

## Deviations from this plan (recorded during implementation)

- **No shared SSE hook/event-emitter exists to subscribe to.** `ChatPanel.tsx`
  (ticket 009) never exposed a hook or event-emitter -- it parses
  `TurnEvent`s inline inside `handleSend`'s call to `postSseStream`. Rather
  than refactoring ticket 009's SSE consumption into a new shared hook
  (out of this ticket's stated files-to-modify), `ChatPanel.tsx` gained one
  optional prop, `onToolCallFinished?: (name, result, isError) => void`,
  invoked from the existing `tool_call_finished` case alongside its
  existing status-text handling. `ProjectDetail/index.tsx` wires this to
  `LibraryDrawer`'s `searchCatalogMatches` prop. The outcome the plan cares
  about -- **no second SSE connection is ever opened** -- holds exactly as
  specified; only the mechanism (a lifted callback prop vs. a literal
  shared hook object) differs from the plan's wording.
- **`LibraryDrawer.tsx` owns its own `open`/`closed` state and the
  pull-tab/overlay wrapper itself**, rather than `ProjectDetail/index.tsx`
  owning `open` and passing it down. This matches the ticket-009 seam
  comment ("Ticket 010 slots the collapsible library drawer in here, as a
  `data-testid="library-overlay"` sibling") more directly: `index.tsx`
  only renders `<LibraryDrawer projectId onReferenceAdded
  searchCatalogMatches />` and never needs to know whether the drawer is
  currently open.
- **Category data sources for the four wireframe tabs** (assets, examples,
  styles, projects) are not literally "all four backed by `GET
  /api/catalog/tree`" as the Description implies -- `catalog.ts`'s own
  header (ticket 005) already flagged that the "projects" category has no
  `WorkspaceDirectory` equivalent. Implemented split, documented in
  `LibraryDrawer.tsx`'s own header comment:
  - `assets`/`examples`: `Asset` rows from `GET /api/catalog/tree`, split
    by directory path -- `assets/prior-art` (the one prior-art collection
    the workspace scaffold seeds) maps to "examples"; every other
    `assets/*` directory maps to "assets".
  - `styles`: `KnowledgeEntry` rows with `kind === 'style'` (schema's
    documented enum also has `palette`/`composition`/`layout`/`rule`/
    `guardrail` -- only `style` matches this tab).
  - `projects`: a second, already-existing read, `GET /api/projects?view=
    all` (ticket 006) -- browsable only, never double-click-addable (see
    next point).
- **Double-click-add is asset-only.** `Reference.assetId` is a required,
  non-nullable FK to `Asset` (`schema.prisma`) -- there is no legal
  `Reference` row for a `KnowledgeEntry` (style/palette/composition/
  layout) or a `Project` tab item. Double-clicking a non-asset item is a
  documented no-op rather than a disabled-looking control; only
  `ownerType: 'asset'` items (from any of the three sources: category
  browse, literal filter, or semantic filter) call `POST
  /api/projects/:id/references`.
- **Default `role` on a drawer-added reference is `'style'`**, matching the
  same default `projects.ts`'s `POST /projects` (`sourceAssetRole`) already
  uses for the Library-asset-to-project flow (SUC-011) -- neither the
  wireframe nor this ticket's plan specifies a role-selection control for
  the drawer's double-click-add path.
- Added one integration test file beyond the plan's two: `tests/client/
  ProjectDetailReferenceStrip.test.tsx` (isolated coverage for the
  extracted component) and a new describe block in the existing `tests/
  client/ProjectDetail.test.tsx` (the full-page SSE-driven drawer-opens
  integration test SUC-015 calls for), alongside the planned `tests/
  client/ProjectDetailLibraryDrawer.test.tsx`.

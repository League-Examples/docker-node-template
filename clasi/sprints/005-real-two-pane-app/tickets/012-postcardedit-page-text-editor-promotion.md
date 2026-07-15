---
id: '012'
title: 'PostcardEdit page: text editor promotion'
status: open
use-cases:
- SUC-009
depends-on:
- '004'
- '006'
- '008'
- '009'
github-issue: ''
issue: real-two-pane-app.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# PostcardEdit page: text editor promotion

## Description

Promote `MockupPostcardEdit.tsx` to a real `client/src/pages/
PostcardEdit.tsx`, mounted at `/projects/:id/postcard` (ticket 007's
route). Reached from the iterations view's "Text Entry" button (ticket
009).

- **Front/back tabs**: preview images sourced from the project's
  `Iteration.role` (ticket 001/002 — whichever iteration currently holds
  `role: 'front'`/`'back'`), rendered via `GET /api/files/*` (ticket 004)
  — not the mockup's hardcoded `/mockup-assets/robot-riot-iter-002.jpg`/
  `iter-004.jpg` paths.
- **Click-to-edit text regions**: click → popup sized to fit all text →
  Return commits; popup carries a Delete button (rounds 2, 4, 7).
- **Drag-to-draw new boxes**: rubber-band from the anchor corner, naming
  popup on release, box created at the exact drawn size — overflow
  clipped, not shown (rounds 7, 8).
- **Move handles**: bottom-left/top-right corner grab squares reposition
  a box (round 8).
- **QR overlay**: clicking it prompts for the URL it encodes (round 4).
- **Chat box below** (reuse ticket 009's SSE hook/component — do not
  duplicate the `fetch()`+`ReadableStream` consumption logic): the
  chat here is not limited to text-region edits (round 2).
- **No asset browser on this page** — explicit stakeholder rule, verify
  by construction (this route never renders `LibraryDrawer`).
- **Save**: persists via the existing `PUT /api/postcards/:id` (Sprint
  004, unchanged content-JSON shape, gate relaxed by ticket 006). Before
  submitting, resolve `front_image`/`back_image` from whichever
  `Iteration` currently holds `role: 'front'`/`'back'` (keeping
  `postcard-content.json` in sync with the UI's `Iteration.role` source
  of truth, per architecture-update.md **R4**).
- **Generate PDF**: `POST /api/postcards/:id/pdf` (Sprint 004, unchanged,
  gate relaxed), same pattern as the iterations view's PDF button
  (ticket 009).
- **Back button**: to `/projects/:id` (the iterations view).
- **No separate text-region list section** (removed stakeholder round
  10) — editing is click-on-box only; do not reintroduce it.

## Acceptance Criteria

- [ ] Front/back tab previews render via `GET /api/files/*` from
      `Iteration.role`, not a hardcoded mockup asset path.
- [ ] Click-to-edit popup: opens on click, sized to fit text, Return
      commits, Delete button removes the box (component test).
- [ ] Drag-to-draw: rubber-bands from anchor, naming popup on release,
      resulting box is exactly the drawn size; overflowing text is
      visually clipped, not shown (component test).
- [ ] Move handles on bottom-left/top-right reposition a box
      (component test).
- [ ] QR overlay click opens a URL-entry popup (component test).
- [ ] Chat box below is wired to the same real SSE mechanism as ticket
      009 (no duplicate `EventSource`/stream-parsing logic).
- [ ] Asset browser (`LibraryDrawer`) never renders on this route —
      verify by asserting its absence in every test for this page, not
      just by omission.
- [ ] Text-region list section (removed round 10) does not reappear.
- [ ] Save calls `PUT /api/postcards/:id` with `front_image`/`back_image`
      correctly resolved from current `Iteration.role` state.
- [ ] Generate PDF calls `POST /api/postcards/:id/pdf` and opens the
      result, reachable by a non-admin authenticated user.
- [ ] Back button navigates to `/projects/:id`.

## Implementation Plan

**Approach**: Direct promotion of `MockupPostcardEdit.tsx`'s existing,
already-fairly-complete interaction logic (the mockup already implements
drag-to-draw, move handles, click-to-edit, and QR popup mechanics against
stub data) — the bulk of this ticket's work is wiring real data sources
(`Iteration.role` for preview images, `PUT`/`POST /api/postcards/:id[/pdf]`
for persistence) in place of the mockup's local `useState` and hardcoded
paths, not rebuilding the interaction mechanics from scratch.

**Files to create**:
- `client/src/pages/PostcardEdit.tsx` (promoted from
  `MockupPostcardEdit.tsx`).
- Component test file covering every interaction rule above.

**Files to modify**:
- `client/src/App.tsx` — point `/projects/:id/postcard` at the real
  component (if not already done by ticket 007's placeholder).

**Testing plan**: Component tests per interaction rule, mirroring
`MockupPostcardEdit.tsx`'s own existing test suite's structure/selectors
where possible (the `data-testid` attributes already in the mockup —
`postcard-preview`, `draw-rubber-band`, `move-handle-bl-*`,
`postcard-region-box-*`, `postcard-extra-overlay`, `postcard-qr-url` —
should carry over unchanged so existing test patterns remain valid
against the promoted component). Mocked `PUT`/`POST /api/postcards/:id[/pdf]`
network, no live PDF rendering in this ticket's own tests (Sprint 004's
fixture convention).

**Documentation updates**: None.

---
id: '012'
title: 'PostcardEdit page: text editor promotion'
status: done
use-cases:
- SUC-009
depends-on:
- '004'
- '006'
- 008
- 009
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

- [x] Front/back tab previews render via `GET /api/files/*` from
      `Iteration.role`, not a hardcoded mockup asset path.
- [x] Click-to-edit popup: opens on click, sized to fit text, Return
      commits, Delete button removes the box (component test).
- [x] Drag-to-draw: rubber-bands from anchor, naming popup on release,
      resulting box is exactly the drawn size; overflowing text is
      visually clipped, not shown (component test).
- [x] Move handles on bottom-left/top-right reposition a box
      (component test).
- [x] QR overlay click opens a URL-entry popup (component test).
- [x] Chat box below is wired to the same real SSE mechanism as ticket
      009 (no duplicate `EventSource`/stream-parsing logic).
- [x] Asset browser (`LibraryDrawer`) never renders on this route —
      verify by asserting its absence in every test for this page, not
      just by omission.
- [x] Text-region list section (removed round 10) does not reappear.
- [x] Save calls `PUT /api/postcards/:id` with `front_image`/`back_image`
      correctly resolved from current `Iteration.role` state.
- [x] Generate PDF calls `POST /api/postcards/:id/pdf` and opens the
      result, reachable by a non-admin authenticated user.
- [x] Back button navigates to `/projects/:id`.

## Implementation Notes / Deviations

- `client/src/App.tsx` needed **no change** -- ticket 007 already routed
  `/projects/:id/postcard` at the real `PostcardEdit` component (its
  placeholder body only). This ticket replaced the placeholder's body;
  `App.tsx` itself is untouched.
- "Save" and "Generate PDF" (AC9/AC10) are **one button, one click**, not
  two separate controls -- matching the Description's explicit "same
  pattern as the iterations view's PDF button (ticket 009)", which itself
  does PUT-then-POST as a single action. The PUT now carries this page's
  real `front_regions`/`back_regions`/`front_extra_html`/`back_extra_html`
  (not just the two image paths `OutputPane`'s quick-PDF button sends).
- Text-region/QR-URL state is **client-side for the duration of one
  editing session** -- there is no `GET` of a previously-persisted
  `postcard-content.json` on mount, since `postcards.ts` (Sprint 004) only
  exposes `PUT`/`POST .../pdf`, no read-back route. Adding that route
  would be server-side work outside this ticket's stated file list
  (`PostcardEdit.tsx` + its test + `App.tsx`). Every "Generate PDF" click
  still submits a complete, self-consistent content JSON for whatever is
  currently drawn in the session.
- QR overlay: the mockup only showed the QR box on the back face (its stub
  project happened to be front-image-only). The real content-JSON schema
  supports an independent `front_extra_html`/`back_extra_html` per face,
  so the promoted page renders the QR overlay -- and lets a URL be set --
  on **both** faces, each with its own state. Actual QR-*image* generation
  (a real scannable code, as opposed to a labeled placeholder box carrying
  the URL as text and a `data-qr-url` attribute) is out of this ticket's
  scope; no QR-generation service exists elsewhere in the codebase.
- Drawn boxes use `style: ''` (no raw CSS) rather than the mockup's
  `style: 'custom'` placeholder string, since this field is sent verbatim
  as CSS to the server's `renderPostcardHtml` (`postcardRender.ts`) --
  `'custom'` is not valid CSS and was a mockup-only stand-in value.

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

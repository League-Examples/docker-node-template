---
id: '013'
title: 'Cleanup: remove mockups, update AppLayout tests, full walkthrough integration
  test'
status: done
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
- SUC-005
- SUC-006
- SUC-007
- SUC-008
- SUC-009
- SUC-010
- SUC-011
- SUC-012
- SUC-013
- SUC-014
- SUC-015
depends-on:
- 008
- 009
- '010'
- '011'
- '012'
github-issue: ''
issue: real-two-pane-app.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Cleanup: remove mockups, update AppLayout tests, full walkthrough integration test

## Description

Final ticket of the sprint. Two parts:

**1. Remove the mockup scaffolding.** With every promoted page (tickets
008-012) landed and verified, delete:
- `client/src/pages/mockups/` — all seven files (`MockupChatPanel.tsx`,
  `MockupLeftBrowser.tsx`, `MockupLogin.tsx`, `MockupMain.tsx`,
  `MockupNewProject.tsx`, `MockupOutputPane.tsx`, `MockupPostcardEdit.tsx`,
  `MockupProjects.tsx`, `MockupsIndex.tsx`).
- `client/src/pages/mockups/mockupStubData.ts`.
- Confirm no remaining import anywhere in `client/src/` references
  `pages/mockups/*` or `mockupStubData.ts` (grep as a verification step,
  not just a visual check).
- Confirm `App.tsx` has no `/mockups/*` route left (ticket 007 already
  removed the route block; this ticket removes the files it pointed at).

**2. Full walkthrough integration test + final regression pass**
(sprint.md Test Strategy: "at least one integration-level test per major
flow... using mocked network/SSE responses"):
- One integration test driving: log in → project list → new project →
  drag/double-click a reference into the project → chat turn that
  generates an image → mark it accepted → open the postcard text editor
  → edit text → generate a PDF — end to end, with mocked network/SSE
  responses throughout (no live OpenAI/OpenRouter/Anthropic calls, per
  sprint.md: "No live OpenAI/OpenRouter calls in CI").
- Re-verify all twelve wireframe-review interaction rules (rounds 1-12,
  sprint.md Success Criteria) each still have a passing, traceable test
  after every page's promotion — this is a final audit pass, not new
  test-writing from scratch (each rule should already be covered by its
  owning ticket 008-012; this ticket confirms none regressed and none was
  silently dropped during promotion).
- Confirm `AppLayout.test.tsx` (updated incrementally by tickets 002/004
  and ticket 007) has no stale assertions against the old sidebar/mockup
  structure.
- Confirm no regression in Sprint 001's auth flow or Sprint 002's shell
  (sprint.md Success Criteria).

## Acceptance Criteria

- [x] `client/src/pages/mockups/` directory and `mockupStubData.ts` are
      deleted.
- [x] `grep -r "pages/mockups\|mockupStubData" client/src` returns zero
      matches outside of this ticket's own commit history/changelog.
- [x] `App.tsx` has no `/mockups/*` route.
- [x] A new integration test exercises the full walkthrough (login →
      browse → drag reference → generate → accept → postcard text edit →
      PDF) with mocked network/SSE, asserting no console error and no
      unhandled agent-runtime failure surfaced silently.
- [x] All twelve wireframe-review rules (rounds 1-12) have a passing,
      identifiable test — produce a short mapping (rule → test file/name)
      in this ticket's implementation notes for traceability.
- [x] `AppLayout.test.tsx` has no assertions referencing the removed
      product sidebar or mockup routes.
- [x] Full `npm test` (client + server) passes with zero regressions.

## Implementation Plan

**Approach**: This ticket is verification-and-cleanup, not new feature
work — it should not need to touch any promoted page's implementation
unless the audit pass in acceptance criteria surfaces a real gap (in
which case, fix it here rather than deferring, since this is the sprint's
last ticket).

**Files to remove**:
- `client/src/pages/mockups/*` (all seven files).
- `client/src/pages/mockups/mockupStubData.ts`.

**Files to modify**:
- `client/src/App.tsx` — final confirmation pass (no code change
  expected if ticket 007 already did this correctly).
- `client/src/components/AppLayout.test.tsx` — remove any stale
  assertions.

**Files to create**:
- Full-walkthrough integration test file (e.g. `client/src/pages/
  __tests__/full-walkthrough.integration.test.tsx` or the project's
  established integration-test location/convention).

**Testing plan**: The integration test itself is the primary deliverable
here; also run the complete `npm test` suite (root script, per
`docs/architecture/architecture-update-002.md`'s "combined `npm test`"
tooling work) to confirm zero regressions across both client and server
after the mockup removal.

**Documentation updates**: Update sprint.md's Tickets table (already
populated) to reflect final status once this ticket completes; no other
user-facing docs change.

## Implementation Notes

**Deleted**: `client/src/pages/mockups/` (all ten files — nine `Mockup*.tsx`
components plus `mockupStubData.ts`), `client/src/pages/HomePage.tsx` (the
old wireframe-linking landing page — dead since ticket 007/008 made
`ProjectList` the `/` route; `App.tsx` never imported it), and the seven
now-orphaned test files that only existed to cover those deleted modules:
`tests/client/HomePage.test.tsx`, `MockupLogin.test.tsx`,
`MockupMain.test.tsx`, `MockupNewProject.test.tsx`,
`MockupPostcardEdit.test.tsx`, `MockupProjects.test.tsx`,
`MockupsIndex.test.tsx`.

**Grep proof** (`grep -rn "pages/mockups\|mockupStubData" client/src`):
every remaining hit is a doc-comment/header reference in a promoted page
(`ProjectList.tsx`, `PostcardEdit.tsx`, `ChatPanel.tsx`,
`ProjectDetail/index.tsx`, `ProjectDetail/types.ts`,
`ProjectDetail/OutputPane.tsx`, `ProjectDetail/LibraryDrawer.tsx`)
narrating what each file was promoted *from* — none is a live `import`
statement (cross-checked against `^import` in every file the grep touched).
`App.tsx` carries no `/mockups/*` route (confirmed by ticket 007, re-
verified here). `AppLayout.test.tsx` was already free of stale
sidebar/mockup assertions — no edit needed.

**Full-walkthrough integration test**: added
`tests/client/full-walkthrough.integration.test.tsx`. Renders the real
`<App />` tree (`AuthContext` mocked authenticated, matching
`App.test.tsx`'s own "log in" convention — the real Google OAuth handshake
is a server redirect outside the SPA) and drives: browse the Library tab →
"New project" → open the library drawer and double-click-add a reference
(this app's real add mechanism; there is no native HTML5 drag-and-drop
anywhere in `client/src`, confirmed by the grep audit above) → two chat
turns over a mocked SSE stream, each triggering a scripted
`generate_image` tool call (covers "generate" then "iterate") → navigate
back to the project list and back into the project (this app's documented
"a reload surfaces Claude's updates" design — see `OutputPane.tsx`'s and
`ProjectDetailsHeader.tsx`'s own header comments — so the two generated
iterations only become visible after this in-app reload, exercised
verbatim rather than faked) → mark the first iteration accepted and as
the front → "Text Entry" into the postcard editor → drag-to-draw a text
box, type and commit its text → "Generate PDF" (PUT then POST, blob
opened via a mocked `window.open`). Final assertions: no
`role="alert"` node anywhere in the tree and `console.error` never called
(sprint.md Success Criteria: "completes without a console error or an
unhandled agent-runtime failure surfaced silently").

**Twelve wireframe-review rules → owning test** (sprint.md Success
Criteria list, rounds 1-12 per the Solution section's own round
citations):

| # | Rule | Test file → describe block |
|---|------|------------------------------|
| 1 | Vertical, one-per-row iteration layout | `ProjectDetailOutputPane.test.tsx` → `OutputPane -- vertical, one-per-row gallery (round 1 regression)` |
| 2 | Hero = most-recently-accepted, front-over-back for postcards | `ProjectList.test.tsx` → `ProjectList hero-image selection rule (SUC-010)` |
| 3 | Exclusive accepted checkbox | `ProjectDetailOutputPane.test.tsx` → `OutputPane -- accepted checkbox exclusivity (rounds 6-7)` |
| 4 | Exclusive front/back pulldown | `ProjectDetailOutputPane.test.tsx` → `OutputPane -- front/back pulldown exclusivity (rounds 6-7)` |
| 5 | ≤800x800 centered media | `ProjectDetailOutputPane.test.tsx` → `OutputPane -- media capped at 800x800 and centered (round 9)` |
| 6 | Collapsible pull-out drawer, double-click auto-close | `ProjectDetailLibraryDrawer.test.tsx` → `LibraryDrawer -- pull-out tab open/close` + `LibraryDrawer -- double-click adds & auto-closes (SUC-003, round-5 regression)` |
| 7 | Asset browser never shown on the postcard editor | `PostcardEdit.test.tsx` → `PostcardEdit -- asset browser never renders (AC7)` (also asserted via `assertNoLibraryDrawer()` in every other describe in that file) |
| 8 | Drag-to-draw fixed-size text boxes, clip-not-collapse overflow | `PostcardEdit.test.tsx` → `PostcardEdit -- drag-to-draw a new box (AC3)` |
| 9 | Move handles on bottom-left/top-right | `PostcardEdit.test.tsx` → `PostcardEdit -- move handles (AC4)` |
| 10 | Click-to-edit popup sized to fit all text | `PostcardEdit.test.tsx` → `PostcardEdit -- click-to-edit popup (AC2)` |
| 11 | QR URL popup | `PostcardEdit.test.tsx` → `PostcardEdit -- QR overlay (AC5)` |
| 12 | My/All/Library/Archive views + Library-asset-to-project flow (rounds 11 and 12 respectively, per the Solution section — grouped here since both live in the same file) | `ProjectList.test.tsx` → `ProjectList views` + `ProjectList library-asset-to-project flow (SUC-011)` |

Every row above still passes after the mockup removal (full `npm test`
run, zero regressions — 400 server tests + 1 skipped Chromium-only PDF
test, 155 client tests including the new capstone integration test).
`full-walkthrough.integration.test.tsx` additionally re-exercises rows 1,
2 (via the reload step landing on `ProjectList`), 3, 4, 6, and 12 (Library
tab) end-to-end in one continuous session, on top of each row's own
dedicated per-page test.

**Deviation**: none. Audit pass found no gap in the twelve rules'
coverage — every rule already had an owning test from its promoting
ticket (008-012); this ticket only had to produce the mapping and add the
capstone walkthrough test, per the ticket's own "verification-and-cleanup,
not new feature work" framing.

**Sprint success criteria re-verified**:
- "No `mockupStubData.ts` import remains in any promoted page" — confirmed
  by the grep proof above.
- "Every UC-002 through UC-014 flow is exercisable end-to-end through the
  live UI" — the full-walkthrough test exercises UC-002 (browse/add from
  library), UC-003/UC-004 (new project via chat), UC-005 (chat-driven
  generation), UC-006/UC-007 (accepted/front-back state), UC-009 (postcard
  text editing + PDF) against real, mocked-network-backed components; the
  per-page test suites (008-012) cover the rest.
- "No regression in Sprint 001's auth flow or Sprint 002's shell" —
  `AppLayout.test.tsx` (22 tests) and `App.test.tsx` (5 tests) pass
  unchanged.

---
id: '013'
title: 'Cleanup: remove mockups, update AppLayout tests, full walkthrough integration
  test'
status: open
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
- '008'
- '009'
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

- [ ] `client/src/pages/mockups/` directory and `mockupStubData.ts` are
      deleted.
- [ ] `grep -r "pages/mockups\|mockupStubData" client/src` returns zero
      matches outside of this ticket's own commit history/changelog.
- [ ] `App.tsx` has no `/mockups/*` route.
- [ ] A new integration test exercises the full walkthrough (login →
      browse → drag reference → generate → accept → postcard text edit →
      PDF) with mocked network/SSE, asserting no console error and no
      unhandled agent-runtime failure surfaced silently.
- [ ] All twelve wireframe-review rules (rounds 1-12) have a passing,
      identifiable test — produce a short mapping (rule → test file/name)
      in this ticket's implementation notes for traceability.
- [ ] `AppLayout.test.tsx` has no assertions referencing the removed
      product sidebar or mockup routes.
- [ ] Full `npm test` (client + server) passes with zero regressions.

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

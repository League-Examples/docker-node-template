---
id: '003'
title: Mockup shell and two-pane main layout wireframe
status: done
use-cases:
- UC-002
depends-on: []
github-issue: ''
issue: wireframe-mockups.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Mockup shell and two-pane main layout wireframe

## Description

Establish the `client/src/pages/mockups/` module and its `/mockups/*` route
tree (architecture-update.md, "Wireframe Mockup Module"), and build the
first two pages in it: the mockups index (`/mockups`) and the two-pane
main layout wireframe (`/mockups/main`). Per spec §2/§3/§7 and UC-002, the
main layout shows a left-side browser for assets, examples, styles, and
previous projects, and a right side with the project-output view occupying
the top three-quarters and a chat window below. Both pages render outside
`AppLayout` (Decision 4: the mockups preview a layout that replaces most of
`AppLayout`'s sidebar role, so nesting them inside the current sidebar
shell would misrepresent the wireframe) and are not auth-gated. All data is
static/stubbed; no backend calls. Wireframe fidelity only — structural
boxes and labels, not visual design.

## Acceptance Criteria

- [x] New `client/src/pages/mockups/` module exists, self-contained, with
      zero imports from the rest of the app (matches the architecture's
      "zero fan-out" constraint).
- [x] `/mockups` route renders an index page linking to the two-pane main
      layout mockup, and lists the other three planned mockups (new-project
      flow, postcard text-region form, Google-only login) as clearly
      not-yet-built placeholders rather than dead links.
- [x] `/mockups/main` route renders the two-pane layout: left pane is a
      browser with category tabs for Assets, Examples, Styles, and
      Projects, each showing a static stub list; right pane is split into
      an output area (~top three-quarters) showing stub project-iteration
      placeholders and a chat panel (~bottom quarter) showing a stub
      message thread and a disabled message input.
- [x] Both routes are registered in `App.tsx` as siblings of `/login`
      (outside the `AppLayout`-wrapped route tree), so they render with no
      sidebar/topbar and are reachable without authentication.
- [x] No page in this module calls the backend (`fetch`, React Query, etc.)
      — all content comes from a local stub-data module.
- [x] `npm run test:client` and `npm run test:server` pass; `tsc` is clean
      in both `client/` and `server/`.

## Testing

- **Existing tests to run**: `npm run test:server` (178 tests),
  `npm run test:client` (existing 58 tests must keep passing).
- **New tests to write**:
  - `tests/client/MockupsIndex.test.tsx` — renders the heading, the live
    link to `/mockups/main`, and confirms the three not-yet-built mockups
    render as non-navigable placeholders (no `<a>`/`role=link`).
  - `tests/client/MockupMain.test.tsx` — renders the four category tabs,
    defaults to the Assets tab, switches the visible library list on tab
    click, renders the output area's iteration placeholders (including the
    "current" iteration marker), and renders the chat panel's message
    thread and disabled input/send button.
- **Verification command**: `npm run test:client` (from repo root; also run
  `npm run test:server` to confirm no regressions in the untouched server
  suite).

**Result**: `npm run test:client` — 66/66 passing (58 baseline + 8 new).
`npm run test:server` — 178/178 passing (unchanged). `tsc -b --noEmit`
clean in both `client/` and `server/`.

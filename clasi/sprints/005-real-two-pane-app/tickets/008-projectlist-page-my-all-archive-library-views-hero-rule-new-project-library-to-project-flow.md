---
id: '008'
title: 'ProjectList page: My/All/Archive/Library views, hero rule, new-project, library-to-project
  flow'
status: open
use-cases:
- SUC-010
- SUC-011
depends-on:
- '004'
- '005'
- '006'
- '007'
github-issue: ''
issue: real-two-pane-app.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# ProjectList page: My/All/Archive/Library views, hero rule, new-project, library-to-project flow

## Description

Promote `client/src/pages/mockups/MockupProjects.tsx` to a real,
data-bound `client/src/pages/ProjectList.tsx`, mounted at `/` (the
authenticated home route — "no counter demo," stakeholder round-6
framing). Replace every `STUB_PROJECT_CARDS`/`LIBRARY_ITEMS` reference
with real data from ticket 006's `GET /api/projects?view=` and ticket
005's `GET /api/catalog/tree`.

- **My / All / Archive views**: real, data-backed (`view=mine|all|
  archive` query param), not navigation-only stubs.
- **Library view**: switches to catalog assets (`GET /api/catalog/tree`),
  not projects.
- **Hero image rule** (stakeholder round 6): each card's hero is the
  project's most recently accepted iteration; for a project with an
  accepted `role: 'back'` iteration *and* a separate accepted `role:
  'front'` (or unmarked) iteration, the front/unmarked one wins — a
  postcard's hero is never its back. Falls back to the last iteration
  overall if nothing is accepted. Render the hero image via ticket 004's
  `GET /api/files/*`.
- **New project button**: `POST /api/projects` (ticket 006), navigate to
  `/projects/:id` on success.
- **Library-asset-to-project flow** (stakeholder round 12, SUC-011):
  clicking a Library asset calls `POST /api/projects` with
  `{ sourceAssetId }` (ticket 006 already pre-attaches the reference
  server-side), then navigates to `/projects/:id` — the new project's
  reference strip (ticket 010) already shows the source asset with no
  further action.

## Acceptance Criteria

- [ ] `/` renders `ProjectList`, not any prior `HomePage.tsx` content —
      no `mockupStubData.ts` import remains.
- [ ] My/All/Archive are real, data-backed views (component test per
      view, asserting the correct filter param and result set).
- [ ] Library view renders real catalog assets via `GET /api/catalog/tree`,
      not project cards.
- [ ] Hero-image selection rule (accepted, front-over-back for postcards,
      fallback to last) has a passing component test covering all three
      branches (accepted+front wins over accepted+back; nothing accepted
      falls back to last; single accepted iteration with no role is used
      directly).
- [ ] Every hero image renders via `GET /api/files/*` (real bytes, not a
      hardcoded `/mockup-assets/*` path).
- [ ] "New project" button creates a real `Project` row via `POST
      /api/projects` and navigates to `/projects/:id`.
- [ ] Clicking a Library asset creates a project (with `sourceAssetId`),
      navigates into it, and the created project's reference strip
      already shows the source asset (verify via an integration test
      spanning this ticket and ticket 010's reference-strip rendering).

## Implementation Plan

**Approach**: Direct promotion of `MockupProjects.tsx`'s existing
structure (view buttons, card grid, Library section) with TanStack Query
hooks replacing the stub-data imports. Preserve every existing CSS/layout
class from the mockup unless the real-data wiring requires a change.

**Files to create**:
- `client/src/pages/ProjectList.tsx`.
- Component test file.

**Files to modify**:
- `client/src/App.tsx` — point `/` at `ProjectList` (if not already done
  by ticket 007's placeholder).

**Files to remove**: none yet (ticket 013 removes
`client/src/pages/mockups/MockupProjects.tsx` once this ticket's
replacement is verified working).

**Testing plan**: React Testing Library component tests per wireframe
rule (view filters, hero selection algorithm's three branches, new-project
navigation, library-to-project navigation), mocking `GET /api/projects`/
`GET /api/catalog/tree`/`POST /api/projects` responses — no live network.

**Documentation updates**: None.

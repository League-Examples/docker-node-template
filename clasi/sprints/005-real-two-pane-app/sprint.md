---
id: '005'
title: Real Two-Pane App
status: roadmap
branch: sprint/005-real-two-pane-app
use-cases: []
issues:
- real-two-pane-app.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 005: Real Two-Pane App

## Goals

Promote every wireframe page under `client/src/pages/mockups/` to a real,
live-data component, wired to the schema (Sprint 002), the agent
runtime/MCP server (Sprint 003), and the generation/description/postcard
pipelines (Sprint 004) — preserving every interaction decision the
stakeholder locked down across wireframe-review rounds 1-12 in
`docs/design/stakeholder-spec-2026-07-13.md`. This is the sprint that
turns Flyerbot into the product the stakeholder described: log in, browse
the library, start a project by talking to Claude, drag in references,
generate and iterate images, edit postcard text, and see the result. It
is the first fully stakeholder-demoable end-to-end sprint.

## Problem

Every prior sprint (002-004) builds real backend capability behind mock
UI. None of it is usable by the stakeholder until the two-pane app is
live. The wireframes already encode a large amount of binding interaction
detail — vertical iteration layout, hero-image rule, exclusive front/back
and accepted flags, the pull-out library drawer, click-to-edit text boxes
with drag-to-draw and move handles, the QR URL popup, My/All/Library/
Archive project views, and the library-asset-to-project flow — all of
which must survive the promotion from static mockup to live component
without silent regressions.

## Solution

Promote each mockup page to its real counterpart, per architecture-001's
Web App Structure section:

- `MockupMain.tsx` → the sole authenticated home route: two-pane layout,
  left catalog / right project+chat, on top of the Sprint 002 shell
  (top-bar `AppLayout`, no product sidebar).
- `MockupLeftBrowser.tsx` → the real catalog browser: category tree over
  `WorkspaceDirectory`/`Collection`/`KnowledgeEntry`, conversational
  semantic-filter binding (UC-014) plus a literal `FTS5` filter bar;
  collapsible pull-out drawer opened by a vertical tab, overlaying ~7/8 of
  the content, auto-closing on double-click-to-add.
- `MockupOutputPane.tsx` → the iteration gallery: vertical layout, media
  scaled to at most 800x800 and centered, accepted checkbox (exclusive),
  front/back pulldown (exclusive — setting front clears the previous
  front), back-nav to the projects list, PDF button (Sprint 004 endpoint,
  marked/accepted sides only), Text Entry button forward to the postcard
  text editor.
- `MockupChatPanel.tsx` → the SSE-streaming chat UI: POSTs to the API
  Gateway, subscribes to the Sprint 003 Agent Runtime's SSE stream for
  the project's current turn; dragged/attached references render as a
  small image with an X to remove, not a text lozenge.
- `MockupNewProject.tsx` → the real create-project flow (UC-003):
  project-details header, empty output area, chat box; Claude fills
  `Project.detailsHeader` via clarifying questions.
- `MockupPostcardEdit.tsx` → the real text editor: front/back tabs (not
  side-by-side), postcard image with clickable text regions (click → popup
  large enough for all text → Return commits), drag-to-draw new fixed-size
  boxes (rubber-band from anchor corner, name prompt, overflow clipped not
  shown), move handles on bottom-left/top-right corners, delete via the
  box's popup, QR code box → URL prompt, chat box below, back-nav to
  iterations view, Generate PDF via the Sprint 004 endpoint. No separate
  text-region list section (removed per round 10) — editing is
  click-on-box only. Asset browser is never shown on this page (explicit
  stakeholder rule).
- Home/project-list page: list of all projects with a hero image per
  project (most recently accepted iteration; postcards use the front);
  My / All / Library / Archive view buttons (navigation-only acceptable
  for Library/Archive at this stage per round 11, but must be real
  routes, not stubs). Clicking a Library asset creates a project scoped
  to that asset (round 12), reusing the new-project flow.

## Success Criteria

- Every UC-002 through UC-014 flow is exercisable end-to-end through the
  live UI against real data — no `mockupStubData.ts` import remains in
  any promoted page.
- All twelve wireframe-review interaction rules (rounds 1-12) are present
  and covered by a client test each: vertical iteration layout; hero =
  most-recent-accepted (front for postcards); exclusive accepted
  checkbox; exclusive front/back pulldown; ≤800x800 centered media;
  collapsible pull-out drawer with double-click auto-close; asset browser
  never shown on the postcard editor; drag-to-draw fixed-size text boxes
  with clip-not-collapse overflow; move handles on bottom-left/top-right;
  click-to-edit popup sized to fit all text; QR URL popup; My/All/
  Library/Archive views; Library-asset-to-project flow.
- A full manual/scripted walkthrough — log in, browse library, drag a
  reference into a new project, generate and iterate an image, mark it
  accepted, edit postcard text, generate a PDF — completes without a
  console error or an unhandled agent-runtime failure surfaced silently.
- No regression in Sprint 001's auth flow or Sprint 002's shell.

## Scope

### In Scope

- Promotion of all six mockup pages (plus the project-list/home page) to
  live components against Sprints 002-004's backend.
- Removal of `mockupStubData.ts` and the `/mockups/*` stub routes (or
  their conversion into real routes, whichever the ticket-level plan
  picks — decided during detail planning).
- Client-side interaction logic for every wireframe-review rule listed
  above.

### Out of Scope

- Any new backend capability not already built in Sprints 002-004 —
  this sprint is UI wiring and interaction-behavior fidelity, not new
  domain logic. If a gap is found (e.g. a missing MCP tool), it is
  flagged back rather than silently added here.
- Subproject UI beyond what UC-009 already implies is needed for the
  logo-for-a-postcard case — deeper subproject-specific UI, if any, is
  deferred pending stakeholder input (architecture-001 Open Question 4).
- Cost-containment / rate-limiting UI (architecture-001 Open Question 7,
  unresolved).

## Test Strategy

Component tests per promoted page (React Testing Library) covering each
wireframe-review interaction rule individually — not just a smoke render.
At least one integration-level test per major flow (new project → drag
reference → generate → accept → postcard text edit → PDF) using mocked
network/SSE responses. Regenerate `AppLayout.test.tsx` coverage if the
home/project-list route changes the shell's nav structure further. No
live OpenAI/OpenRouter calls in CI — reuse Sprint 004's fixture approach.

## Architecture Notes

Implements architecture-001's Web App Structure section directly, module
by module (Client App). No new modules are introduced; this sprint
consumes the API Gateway, Agent Runtime, Catalog & Knowledge Store, and
Image & Vision Service surfaces built in Sprints 002-004 without changing
their boundaries. If UI wiring surfaces a genuine backend gap, that is an
architecture-update addendum for this sprint (detail planning) rather
than scope creep into ad hoc backend changes.

## GitHub Issues

None yet — this sprint's issues are CLASI-internal (`clasi/issues/`), not
yet mirrored to GitHub.

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [ ] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [ ] Architecture review passed
- [ ] Stakeholder has approved the sprint plan

## Tickets

(Populated during detail planning.)

Tickets execute serially in the order listed.

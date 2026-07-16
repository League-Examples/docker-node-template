---
id: '005'
title: Real Two-Pane App
status: closed
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
  live components, backed by whatever backend completion (routes, MCP
  tools, schema, auth fixes) a working, stakeholder-demoable end-to-end
  application actually requires — see **Scope correction** below.
- Removal of `mockupStubData.ts` and the `/mockups/*` stub routes (or
  their conversion into real routes, whichever the ticket-level plan
  picks — decided during detail planning).
- Client-side interaction logic for every wireframe-review rule listed
  above.

### Scope correction (2026-07-15)

An earlier version of this section said this sprint was "UI wiring and
interaction-behavior fidelity, not new domain logic" and that any
backend gap found should be "flagged back rather than silently added
here." The stakeholder corrected this directly: the mandate is "a
working application — do whatever you have to do to get a working
application." Backend work is fully in scope wherever a working,
stakeholder-demoable end-to-end app needs it. `architecture-update.md`'s
own Scope Correction note and Step 1-2 enumerate the concrete gaps this
pulled in against the actual server routes (not assumed complete):
workspace file-serving (nothing served real image bytes to the browser
at all), `catalog.ts`/`projects.ts` read/write routes, reference and
iteration-state catalog tools, conversational/semantic catalog search
(`search_catalog`, assembled from already-existing `embedText`/
`nearestNeighbors`/`keywordSearch`), and the first-user-admin race fix.

### Out of Scope

The two items below remain genuinely out of scope — not because of the
old backend constraint above, but because the stakeholder has not asked
for them and nothing in this sprint's promoted pages needs them to be
demoable end-to-end:

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
by module (Client App), and completes the API Gateway module's route
surface (`catalog.ts`/`files.ts`/`projects.ts`, alongside the existing
`chat.ts`). No new top-level modules are introduced — see
`architecture-update.md`'s Scope Correction note: this sprint delivers
whatever backend completion (routes, MCP tools, schema, auth fixes) a
working, stakeholder-demoable end-to-end application requires, verified
against the actual server routes rather than assumed complete. The prior
"flag genuine backend gaps rather than build them" framing has been
retracted (see `sprint.md`'s own Scope correction note above and
`architecture-update.md`'s Scope Correction note) — every gap found
during planning (workspace file-serving, reference/iteration-state
tools, conversational catalog search, first-user-admin race safety) is
built in this sprint's tickets, not deferred.

## GitHub Issues

None yet — this sprint's issues are CLASI-internal (`clasi/issues/`), not
yet mirrored to GitHub.

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [x] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [x] Architecture review passed
- [x] Stakeholder has approved the sprint plan

## Tickets

Tickets execute serially in the order listed below (dependency order).

| # | Title | Depends on |
|---|---|---|
| 001 | Iteration accepted/role schema migration | — |
| 002 | Workspace MCP Server: reference, iteration-state, and catalog-search tools | 001 |
| 003 | First-user-admin race-safety fix | — |
| 004 | Workspace file-serving route (`GET /api/files/*`) | — |
| 005 | API Gateway: `catalog.ts` (tree browse + FTS5 search) | — |
| 006 | API Gateway: `projects.ts` (CRUD, references, iteration-state) + chat/postcards auth-gate relaxation | 001, 002 |
| 007 | Client shell: `AppLayout` full-bleed mode + admin-console link + routing scaffold | 006 |
| 008 | `ProjectList` page: My/All/Archive/Library views, hero rule, new-project, library-to-project flow | 004, 005, 006, 007 |
| 009 | `ProjectDetail` page part 1: output pane + chat panel SSE | 004, 006, 007 |
| 010 | `ProjectDetail` page part 2: library drawer (literal + conversational filter) + references | 002, 004, 005, 009 |
| 011 | `NewProject` page | 006, 007, 009 |
| 012 | `PostcardEdit` page: text editor promotion | 004, 006, 008, 009 |
| 013 | Cleanup: remove mockups, update `AppLayout` tests, full walkthrough integration test | 008, 009, 010, 011, 012 |

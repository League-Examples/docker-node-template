---
id: 009
title: Iterations Fit-Width Single Scroll
status: planning-docs
branch: sprint/009-iterations-fit-width-single-scroll
worktree: false
use-cases: [SUC-016]
issues:
- iterations-single-scroll-fit-width.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 009: Iterations Fit-Width Single Scroll

## Goals

Correct Sprint 008's `OutputPane` stage/history split, per stakeholder
feedback on 2026-07-18: return to a single scrollable section containing
every iteration of the active face, with each image scaled to the width
of that section rather than fit to a fixed-height "stage." Keep Sprint
008's flex page layout (chat panel as a real flex sibling, not an
absolute overlay) — only the iteration display changes.

## Problem

Sprint 008 (`docs/architecture` update pending consolidation; see
`clasi/sprints/done/008-output-fit-and-chat-ergonomics/sprint.md`) split
`OutputPane`'s single scrolling stream into a non-scrolling "stage"
holding only the newest iteration (fit to the flex-computed height
between the header and the chat panel) plus a separate, independently
scrollable "history" strip for everything older, still capped at a flat
`800×800`. The stakeholder has now corrected that design
(`clasi/issues/iterations-single-scroll-fit-width.md`): the fixed-height
stage makes the newest poster too small to actually look at, and the
split itself is unwanted — every iteration should render at equal
standing in one list, each as large as the pane's width allows.

## Solution

Remove the stage/history split entirely. `OutputPane` renders the active
stream's iterations (newest first, unchanged ordering) as one vertically
scrollable list. Every row's image is sized to the width of that list —
`w-full h-auto`, aspect ratio preserved, no `max-h`/`max-w` pixel cap of
any kind (neither the old flat `800×800` history cap nor the stage's
`max-h-full`/`object-contain` fit-to-height treatment). This is a
same-file, same-component change: `renderIterationRow`'s per-row markup
and `IterationImage`'s sizing prop collapse from a two-mode
(`stage`/non-stage) shape back to one mode. Sprint 008's flex page shell
(`ProjectDetail/index.tsx`'s fixed-header / flex-`OutputPane` / flex-
sibling-`ChatPanel` column) is unaffected — that layout fix stands; only
what happens *inside* `OutputPane`'s flex-1 region reverts.

## Success Criteria

- `OutputPane` shows one scrollable list of all of the active stream's
  iterations; no `iteration-stage`/`iteration-history` sub-regions
  remain.
- Every iteration image spans the full available width of the pane,
  height auto, aspect preserved, never cropped or distorted.
- No fixed pixel cap (neither `800px` nor a fit-to-height stage rule) on
  any iteration image.
- Resizing the browser window rescales every visible image with the
  pane's width, without a reload.
- Accept/delete/inline-edit behavior for every row is unchanged.
- Sprint 008's flex page layout (chat panel as a real sibling) is
  untouched and still passes its existing layout tests.

## Scope

### In Scope

- `client/src/pages/ProjectDetail/OutputPane.tsx`: remove the
  `stageIteration`/`historyIterations` split and the `iteration-stage`/
  `iteration-history` sub-regions; render `streamIterations` as one
  `overflow-y-auto` list; collapse `renderIterationRow`'s `stage: boolean`
  parameter and `IterationImage`'s `fitToSpace` prop into a single
  width-fit sizing rule (`w-full h-auto`, no cap).
- `tests/client/ProjectDetailOutputPane.test.tsx`: rewrite the "stage/
  history split" describe block into a "single scrollable list, width-
  fit images" block covering the same accept/delete/inline-edit
  guarantees against the new single-list structure.
- Sprint.md's Use Cases: revise SUC-016 in place to describe the
  corrected behavior (see Use Cases below).

### Out of Scope

- Any change to `ProjectDetail/index.tsx`'s flex page shell (header /
  output / chat column), `ChatPanel`'s Markdown rendering or auto-scroll
  (Sprint 008, SUC-017) — unaffected and untouched.
- Any change to the accept/delete/inline-edit logic, the postcard editor
  state, the overlay/QR rendering, or any server-side/API contract.
- Thumbnails, lazy loading, or virtualization of the iteration list —
  not requested, out of scope.

## Test Strategy

Unit/component tests in `tests/client/ProjectDetailOutputPane.test.tsx`
(Vitest + Testing Library), covering: the single-list structure (no
stage/history testids), every image carrying `w-full h-auto` and no
`max-h`/`max-w` cap class, ordering (newest-first, unchanged), and that
accept/delete/inline-edit behavior is unaffected regardless of an
iteration's position in the list. Any integration/full-walkthrough test
that asserted the stage/history testids or fixed-cap classes must be
checked and updated to match the single-list markup — verified during
ticket execution, since no such assertions were found outside this one
test file during sprint planning. No server-side or E2E/browser test
changes expected — this is a pure client-rendering change with no API
contract impact.

## Architecture

**Small — corrective UI revision.** This sprint reverts one internal
rendering rule inside a single existing component (`OutputPane`'s row/
image sizing); it introduces no new component, no data-model or API
change, and no cross-module impact. Applying the 7-step methodology at
light weight below (steps folded together where a full sprint would
give each its own subsection), because the shape of the change is a
one-file, one-decision revision, not a new subsystem — full weight would
manufacture detail this change doesn't have. It explicitly revises
Sprint 008's `OutputPane` module boundary and SUC-016 (see Use Cases).

### Architecture Overview

**Problem / responsibilities (Steps 1-2)**: Sprint 008 gave `OutputPane`
two internally-differentiated sub-regions — a non-scrolling "stage" (the
single newest iteration, height-fit via `max-h-full max-w-full
object-contain` inside a `flex-1 min-h-0` parent) and a separately
scrollable "history" strip (everything else, flat `800×800`-capped). The
stakeholder has corrected that split: it made the newest iteration too
small on typical screens and introduced a visual/behavioral asymmetry
between "the newest" and "everything else" that wasn't wanted. The one
responsibility this sprint changes is **how `OutputPane` sizes and lays
out iteration rows** — nothing about *what* data it reads, *how* accept/
delete/inline-edit work, or the page-level flex shell around it changes.

**Module (Step 3)**: `OutputPane` (`client/src/pages/ProjectDetail/
OutputPane.tsx`) remains the sole module affected. Its purpose reverts
to one sentence with no "and": *display the active stream's iterations
as one scrollable, width-fit list.* Boundary: the `stage`/history
internal split introduced in Sprint 008 is removed; `renderIterationRow`
loses its `stage: boolean` parameter (one render path, not two);
`IterationImage` loses its `fitToSpace` prop (one sizing class,
`w-full h-auto`, not a stage/history branch). Serves: the corrected
SUC-016 below, and all pre-existing `OutputPane` use cases (accept/
delete/inline edit) unchanged — same as Sprint 008's own module entry
for this component.

**Diagram (Step 4)**: no component/module diagram is warranted — the
component graph Sprint 008 documented (`index.tsx` → `OutputPane` +
`ChatPanel`, both flex-column siblings) is unchanged; this sprint alters
nothing about which modules exist or how they connect, only `OutputPane`'s
internal row-rendering rule. No ERD (no data-model change) and no
dependency-graph diagram (no dependency change) apply, per the same
"if applicable" guidance the sprint.md template itself states.

**What changed / why / impact (Step 5)**: *What changed* —
`streamIterations` renders as one `overflow-y-auto` list (was: a
non-scrolling stage region plus a separate scrollable history region);
every row's image uses `w-full h-auto object-contain`-free sizing keyed
to container width (was: two different caps — `max-h-full max-w-full
object-contain` for the stage, flat `max-h-[800px] max-w-[800px]` for
history). *Why* — direct stakeholder correction
(`clasi/issues/iterations-single-scroll-fit-width.md`): the height-fit
stage under-uses available width and the split itself added complexity
the stakeholder didn't want. *Impact on existing components* — Sprint
008's flex page shell (`ProjectDetail/index.tsx`) is unaffected; the
chat panel remains a flex sibling, not reverting to the pre-Sprint-008
absolute overlay (the issue explicitly asks to keep that fix).
`PostcardFaceEditor`/`PostcardOverlay`/`usePostcardEditorState` are
unaffected — the accepted-row inline editor keeps rendering wherever the
accepted iteration currently sits in the (now single) list, with no
change to its own props or behavior, matching Sprint 008's own
stated impact-analysis pattern for this same component.

### Design Rationale

**Decision: one list, width-fit sizing — not a taller stage or a
configurable split.**
- **Context**: the stakeholder's correction is explicit and literal
  ("remove the stage/history split entirely... ONE scrollable section...
  each image scaled to the container's width") — this is not an
  ambiguous requirement needing alternatives weighed from scratch; it is
  a direct reversal of Sprint 008's own design choice.
- **Alternatives considered**: (a) keep the stage/history split but make
  the stage taller or user-resizable — rejected, contradicts the
  stakeholder's explicit "remove the split entirely"; (b) keep one list
  but retain a height cap tied to viewport size — rejected, the issue
  explicitly calls for width as "the only constraint" and removal of the
  800px cap; (c) one scrollable list, each image `w-full h-auto`, no
  height cap — matches the issue's acceptance criteria exactly.
- **Why this choice**: (c) is the literal, unambiguous ask; Sprint 008's
  own "Open Questions" already flagged this exact history-vs-stage
  sizing tension as something a future sprint might revisit — this
  sprint is that revisit, with a stakeholder answer now in hand.
- **Consequences**: `OutputPane`'s internal stage/history sub-boundary
  (Sprint 008) is removed — one less internal seam, simpler component.
  A very tall stream of many large iterations produces a long vertical
  scroll (accepted tradeoff — the issue asks for exactly this: "posters
  render as large as the pane allows and the user scrolls vertically to
  see more"). No change to the accept/delete/inline-edit logic paths.

### Migration Concerns

None — client-only rendering change inside one existing component; no
data migration, no API/DTO contract change, no backward-compatibility
concern. A normal client rebuild picks it up. No deployment-sequencing
risk: this sprint has exactly one ticket touching exactly one source
file plus its test file.

### Architecture Self-Review

Run per the `architecture-review` skill's five categories, against
Sprint 008's `sprint.md` Architecture section as the baseline this
document revises.

**Consistency**: The Architecture Overview's "what changed" (one render
path replaces the stage/history branch in `renderIterationRow`, one
sizing class replaces `fitToSpace`'s branch in `IterationImage`) matches
the Solution section, the Design Rationale, and the revised SUC-016
exactly — all four describe the same single change (remove the
stage/history split; width-fit sizing, no cap). No section asserts a
page-shell or data-model change contradicted elsewhere; Migration
Concerns' "None" is consistent with the Overview's explicit statement
that the flex page shell is unaffected. PASS.

**Codebase Alignment**: Verified against the actual current file,
`client/src/pages/ProjectDetail/OutputPane.tsx` (read in full during
planning) — confirmed it currently defines `stageIteration`/
`historyIterations` (destructured from `streamIterations`), a
`renderIterationRow(iteration, stage: boolean)` two-branch render
function, an `iteration-stage`/`iteration-history` testid pair, and
`IterationImage`'s `fitToSpace` prop switching between
`max-h-full max-w-full object-contain` and the flat
`max-h-[800px] max-w-[800px]` — exactly the structure this document
proposes to collapse. `tests/client/ProjectDetailOutputPane.test.tsx`
confirmed to contain a `describe('OutputPane -- stage/history split
(sprint 008 ticket 001)', ...)` block asserting those same testids and
CSS classes, which the sprint's In Scope section correctly flags for
rewrite. No drift between documented and actual current-state code.
PASS.

**Design Quality**: *Cohesion* — `OutputPane`'s purpose sentence ("display
the active stream's iterations as one scrollable, width-fit list")
passes the no-"and" test, same as Sprint 008's own module entry.
*Coupling* — no dependency change; `OutputPane` still depends only on
`usePostcardEditorState`'s state shape, `PostcardOverlay`, and
`PostcardFaceEditor`, unchanged. *Boundaries* — removing the stage/
history internal sub-boundary simplifies the component's boundary, it
does not blur it. *Dependency direction* — unaffected, no change to
which layer depends on which. PASS.

**Anti-Pattern Detection**: No god component (this remains the same
single-purpose display component Sprint 008 left it as, now simpler).
No shotgun surgery (one file's render logic, one test file — no other
component reads `fitToSpace`, `iteration-stage`, or `iteration-history`
outside this pair, confirmed by the codebase-alignment check above). No
feature envy, no circular dependency, no leaky abstraction. No
speculative generality — the change removes machinery, it adds none.
PASS.

**Risks**: No data migration, no API contract change, no security
implication. Sole risk is test coverage: the "stage/history split"
describe block's several tests (fit-to-space CSS assertions, stage vs.
history accept/delete checks) must be replaced with equivalent coverage
against the new single-list structure so no regression in accept/
delete/inline-edit-position independence goes unverified — flagged in
this sprint's Test Strategy and the ticket's acceptance criteria, not
left implicit. No deployment-sequencing risk (single ticket, single file
pair).

### Verdict: **APPROVE**

No structural issues (no circular dependencies, no god components, no
inconsistency between the Architecture Overview and the document body).
This is a small, contained reversal of one internal rendering decision
in one existing component, explicitly requested by the stakeholder in
plain terms — proceeding directly to ticketing.

## Use Cases

This sprint revises Sprint 008's SUC-016 in place (per the
architecture-authoring skill's in-place revision convention for a
corrective sprint) rather than adding a new SUC — the actor,
preconditions, and postconditions are the same use case; only the main
flow and acceptance criteria change to reflect the corrected behavior.
SUC-017 (Sprint 008, chat Markdown/auto-scroll) is untouched and not
repeated here.

### SUC-016: View all iterations of the active face, each scaled to the pane's width
Parent: UC (iteration review / postcard generation flow)

**Revision note**: this SUC previously read "View the newest iteration
fit to the available screen space" (Sprint 008) — a non-scrolling
"stage" holding only the newest iteration, height-fit to the space
between the header and chat panel, with older iterations in a separate
scrollable "history" strip capped at 800×800. Per stakeholder correction
(`clasi/issues/iterations-single-scroll-fit-width.md`, 2026-07-18), that
split is removed. The use case now covers ALL iterations of the active
stream, uniformly, in one scrollable section.

- **Actor**: Stakeholder/user reviewing generated iterations.
- **Preconditions**: A project is open with at least one iteration in
  the active stream (front or back).
- **Main Flow**:
  1. User generates a new iteration (or switches `activeTab`, or simply
     has the page open).
  2. All iterations of the active stream render in a single scrollable
     section, newest first (unchanged ordering rule).
  3. Each iteration's image scales to the full width of that section
     (`w-full`, `h-auto`), preserving aspect ratio, with no fixed pixel
     cap of any kind.
  4. User scrolls vertically within the section to see other
     iterations of the same stream.
  5. User resizes the browser window; every visible image rescales with
     the section's width automatically.
- **Postconditions**: Every iteration of the active stream is reachable
  by scrolling one list; each renders as large as the pane's width
  allows, aspect preserved, never cropped or distorted.
- **Acceptance Criteria**:
  - [ ] All iterations of the active face render in one scrollable
        section — no separate stage/history sub-regions.
  - [ ] Every iteration image spans the full available width of the
        pane; aspect ratio preserved, never cropped or distorted.
  - [ ] No fixed pixel cap (neither the old 800px cap nor a
        fit-to-height stage rule) constrains any image's size — pane
        width is the only constraint.
  - [ ] Resizing the browser window rescales every visible image with
        the pane's width, without a page reload.
  - [ ] Accept/delete/inline-edit behavior is unchanged for every row
        regardless of its position in the list.

## GitHub Issues

(GitHub issues linked to this sprint's tickets. Format: `owner/repo#N`.)

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [ ] Sprint planning document is complete (sprint.md, including its
      Architecture and Use Cases sections)
- [ ] Architecture review passed (or skipped, for changes with no
      architectural impact)
- [ ] Stakeholder has approved the sprint plan

## Tickets

| # | Title | Depends On |
|---|-------|------------|
| 001 | Collapse OutputPane's stage/history split into one width-fit scrollable list | — |

Tickets execute serially in the order listed.

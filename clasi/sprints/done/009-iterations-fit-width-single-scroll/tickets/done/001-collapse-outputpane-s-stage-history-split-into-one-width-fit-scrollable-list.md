---
id: '001'
title: Collapse OutputPane's stage/history split into one width-fit scrollable list
status: done
use-cases:
- SUC-016
depends-on: []
github-issue: ''
issue: iterations-single-scroll-fit-width.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Collapse OutputPane's stage/history split into one width-fit scrollable list

## Description

Sprint 008 split `OutputPane`'s single scrolling iteration stream into a
non-scrolling "stage" (only the newest iteration, height-fit to the flex
space between the header and the chat panel) plus a separately
scrollable "history" strip (everything else, flat `800×800`-capped).
The stakeholder has corrected that design
(`clasi/issues/iterations-single-scroll-fit-width.md`): the height-fit
stage makes the newest poster too small to look at on typical screens,
and the split itself is unwanted. This ticket removes the split
entirely and returns `OutputPane` to ONE scrollable section containing
all iterations of the active face, each image scaled to the width of
that section (`w-full h-auto`, aspect ratio preserved, no fixed pixel
cap of any kind — neither the old flat `800×800` cap nor the stage's
`max-h-full`/`object-contain` fit-to-height rule). Sprint 008's flex
page layout (`ProjectDetail/index.tsx`'s fixed header / flex `OutputPane`
/ flex-sibling `ChatPanel`) is explicitly out of scope — only what
renders inside `OutputPane`'s own flex-1 region changes.

This is the sprint's only ticket; completing it fully addresses
`iterations-single-scroll-fit-width.md` (`completes_issue: true`).

## Acceptance Criteria

- [x] `OutputPane` renders every iteration of the active stream (`role
      === activeTab`, newest-first by `seq`, unchanged ordering) inside
      one scrollable container — no `iteration-stage`/`iteration-history`
      sub-regions, and no other stage/history split of any kind, remain
      in the component.
- [x] `renderIterationRow` has a single render path (no `stage: boolean`
      parameter/branch); `IterationImage` has a single sizing mode (no
      `fitToSpace` prop/branch).
- [x] Every iteration's image (both the read-only `IterationImage` path
      and the inline `PostcardFaceEditor` path for the accepted row)
      renders at the width of the scrollable container (`w-full`),
      height auto, aspect ratio preserved — never cropped, never
      distorted.
- [x] No image carries a fixed pixel cap class (neither
      `max-h-[800px]`/`max-w-[800px]` nor `max-h-full`/`max-w-full`
      tied to a flex-computed height) — width is the only constraint.
- [x] Resizing the browser window rescales every visible image with the
      container's width, with no reload and no JS-measurement/
      `ResizeObserver` hack required (pure CSS, matching this codebase's
      existing preference — see Sprint 008's Design Rationale on this
      point).
- [x] Accept checkbox, delete-with-confirmation, and the inline
      accepted-iteration `PostcardFaceEditor` all continue to work
      identically regardless of an iteration's position in the list
      (previously: regardless of whether it was the stage or a history
      item).
- [x] `PostcardOverlay`'s region/QR overlay continues to scale correctly
      against the new width-fit image sizing (`useMeasuredWidth` still
      measures the `<img>`'s actual rendered width).
- [x] Sprint 008's flex page layout (`ProjectDetail/index.tsx`'s header/
      `OutputPane`/`ChatPanel` flex column, chat panel as a real
      sibling) is untouched — no edits to `index.tsx`, and its existing
      tests still pass unmodified.
- [x] `tests/client/ProjectDetailOutputPane.test.tsx`'s "stage/history
      split (sprint 008 ticket 001)" describe block is rewritten into a
      "single scrollable list, width-fit images" block that: (a) asserts
      all iteration rows render inside one container with no
      stage/history testids, (b) asserts every row's image carries
      `w-full`/`h-auto` and none carries `max-h-[800px]`/`max-w-[800px]`
      or `max-h-full`/`max-w-full`, (c) re-covers the accept/delete/
      inline-edit behavior the old stage-item/history-item tests
      verified, now against rows in the single list regardless of
      position.
- [x] `iterations-single-scroll-fit-width.md`'s acceptance criteria are
      all satisfied.

## Testing

- **Existing tests to run**:
  - `tests/client/ProjectDetailOutputPane.test.tsx` (this ticket's
    primary target — the "stage/history split" describe block is
    rewritten; every other describe block in this file — stream
    filtering by `activeTab`, accepted checkbox/exclusivity, inline
    accepted-iteration editor, delete-with-confirmation — must continue
    to pass unmodified except for any selector that assumed the removed
    `iteration-stage`/`iteration-history` wrapper testids).
  - `tests/client/ProjectDetail.test.tsx` (or equivalent page-level test
    covering `ProjectDetail/index.tsx`'s flex layout) — run to confirm
    the untouched flex page shell still passes.
  - Full client test suite (`npm test` / project's client test command)
    to catch any other test file that happens to reference
    `iteration-stage`, `iteration-history`, `fitToSpace`,
    `max-h-[800px]`, or `max-w-[800px]` outside this one file (sprint
    planning found none beyond `ProjectDetailOutputPane.test.tsx`, but
    this must be re-verified against the actual current tree at
    implementation time, since planning is not a substitute for a real
    repo-wide search at execution time).
- **New tests to write** (replacing the removed "stage/history split"
  block in `tests/client/ProjectDetailOutputPane.test.tsx`):
  - All iterations of the active stream render in one container, in
    newest-first order, with no `iteration-stage`/`iteration-history`
    testids present.
  - No history strip / stage distinction when the stream has 1 vs. many
    iterations — same single-list rendering either way (replaces the
    old "no history strip when only one iteration" test, now simply
    "renders correctly with 1 iteration" since there's only one region).
  - Switching `activeTab` re-computes the single list from the newly
    filtered stream (replaces the old stage+history re-computation test).
  - Every iteration image's className contains `w-full` and `h-auto`,
    and does NOT contain `max-h-[800px]`, `max-w-[800px]`, `max-h-full`,
    or `max-w-full` (replaces the old fit-to-space-vs-800px-cap
    assertion test).
  - Accept/delete behavior is verified for at least two iterations at
    different positions in the list (previously "stage item" and
    "history item" — now just "first row" and "a later row"), confirming
    no behavior regression tied to position.
  - The inline `PostcardFaceEditor` renders correctly for the accepted
    row regardless of whether it is newest or older in the list
    (replaces the old "accepted row is the stage item" / "accepted row
    is a history item" pair).
  - The non-accepted rows' read-only overlay (`PostcardOverlay`) still
    renders the shared face regions correctly against the new width-fit
    image sizing (adapt the existing `useMeasuredWidth`/`getBoundingClientRect`
    stub-and-fire-load pattern already used elsewhere in this file).
- **Verification command**: the project's client test runner, e.g.
  `npm test -- tests/client/ProjectDetailOutputPane.test.tsx` for the
  targeted file, then the full client suite (`npm test`) before marking
  this ticket done, per this repo's `.claude/rules/source-code.md`
  gate ("Run the project's test suite after changes").

## Implementation Plan

- **Approach**: In `client/src/pages/ProjectDetail/OutputPane.tsx`,
  remove the `const [stageIteration, ...historyIterations] =
  streamIterations` destructure and render `streamIterations` directly.
  Replace the two-region JSX (`iteration-stage` div + conditional
  `iteration-history` div) with one `overflow-y-auto` container mapping
  over `streamIterations` and calling `renderIterationRow(iteration)` for
  each (drop the `stage` boolean argument and its two className
  branches — collapse to the single set of classes appropriate for a
  row in a normal scrolling list). In `IterationImage`, drop the
  `fitToSpace` prop; the `<img>`'s className becomes a single rule:
  `w-full h-auto object-contain` (no `max-h`/`max-w` at all — width is
  the only constraint, height follows via `h-auto`); the wrapping `<div>`
  simplifies to one variant (drop the `fitToSpace`-conditional wrapper
  classes). Update this file's module header comment to describe the
  reverted single-list behavior in place of the removed "Stage / history
  split (sprint 008 ticket 001)" section (do not leave stale
  documentation describing removed behavior).
- **Files to modify**:
  - `client/src/pages/ProjectDetail/OutputPane.tsx` (remove stage/history
    split; single scrollable list; width-fit image sizing; update module
    header comment).
  - `tests/client/ProjectDetailOutputPane.test.tsx` (rewrite the
    "stage/history split" describe block per the Testing section above).
- **Files to create**: none.
- **Testing plan**: see Testing section above.
- **Documentation updates**: `OutputPane.tsx`'s own module-header comment
  (in-file documentation, updated as part of the file's edit, not a
  separate doc file) is the only documentation this ticket touches — no
  `docs/architecture/` file changes (this sprint's `sprint.md` Migration
  Concerns already states no architecture-doc migration is needed;
  consolidation into `docs/architecture/` happens later, on demand, per
  the `consolidate-architecture` skill, not as part of this ticket).

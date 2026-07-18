---
id: '001'
title: Flex-layout the chat panel and split OutputPane into a fit-to-space stage +
  scrollable history
status: done
use-cases:
- SUC-016
depends-on: []
github-issue: ''
issue: iterations-fit-viewport.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Flex-layout the chat panel and split OutputPane into a fit-to-space stage + scrollable history

## Description

Generated iterations currently render larger than the space actually
available between the fixed page header and the chat box, so the
newest iteration requires scrolling to see in full
(`clasi/issues/iterations-fit-viewport.md`). Two problems compound this:

1. `ChatPanel` is positioned as an absolute overlay
   (`position: absolute; bottom: 0`) rather than a real flex sibling of
   `OutputPane` in `ProjectDetail/index.tsx`. `OutputPane` compensates
   with a hardcoded `paddingBottom: CHAT_PANEL_HEIGHT_PX` (288px)
   duplicated across both files — "the space between the header and the
   chat box" is a padding convention today, not a real CSS quantity.
2. `OutputPane`'s `IterationImage` caps every iteration (current or old)
   at a flat `max-h-[800px] max-w-[800px]`, regardless of how much
   vertical space is actually available.

Per sprint 008's Architecture section (Design Rationale, "chat panel
becomes a flex sibling" and "split OutputPane into stage + history"):
convert the chat panel into a true flex-column sibling of `OutputPane`
so the available space becomes a real, CSS-computed quantity, then split
`OutputPane` into two internal sub-regions:

- **Stage**: the single newest iteration of the active stream
  (`activeTab`, highest `seq`), rendered in a non-scrolling region sized
  to fill whatever height its flex parent gives it (`flex-1 min-h-0`),
  with the image itself using `max-h-full max-w-full w-auto h-auto
  object-contain` so it scales down to fit, preserving aspect ratio,
  never cropped.
- **History**: the remaining (older) iterations of the active stream, in
  their own independently scrollable region below the stage, preserving
  their existing accept/delete/inline-edit behavior unchanged.

This is a pure CSS-driven approach — no `ResizeObserver`, no
`getBoundingClientRect`, no JS-computed pixel heights — so it stays
correct across window resizes for free, because flexbox recomputes
layout on every resize automatically.

**Explicitly out of scope for this ticket** (per sprint.md Scope): the
inline postcard editor (`PostcardFaceEditor.tsx`, `PostcardOverlay.tsx`)
keeps its current behavior and props unchanged — it still renders
wherever the accepted iteration currently lands (stage if it's the
newest, history strip otherwise); mobile/narrow-viewport layout; any
change to `usePostcardEditorState`.

## Acceptance Criteria

- [x] `ChatPanel` renders as a normal flex-column child
      (`flex-shrink-0` at its existing fixed height) of the page's root
      flex column in `ProjectDetail/index.tsx`, not a
      `position: absolute` overlay.
- [x] `CHAT_PANEL_HEIGHT_PX` / `scrollPaddingBottomPx` padding-constant
      workaround is removed — `OutputPane` no longer takes a
      `scrollPaddingBottomPx` prop for this purpose.
- [x] `OutputPane` renders the active stream's newest iteration (highest
      `seq`) in a non-scrolling stage region that fills the flex space
      between the header and the chat panel.
- [x] The stage image scales down to fit the available space, preserving
      aspect ratio (no cropping, no distortion) — verified at typical
      desktop window sizes (e.g. 1366×768 and 1920×1080).
- [x] Resizing the browser window re-fits the stage image without a page
      reload (pure CSS reflow — no resize-event JS required to satisfy
      this).
- [x] Older iterations of the active stream render in a separate,
      independently scrollable history region below/around the stage,
      with their existing Accepted checkbox, Delete button, and
      confirm-delete behavior unchanged.
- [x] Switching `activeTab` (Front/Back) re-filters both the stage and
      the history region to the newly active stream, same as the
      existing single-list filter does today.
- [x] The accepted iteration's inline editor (`PostcardFaceEditor`)
      continues to render correctly whether the accepted row is the
      stage item or a history item, with no prop/behavior changes.
- [x] All existing `OutputPane`/`ProjectDetail` tests are updated to
      match the stage/history split and pass.

## Testing

- **Existing tests to run**: `client`'s Vitest suite, in particular any
  existing `OutputPane.test.tsx` / `ProjectDetail` integration tests
  that assert on the single-scroll-list structure, iteration
  accept/delete flows, and the inline editor rendering on the accepted
  row — update their selectors/assertions to the new stage/history
  structure rather than deleting coverage.
- **New tests to write**:
  - The newest iteration (highest `seq`) of the active stream renders in
    the stage region; all others render in the history region.
  - Switching `activeTab` re-computes both regions from the newly
    filtered stream.
  - The stage region's image element carries the fit-to-space CSS
    classes (`object-contain`, `max-h-full`/`max-w-full` or equivalent)
    rather than the old fixed `800px` cap.
  - Accept/delete/inline-edit behavior is unchanged for both a stage-
    item and a history-item iteration.
  - `ChatPanel`'s wrapping `<div>` in `ProjectDetail/index.tsx` no longer
    uses `position: absolute`/`CHAT_PANEL_HEIGHT_PX`.
- **Verification command**: `npm run test` (or the client's existing
  Vitest script) from `client/`; also run `npm run build` to confirm the
  TypeScript/Vite build stays clean after the layout refactor.

---
status: in-progress
sprint: 009
tickets:
- 009-001
---

# Iterations: one scrollable section, images scaled to its width

## Description

Stakeholder correction to sprint 008's output layout (2026-07-18): the
stage + history split is wrong. The fixed-height "stage" makes the
newest poster too small to look at.

Wanted instead:

- ALL iterations live in one scrollable section (no stage/history
  split, no separate strip).
- Each iteration image is scaled to the width of that scrollable
  section (width: 100% of the container, height auto, aspect ratio
  preserved) — so posters render as large as the pane allows and the
  user scrolls vertically to see more.
- Remove the 800×800 pixel cap; the container width is the only
  constraint.
- Keep the sprint-008 flex page layout (chat panel as a real sibling,
  no absolute-position overlay) — only the iteration display changes.

## Acceptance criteria

- OutputPane shows a single scrollable list of all iterations for the
  active face, newest first (or existing order, unchanged).
- Every iteration image spans the full available width of the pane and
  is never distorted or cropped.
- No fixed pixel cap on image size; resizing the window rescales the
  images with the pane width.

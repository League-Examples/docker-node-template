---
status: done
sprint: 008
tickets:
- 008-001
---

# Scale displayed iterations to fit the available viewport

## Description

Generated poster/flyer iterations render larger than the screen, so the
user can't see the whole image without scrolling. The output pane should
size iterations to the space actually available.

Requested behavior (stakeholder, 2026-07-18):

- Compute the vertical space available for the iteration display — the
  region between the project header (top) and the chat box (bottom) —
  from the actual viewport size, not a fixed pixel height.
- Scale the displayed iteration (preserving aspect ratio) so the newest
  iteration is fully visible within that region without scrolling.
- This should hold across window sizes and when the window is resized.

## Acceptance criteria

- A newly generated iteration is entirely visible between the header and
  the chat box with no scrolling, at typical desktop window sizes.
- Aspect ratio is preserved (no distortion); the image is scaled down to
  fit, never cropped.
- Resizing the browser window re-fits the displayed iteration.

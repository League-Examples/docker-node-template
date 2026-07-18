---
status: in-progress
sprint: '006'
tickets:
- 006-001
- 006-002
- 006-003
---

# Live progress feedback during flyer generation

## Description

Flyer generation can take a long time (especially image generation), and
during that wait the UI shows no meaningful activity. Users can't tell
whether the app is working or stuck.

The generation flow should surface a live progress line with frequent,
stage-specific status updates, for example:

- "Consulting knowledge sources…"
- "Drafting flyer content…"
- "Generating images (1 of 3)…"
- "Assembling flyer…"

Requirements:

- A spinner or animated indicator so it's clear the app is alive even
  between stage transitions.
- Updates streamed from the backend as each stage starts/completes
  (not just a static "Generating…" label), so long stages like image
  generation show visible progress.
- Where a stage has sub-steps (multiple images), report per-item
  progress.

The goal is that at no point during a long generation does the user
wonder whether the app has hung.

## Related defect: no timeout on image API calls

Diagnosis of a live "stuck" generation (2026-07-17) showed the server
waiting on an open HTTPS connection to the image API. The `fetch` calls
in `server/src/services/imaging.ts` (`generateImage`,
`classifyAndDescribe`) have no timeout or abort handling, so a stalled
upstream call hangs the whole generation indefinitely with no feedback.
The fix should add sensible timeouts (image generation legitimately
takes minutes, so generous — e.g. 5 min per call) with a clear
user-facing error on expiry, and surface per-stage elapsed time in the
progress line.

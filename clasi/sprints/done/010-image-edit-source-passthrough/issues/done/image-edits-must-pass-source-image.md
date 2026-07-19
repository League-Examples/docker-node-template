---
status: done
sprint: '010'
tickets:
- 010-001
- 010-002
---

# Image-edit requests must feed the source image into generation, not just text

## Problem

When the user references an existing image and asks to edit it ("change
this in X way"), the system generates a brand-new image from a fresh
text prompt instead of editing the referenced image. The edit is applied
to nothing — the source image is never handed to the image model.

## Root cause (diagnosed 2026-07-18)

The plumbing for edit-style generation already exists but is never fed:

- `generate_image` (server/src/agent/turn.ts) accepts
  `modelParams.referenceImages` (filesystem paths), and
  `server/src/services/imaging.ts` routes to `callOpenAiEdits` (the
  OpenAI images/edits endpoint, which takes source image bytes) whenever
  reference images are present.
- BUT the model never receives any image *path*. The PROJECT CONTEXT
  block (`buildProjectContextBlock` / `summarizeIterations`) gives the
  model only counts and accepted-seq numbers ("front: 3 (accepted: #2)"),
  not the `Iteration.imagePath` values. References are summarized by
  label only (`summarizeReferences`), not by asset path.
- The chat route (server/src/routes/chat.ts) forwards only `message` and
  `activeFace` — there is no channel telling the turn which image the
  user is referencing for an edit.

So the model has nothing to put in `modelParams.referenceImages`, and
every "edit this" request degenerates into text-to-image.

## Desired behavior

When the user asks to edit/modify an existing image, the generation call
must include that image as a reference so the OpenAI edits path runs.

**Source-image selection (stakeholder decision, 2026-07-19):**

- **Default = the last (most recent) iteration.** If the user asks to
  change something and an image already exists, edit the most recent
  iteration on the active face. "Take the last image and put it back
  in." Note: this is the newest iteration by sequence, NOT necessarily
  the `accepted` one.
- **Named iteration overrides the default.** If the user names a
  specific one ("use iteration three and then change this"), use that
  iteration as the source instead of the last one.
- **No existing image → fresh generation.** If there is no prior
  iteration to edit, fall back to plain text-to-image (no regression).

**Plumbing:**

- The turn controller resolves the chosen iteration to its real
  workspace filesystem path and passes it as
  `modelParams.referenceImages` so `imaging.ts` uses `callOpenAiEdits`,
  not `callOpenAiGenerations`.
- The model must be given enough context to make this choice: expose the
  per-iteration `imagePath` (and its user-facing number/seq) in the
  PROJECT CONTEXT block so the model can map "iteration three" to a path
  and knows the last iteration's path for the default case. Guardrail:
  the model must never ask the user for a file path (internal-ID rule,
  sprint 007) — it derives paths from context.

## Acceptance criteria

- An "edit this image" style request produces a new iteration derived
  from the referenced source image (visibly a modification of it, not an
  unrelated new image).
- The generation call for an edit includes the source image path(s) in
  `modelParams.referenceImages`, exercising `callOpenAiEdits`.
- Plain "generate a new image from scratch" requests still use
  text-to-image (no regression).

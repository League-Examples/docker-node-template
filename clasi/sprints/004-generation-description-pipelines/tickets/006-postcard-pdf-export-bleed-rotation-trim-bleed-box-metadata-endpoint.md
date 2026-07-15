---
id: '006'
title: 'Postcard PDF export: bleed, rotation, trim/bleed-box metadata, endpoint'
status: open
use-cases:
- SUC-006
depends-on:
- '005'
github-issue: ''
issue: postcard-pdf-pipeline.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Postcard PDF export: bleed, rotation, trim/bleed-box metadata, endpoint

## Description

Build the second half of the Postcard Render & PDF Service:
`server/src/services/postcardPdf.ts`, exposed via a new PDF endpoint on
`routes/postcards.ts` (ticket 005) that serves both the iterations-view
PDF button and the text editor's "Generate PDF" action per sprint.md
(one endpoint, two UI callers -- both Sprint 005's job to wire up).

Per `postcard-4x6.md` and the predecessor's `webserver.py`
(`_generate_postcard_pdf_impl`), grounded exactly:

1. For each face present (front always; back only if `back_image` is set
   in the content JSON, per ticket 005/R3), raster `postcard.html`'s
   corresponding face at the true 6x4in trim size via headless Chromium
   (`puppeteer-core`, driving Alpine's `apk`-installed `chromium` binary
   -- **not** Puppeteer's own bundled download, see
   architecture-update.md R1/Open Question 1).
2. Pad each raster by 1/8in (32px at the postcard-4x6 resolution
   convention) on every side via edge-replication (`sharp`'s `extend`
   with `extendWith: 'copy'`/edge-replicate equivalent -- matches
   `postcard-4x6.md`'s documented technique exactly).
3. Rotate each padded page 90 degrees (vendor submission requirement,
   unconditional, matching the predecessor).
4. Assemble the page(s) into one PDF via `pdf-lib`, setting real
   `/TrimBox` (6x4in) and `/BleedBox` (6.25x4.25in) metadata per page --
   not just a plain bled page with no box metadata.
5. Persist the result as `postcard.pdf` via `create_agent_page` (same
   pattern as ticket 005) **and** stream the PDF bytes directly back in
   the HTTP response (the wireframe's "PDF button... pops it up in a
   viewer window" behavior).

Crop marks: per sprint.md's explicit instruction, include if cheap
(drawing 8 short tick lines per page, offset outside the 6.25x4.25in
bleed box, via `pdf-lib`'s drawing primitives -- no new dependency
needed), otherwise record as an explicit follow-up in this ticket's own
notes/PR description rather than silently omitting them (matches the
predecessor's own documented gap in `postcard-4x6.md`).

**Spike first**: before writing the render pipeline, confirm
`puppeteer-core` + `apk add chromium` actually launches and renders
inside a container built from this repo's `node:20-alpine`-based
`Dockerfile` (Open Question 1). This is a precondition, not optional
polish -- if it fails, fall back per R1's stated seam (swap the
rasterization backend behind the same `renderPostcardPdf(html, faces) ->
pdfBytes` interface) before continuing the rest of this ticket.

## Acceptance Criteria

- [ ] **Spike checkpoint**: `puppeteer-core` launches Alpine's `apk`
      `chromium` package inside a container built from this repo's
      actual `Dockerfile` (with the `apk add chromium` line added) and
      successfully rasters a trivial HTML page. If this fails, the
      fallback path from R1 is exercised and documented before
      proceeding, rather than the ticket silently shipping a broken PDF
      path.
- [ ] A front-only postcard project's PDF has exactly one page, at the
      documented bleed-inclusive dimensions (6.25x4.25in equivalent,
      rotated), rotated 90 degrees, with `/TrimBox` = 6x4in and
      `/BleedBox` = 6.25x4.25in set on that page.
- [ ] A front-and-back postcard project's PDF has exactly two pages,
      each passing the same per-page checks above, in front-then-back
      order.
- [ ] The rendered PDF's page dimensions and bleed match a fixed
      reference value in a regression test (sprint.md Test Strategy).
- [ ] Text regions and any QR overlay from ticket 005's HTML render are
      visually present in the rasterized output (verified by pixel
      sampling or an equivalent deterministic check, not just "the PDF
      has the right page count").
- [ ] The PDF is persisted as `postcard.pdf` (`create_agent_page`) and
      also returned directly in the HTTP response body with the correct
      `Content-Type: application/pdf`.
- [ ] Crop marks are either present (drawn tick marks outside the bleed
      box) or their absence is explicitly recorded (in this ticket's PR
      description / a code comment pointing at this open item) -- not
      silently dropped.
- [ ] `npm test` passes without requiring the actual `chromium` binary
      to be present (the render step is fixture/mock-backed in CI, per
      sprint.md Test Strategy -- a real-Chromium smoke test, if written,
      is env-guarded and skipped by default).

## Implementation Plan

**Approach**: New module wrapping `puppeteer-core` (raster) + `sharp`
(bleed pad) + `pdf-lib` (assembly, box metadata, rotation is a `pdf-lib`
page transform or baked into the raster orientation -- implementer's
call on which layer rotates). Keep the render pipeline's public
interface narrow (`renderPostcardPdf(html: { front: string; back?:
string }) -> Promise<Buffer>`) so R1's fallback (a different
rasterization backend) is a swap behind this one function, not a
call-site change.

**Files to create**:
- `server/src/services/postcardPdf.ts` -- raster, pad, rotate, assemble,
  crop-marks-if-cheap.
- Test file covering the acceptance criteria above (unit tests against
  mocked/stubbed raster output for CI; a separate, env-guarded
  real-Chromium smoke test for the spike checkpoint, run manually /
  outside default `npm test`).

**Files to modify**:
- `server/src/routes/postcards.ts` (ticket 005) -- add the PDF endpoint.
- `Dockerfile` -- **flagged, not performed by this ticket's planning**;
  the programmer implementing this ticket must add `apk add chromium`
  (plus any font packages needed for text rendering fidelity) to the
  runtime stage as part of this ticket's own scope, since the feature
  doesn't work without it.

**Testing plan**: Mocked-raster unit tests for the pad/rotate/assemble/
box-metadata logic (deterministic, no real Chromium needed) covering
front-only and front+back composition. A dimension/bleed regression test
against fixed reference values. A separate, explicitly-marked
real-Chromium integration test (skipped in normal CI runs, documented as
the way to re-verify the spike checkpoint if the Alpine/Chromium
combination ever needs re-confirming).

**Documentation updates**: `postcardPdf.ts`'s header comment documents
the raster -> pad -> rotate -> assemble pipeline, cross-references
`postcard-4x6.md` as the spec source, and states the crop-marks decision
made during implementation (included or recorded as follow-up).
`Dockerfile` comment near the `apk add chromium` line noting why it's
there (mirrors the existing comment style already present near the
Python/build-tool `apk add` line for `sqlite-vec`'s native build).

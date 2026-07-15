---
id: '006'
title: 'Postcard PDF export: bleed, rotation, trim/bleed-box metadata, endpoint'
status: done
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

- [x] **Spike checkpoint**: `puppeteer-core` launches Alpine's `apk`
      `chromium` package inside a container built from this repo's
      actual `Dockerfile` (with the `apk add chromium` line added) and
      successfully rasters a trivial HTML page. If this fails, the
      fallback path from R1 is exercised and documented before
      proceeding, rather than the ticket silently shipping a broken PDF
      path.
- [x] A front-only postcard project's PDF has exactly one page, at the
      documented bleed-inclusive dimensions (6.25x4.25in equivalent,
      rotated), rotated 90 degrees, with `/TrimBox` = 6x4in and
      `/BleedBox` = 6.25x4.25in set on that page.
- [x] A front-and-back postcard project's PDF has exactly two pages,
      each passing the same per-page checks above, in front-then-back
      order.
- [x] The rendered PDF's page dimensions and bleed match a fixed
      reference value in a regression test (sprint.md Test Strategy).
- [x] Text regions and any QR overlay from ticket 005's HTML render are
      visually present in the rasterized output (verified by pixel
      sampling or an equivalent deterministic check, not just "the PDF
      has the right page count").
- [x] The PDF is persisted as `postcard.pdf` (`create_agent_page`) and
      also returned directly in the HTTP response body with the correct
      `Content-Type: application/pdf`.
- [x] Crop marks are either present (drawn tick marks outside the bleed
      box) or their absence is explicitly recorded (in this ticket's PR
      description / a code comment pointing at this open item) -- not
      silently dropped.
- [x] `npm test` passes without requiring the actual `chromium` binary
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

## Testing Notes

**Spike outcome (Open Question 1, resolved -- no fallback needed)**: built
a throwaway container from this repo's actual `Dockerfile` shape (`FROM
node:20-alpine` + `RUN apk add --no-cache chromium`) via `docker build`
against the local Docker Engine, then ran a `puppeteer-core` script inside
it that launched `/usr/bin/chromium-browser` (`apk`'s chromium package;
`/usr/bin/chromium` is an equivalent symlink) with `--no-sandbox` and
screenshotted a trivial HTML page -- succeeded (`SPIKE_OK bytes=3090`).
R1's proposed backend (`puppeteer-core` + Alpine's native `chromium`
package, `PUPPETEER_EXECUTABLE_PATH`/`executablePath` pointed at
`/usr/bin/chromium-browser`) is confirmed viable; no fallback rasterization
backend was needed. `Dockerfile`'s runtime stage now runs `apk add
--no-cache chromium ttf-freefont` (fonts for better glyph coverage) and
sets `ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`, mirroring
the existing `sqlite-vec` `apk add` comment's style/rationale.

**Pipeline built**: `server/src/services/postcardPdf.ts`'s
`renderPostcardPdf(html: { front, back? }, options?) -> Promise<Buffer>`:
(1) raster each present face via an injectable `FaceRasterizer` (default
`rasterizeWithChromium`, using `puppeteer-core` + the apk `chromium`
binary; workspace-relative `<img src>` values are rewritten to `file://`
absolute paths first, via `resolveImageSourcesForRaster` +
`resolveWorkspacePath`, since `page.setContent` has no base URL and
production has no route serving workspace files over HTTP yet) at
1536x1024px (6in x 4in @ 256dpi, matching postcard-4x6.md's "32px bleed at
this resolution" convention); (2) pad 32px/side via `sharp`'s
`extend({ extendWith: 'copy' })` (edge-replicate) to 1600x1088px; (3)
assemble via `pdf-lib`, one page per face (front-then-back), page size =
bleed-inclusive 450x306pt (6.25x4.25in), `/TrimBox` = (9, 9, 432, 288)pt
(6x4in, inset by the 9pt/0.125in bleed margin), `/BleedBox` = the full
page, `page.setRotation(degrees(90))` for the vendor rotation (a `pdf-lib`
page-rotation flag, not a pixel re-encode -- `/TrimBox`/`/BleedBox` stay
expressed in the page's own unrotated coordinate system per the PDF spec).
The raster step is injectable specifically so R1's stated fallback (a
different rasterization backend) is a drop-in swap behind
`RenderPostcardPdfOptions.rasterize`, and so `npm test` never needs a real
browser.

**Crop marks: recorded as a follow-up, not drawn.** `postcard-4x6.md`
positions crop marks *outside* the 6.25x4.25in bleed box, but this
pipeline's PDF page (`/MediaBox`) *is* exactly the bleed-inclusive size --
there is no page area outside the bleed box to draw into without
enlarging `/MediaBox` past the ticket's explicit 6.25x4.25in acceptance
criterion. Drawing marks *inside* the bleed box (the only area available)
would put visible ink inside the printed/trimmed piece, which is worse
than omitting them. This is stated explicitly in `postcardPdf.ts`'s module
header (not silently dropped) as this ticket's own follow-up: a future
ticket wanting real crop marks needs to widen the page beyond the bleed
box first.

**`create_agent_page` extended for binary content**: `postcard.pdf`'s
bytes cannot go through `create_agent_page`'s existing `fs.writeFile(path,
content, 'utf8')` write path unchanged -- forcing UTF-8 text encoding on
arbitrary binary bytes corrupts any byte outside 7-bit ASCII. Minimal,
backward-compatible fix in `server/src/agent-mcp/catalogTools.ts`:
`CreateAgentPageArgs.content` now accepts `string | Buffer`, and the write
path branches on `Buffer.isBuffer(args.content)` to skip the `'utf8'`
encoding for binary content. The MCP-exposed `create_agent_page` tool's
Zod schema is unchanged (`content: z.string()`) since MCP JSON payloads
can't carry raw binary anyway -- only the in-process call from
`postcards.ts`'s new PDF route uses the `Buffer` path.

**Endpoint**: `POST /api/postcards/:projectId/pdf` (same `requireAuth` +
`requireAdmin` gate as the PUT route). No request body -- per sprint.md
("one PDF endpoint serves both the iterations-view PDF button... and the
text editor's 'Generate PDF' action"), it reads back whichever
`postcard-content.json` the PUT route most recently persisted for the
project, re-derives isolated front/back HTML docs via
`renderPostcardHtml` (called once per present face with the other face's
image unset, so `postcardPdf.ts` gets a single-`.page` doc per call),
renders the PDF, persists it as `postcard.pdf` via `create_agent_page`,
and streams the bytes back with `Content-Type: application/pdf`. Returns
404 if no content JSON has been submitted yet; 400 if the persisted
content has no `front_image` (this ticket's "front always" assumption --
a content JSON with only `back_image` is schema-legal for the HTML
preview but has nothing for the PDF's mandatory first page).

**Tests** (`npm test`: 338 server tests / 94 client tests, exit 0 -- was
320/94 before this ticket):
- `tests/server/postcard-pdf.test.ts` (9 tests): `renderPostcardPdf`'s
  front-only/front+back page composition, `/TrimBox`/`/BleedBox`/rotation
  against fixed reference values (450x306pt page, TrimBox
  (9,9,432,288)pt, BleedBox (0,0,450,306)pt, 90-degree rotation), a spy
  proving the region/QR-bearing HTML actually reaches the rasterizer, a
  genuine pixel-sampling test of `padWithBleed`'s edge-replicate output,
  and `resolveImageSourcesForRaster`'s path-rewriting (including the
  workspace-escape-safe fallback). All raster calls use an injected fake
  `FaceRasterizer` -- no real Chromium.
- `tests/server/postcard-pdf-route.test.ts` (9 tests): the HTTP route
  end-to-end against the real Prisma test DB and a scratch
  `WORKSPACE_DIR`/`WORKSPACE_GIT_ROOT` (same pattern as
  `postcard-route.test.ts`), with `postcardPdf.ts`'s `renderPostcardPdf`
  mocked via `vi.mock` -- auth gate, no-content-yet 404, front-only vs.
  front+back HTML handed to the pipeline, the front_image-required 400,
  response `Content-Type`/body bytes, on-disk persistence, and
  regeneration-overwrites-in-place with a fresh `Iteration` row per call.
- `tests/server/postcard-pdf-chromium.test.ts` (1 test, skipped by
  default): real-browser integration test, gated behind
  `POSTCARD_PDF_CHROMIUM_TEST=1` (documented usage in the file header for
  both an Alpine container and a local macOS Chrome install). Verified
  manually against this dev machine's system Chrome
  (`PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`)
  -- passed, with real pixel sampling confirming a colored "region" block
  and a colored "qr" block both render at their expected in-page
  coordinates. This is in addition to the Docker-based spike checkpoint
  above (which only confirmed launch + a trivial-page screenshot, not the
  full HTML/CSS-positioned-region raster this module actually needs).

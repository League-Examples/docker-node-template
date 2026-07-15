---
id: '005'
title: 'Postcard content render: content JSON to HTML'
status: done
use-cases:
- SUC-005
depends-on: []
github-issue: ''
issue: postcard-pdf-pipeline.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Postcard content render: content JSON to HTML

## Description

Build the first half of the new Postcard Render & PDF Service
(architecture-update.md Step 3, the addendum eleventh module):
`server/src/services/postcardRender.ts`, plus a new, test/admin-harness-
gated API Gateway route `server/src/routes/postcards.ts` (matching
Sprint 003's `routes/chat.ts` precedent -- no client UI consumes this
yet, Sprint 005 does).

Content JSON shape mirrors the predecessor's `postcard-content.json`
exactly (verified against
`marketing/projects/Robot-Riot-Postcard/postcard-content.json`):
`front_image`/`back_image` (workspace-relative `Iteration.imagePath`
references), `front_regions`/`back_regions` (each: `name`, `label`,
`style`, `text`, `rows`, `position` `{top, left, width}` in inches,
`font` `{family, size}`), `front_extra_html`/`back_extra_html` (for QR
overlays and anything else that doesn't fit the region model).

Flow:
1. `PUT /api/postcards/:projectId` (or similar) accepts a content-JSON
   body, validates it against the shape above, and persists it as
   `projects/<id>/outputs/postcard-content.json` via the **existing**
   `create_agent_page` Workspace MCP Server tool (Sprint 003, called
   in-process, unmodified) -- this keeps the write on the one moderated
   path (D9) even though this route isn't agent-loop-triggered.
2. `GET /api/postcards/:projectId/html` (or the same PUT handler,
   implementer's call) reads the persisted content JSON back, resolves
   `front_image`/`back_image` against their `Iteration` rows, and
   renders `postcard.html`: the background image plus one
   absolutely-positioned `<div>` per region (inches -> CSS `in` units,
   1:1, no unit conversion math needed) plus any `extra_html`.
3. The rendered HTML is persisted the same way
   (`create_agent_page('postcard.html', ...)`).

Per architecture-update.md R3: which image is "front"/"back" and whether
the postcard is front-only or front+back is read directly off
`front_image`/`back_image`'s presence in the content JSON -- no new
`Iteration` columns, no "accepted" flag. `postcard-content.json` naturally
represents "current" state because `create_agent_page` overwrites the
file at that path on each call while still recording fresh `Iteration`
provenance rows.

## Acceptance Criteria

- [x] Submitting content with only `front_image` + `front_regions`
      (no `back_image`) persists `postcard-content.json` and produces an
      HTML render showing only the front face.
- [x] Submitting content with both `front_image`/`front_regions` and
      `back_image`/`back_regions` produces an HTML render with both
      faces present.
- [x] Each region's rendered position/font in the HTML matches the
      submitted `position`/`font` values from the content JSON.
- [x] A submitted `front_extra_html`/`back_extra_html` value (e.g. a QR
      `<img>` tag) appears verbatim in the corresponding face's rendered
      output.
- [x] Re-submitting content JSON for the same project overwrites the
      previous `postcard-content.json`/`postcard.html` (verified: the
      file's content changes, not a second file) while still producing a
      new `Iteration` provenance row each time (`create_agent_page`'s
      existing, unmodified behavior).
- [x] Submitting content whose `front_image`/`back_image` does not match
      any existing `Iteration.imagePath` for the project returns a clear
      validation error rather than silently rendering a broken image
      reference.
- [x] The route is not reachable without the same test/admin-harness
      gate Sprint 003's `chat.ts` uses (no unauthenticated or
      general-user access this sprint).

## Testing Notes

Implemented as planned: `server/src/services/postcardRender.ts` (Zod
content-JSON validation via `parsePostcardContent`, the
`Iteration.imagePath` cross-check via `resolvePostcardImages`, and HTML
templating via `renderPostcardHtml`) plus
`server/src/routes/postcards.ts`'s single `PUT /api/postcards/:projectId`
handler, which folds the ticket's three-step flow (validate -> persist
content JSON -> render -> persist HTML) into one request -- the
"implementer's call" the ticket flagged, since a separate `GET .../html`
step would only re-read content this handler already has validated in
memory. Auth gate is `requireAuth` + `requireAdmin`, matching
`routes/chat.ts`. Mounted in `server/src/app.ts` alongside `chatRouter`.

Content-JSON shape (front/back images, regions with
name/label/style/text/rows/position/font, front/back `extra_html`)
verified directly against the predecessor's
`marketing/projects/Robot-Riot-Postcard/postcard-content.json` and
`postcard.html`; `position` accepts `left` OR `right` (matching the
predecessor's QR-caption regions) plus an optional `height` (wireframe
rounds 4/7/8/10's "exact drawn size, clipped overflow" contract --
rendered as CSS `height` + `overflow:hidden` on that region only). Region
text-to-HTML paragraph rendering (blank-line-separated `<p>`s, single
newlines within a paragraph as `<br />`) was checked to match the
predecessor's render byte-for-byte against its own fixture text.

Tests: `tests/server/postcard-render.test.ts` (18 unit tests against the
service layer directly -- shape validation, the image cross-check with a
stub Prisma client, and HTML-template edge cases including HTML-escaping
of region text vs. verbatim `extra_html`/region `style`) and
`tests/server/postcard-route.test.ts` (12 integration tests against the
real HTTP route, Prisma test DB, and a scratch `WORKSPACE_DIR` --
front-only, front+back, region position/font fidelity, QR `extra_html`,
re-submission overwrite + fresh-`Iteration`-per-write, the bad-image-
reference 400, malformed-body 400, and the auth-gate 401/403). One
non-obvious fixture requirement: the route calls `create_agent_page`
without injecting a fake `VersioningRecorder` (matching production
wiring), so the route test also points `WORKSPACE_GIT_ROOT` at its
scratch directory (alongside `WORKSPACE_DIR`) before importing `app.ts` --
otherwise the real `WorkspaceVersioningService` singleton's
`recordChange` throws "Path escapes WORKSPACE_GIT_ROOT" for every write.
`recordChange` only queues the path (no git command runs unless
`commitTurn` is called, which nothing in this route does), so this is a
safe, git-op-free env var for the test.

`npm test`: 320 server tests / 94 client tests, exit 0.

## Implementation Plan

**Approach**: Straightforward server-side templating (no client-side
JS needed for this half) -- an HTML template function taking the parsed
content JSON + resolved image paths and producing a string. Reuse
`create_agent_page` for both persistence calls rather than writing files
directly, per D9.

**Files to create**:
- `server/src/services/postcardRender.ts` -- content-JSON validation,
  HTML template rendering.
- `server/src/routes/postcards.ts` -- the new route(s).
- Test file covering the acceptance criteria above.

**Files to modify**:
- Wherever routes are mounted (`server/src/app.ts`) -- mount the new
  `postcards.ts` router, gated the same way `chat.ts` is.

**Testing plan**: Fixture-based tests seeding `Project`/`Iteration` rows
directly via Prisma (no real image generation needed), submitting
content JSON, and asserting on the persisted files' contents (front-only,
front+back, region positioning, QR overlay, re-submission/overwrite,
and the bad-image-reference validation error).

**Documentation updates**: `postcardRender.ts`'s header comment
documents the content-JSON shape (cross-referencing the predecessor's
`postcard-content.json` as the source of truth for the shape) and R3's
front/back-via-JSON-presence design decision.

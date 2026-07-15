---
status: approved
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 004 -- Use Cases

Sprint-level use cases (SUC-NNN), each tracing to a parent use case in
`docs/design/usecases.md`. Sprint 004 builds the three content-producing
pipelines Sprint 003's Agent Runtime calls out to but doesn't itself
implement: real image generation, the vision-model asset-description
pipeline, and the postcard content-JSON -> HTML -> PDF renderer. It is
demoable end-to-end at the API level; the client UI that triggers these
by hand is Sprint 005.

---

## SUC-001: Generate an image via OpenAI direct, appended as a new iteration

Parent: UC-006 (generate and iterate images)

- **Actor**: System (Agent Runtime), via the `generate_image` tool.
- **Preconditions**: A `Project` exists and a prompt has been assembled
  (Sprint 003's turn controller). `IMAGE_MODEL`, `OPENAI_API_KEY` are
  configured.
- **Main Flow**:
  1. The turn controller dispatches a `generate_image` tool call (prompt,
     optional reference-image paths, optional size/quality params) to the
     real `ImageVisionClient` (replacing Sprint 003's stub of the same
     interface -- `turn.ts`'s call site is unchanged).
  2. The client calls OpenAI direct: `/v1/images/generations` with no
     references attached, `/v1/images/edits` when one or more reference
     images are attached, model from `IMAGE_MODEL` (`gpt-image-2`),
     quality `high`.
  3. The returned image bytes are written to
     `projects/<id>/iterations/iter-<seq>.png` in the workspace
     filesystem.
  4. The client calls `create_iteration` (Sprint 003's Workspace MCP
     Server tool, unchanged) to record a new `Iteration` row -- always an
     insert, never an update, so no prior iteration's `imagePath` is ever
     at risk.
  5. Approximate spend for the call (model + size/quality -> a static
     price estimate) is logged; no budget cap is enforced (per stakeholder
     Q&A, architecture-001 Open Question 7 remains open).
- **Postconditions**: A new `Iteration` row exists with a real
  `imagePath`; every prior iteration for the project is untouched.
- **Acceptance Criteria**:
  - [ ] A `generate_image` call with no references hits
        `/v1/images/generations` (via a recorded fixture in tests) and
        produces one new `Iteration` row with a file at the recorded
        `imagePath`.
  - [ ] A `generate_image` call with one or more reference images hits
        `/v1/images/edits` instead.
  - [ ] Two sequential `generate_image` calls on the same project produce
        two `Iteration` rows with increasing `seq`; the first row's
        `imagePath` file is unchanged after the second call (the
        never-overwritten regression test).
  - [ ] A simulated OpenAI failure/timeout surfaces an error and adds no
        new `Iteration` row; prior iterations remain intact (UC-006 E1).
  - [ ] Each successful call logs an approximate spend estimate (model,
        size/quality, no real dollar metering required).

## SUC-002: Automatic classification, description, and tags on collection commit

Parent: UC-008 (add an item to a collection -- description-generation
postcondition)

- **Actor**: System (Description & Embedding Pipeline), triggered by the
  Workspace MCP Server's `add_asset_to_collection` tool.
- **Preconditions**: `add_asset_to_collection` has created the `Asset`
  row (Sprint 003's `catalogTools.ts`, unchanged). `OPENROUTER_API`,
  `OPENROUTER_MODEL` are configured and the vision model is reachable.
- **Main Flow**:
  1. After `add_asset_to_collection` creates the `Asset` row and releases
     its directory lock, it invokes the Description & Embedding Pipeline
     with the new asset's path (outside the lock scope, so the network
     call to the vision model never blocks other writers to that
     directory).
  2. The pipeline calls the Image & Vision Service's vision path
     (OpenRouter, model from `OPENROUTER_MODEL`) with the asset image,
     asking it to classify (is it a real photograph? a logo? what
     style? is any person shown real or AI-generated?), produce a rich
     description, and produce a free-form tag list (vocabulary seeded
     pragmatically -- see architecture-update.md Step 6).
  3. The pipeline writes one `AssetDescription` row (`isPhotograph`,
     `isLogo`, `style`, `peopleReal`, `description`, `tags`) and one
     `Embedding` row (`ownerType: 'asset'`) for the asset.
  4. The pipeline calls `indexAssetDescription` (Sprint 002's
     `search.ts`, unchanged) so the description/tags are FTS5-searchable
     immediately.
- **Postconditions**: The committed asset has a non-empty
  `AssetDescription` (all four required classification fields populated)
  and a queryable `Embedding` row, within the same call that committed
  it.
- **Acceptance Criteria**:
  - [ ] Committing a test asset (any of the four intake flows, via
        `add_asset_to_collection`) produces an `AssetDescription` row
        with `isPhotograph`/`isLogo`/`style`/`peopleReal` all populated
        and a non-empty `description`.
  - [ ] The same commit produces one `Embedding` row for the asset,
        retrievable via `nearestNeighbors` (Sprint 002's `search.ts`).
  - [ ] `keywordSearch` against a token present in the generated
        `description` or `tags` returns the asset's `(ownerType: 'asset',
        ownerId)` pair.
  - [ ] `add_asset_to_collection`'s own return value and timing are
        unaffected by whether the description pipeline succeeds or fails
        -- the commit itself never blocks on or fails because of the
        vision call.

## SUC-003: Graceful degradation when the vision model is unavailable at commit time

Parent: UC-008 E4 (vision model unavailable), UC-014 E3 (asset has no
description yet)

- **Actor**: System (Description & Embedding Pipeline).
- **Preconditions**: SUC-002's synchronous path exists. The vision model
  call fails or times out for a given commit.
- **Main Flow**:
  1. `add_asset_to_collection` commits the `Asset` row as usual; the
     pipeline's vision call fails (network error, timeout, non-2xx).
  2. The pipeline catches the failure, logs it, and returns without
     writing an `AssetDescription`/`Embedding` row -- the `Asset` row
     itself is already committed and unaffected (`AssetDescription`'s
     1:1 relation to `Asset` is optional, per architecture-001's data
     model; no new "pending" column is needed -- an `Asset` with no
     `AssetDescription` row *is* the pending state).
  3. On a later access that already loads or lists the asset (e.g. a
     subsequent commit into the same collection, or a scheduled retry --
     see architecture-update.md Step 6), the pipeline is retried for any
     asset still missing an `AssetDescription` row.
  4. Once a retry succeeds, the asset gets its `AssetDescription` and
     `Embedding` rows exactly as the happy path (SUC-002), and becomes
     eligible for semantic search from that point on.
- **Postconditions**: The asset remains committed and browsable
  throughout; it becomes semantically searchable only once description
  generation eventually succeeds.
- **Acceptance Criteria**:
  - [ ] A simulated vision-model failure during commit leaves the `Asset`
        row committed with no `AssetDescription`/`Embedding` row, and
        `add_asset_to_collection`'s call still returns success.
  - [ ] The asset is findable by filename/path search (Sprint 002's
        FTS5/browse path) in the interim, per UC-014 E3.
  - [ ] A retry pass (invoked directly in tests, standing in for the
        scheduled job) against an asset with no `AssetDescription`
        succeeds when the vision model is available again, producing the
        same result as SUC-002's happy path.
  - [ ] An asset that already has an `AssetDescription` row is never
        re-processed by the retry pass.

## SUC-004: Semantic query returns pipeline-generated descriptions via both index paths

Parent: UC-014 (semantic search/filter of the library via chat)

- **Actor**: Any authenticated user (via chat, exercised here at the API
  level).
- **Preconditions**: SUC-002 has produced at least one `AssetDescription`
  + `Embedding` pair for a seeded test asset (e.g. one whose description
  mentions "robots").
- **Main Flow**:
  1. A query embedding is produced for a natural-language request (e.g.
     "assets with robots in them") via the same vision/embedding model
     path SUC-002 uses.
  2. `nearestNeighbors` (vector path) and `keywordSearch` (FTS5 path) are
     both queried.
  3. Both paths return the seeded asset among their results.
- **Postconditions**: No state changes (read-only, matching UC-002/UC-014
  postconditions).
- **Acceptance Criteria**:
  - [ ] A query semantically related to a pipeline-generated description
        (e.g. "robots") returns the matching asset via `nearestNeighbors`.
  - [ ] The same query (or its literal terms) returns the matching asset
        via `keywordSearch`.
  - [ ] An asset still in the SUC-003 pending state (no description yet)
        is excluded from both result sets until its description completes.

## SUC-005: Render postcard content JSON to HTML

Parent: UC-010 (postcard text-region editing via an agent-generated form
page -- the composited-output half of the flow)

- **Actor**: System (Postcard Render & PDF Service), invoked via a new
  API Gateway route (test/admin-harness-gated this sprint, per Sprint
  003's `chat.ts` precedent -- no client UI yet, Sprint 005).
- **Preconditions**: A postcard-type `Project` has at least one
  `Iteration` intended as a front (and optionally back) template image.
- **Main Flow**:
  1. A caller submits postcard content -- front/back iteration
     references, one or more text regions (name, label, style, exact
     text, position in inches, font), and an optional QR-overlay URL --
     matching the predecessor's `postcard-content.json` shape.
  2. The service persists this as `projects/<id>/outputs/postcard-content.json`
     via the existing `create_agent_page` Workspace MCP Server tool
     (Sprint 003, unchanged) -- locked, versioned, and recorded as an
     `Iteration` output row, exactly like any other agent-authored page.
  3. The service reads the content JSON back, resolves the referenced
     front/back `Iteration.imagePath`s, and renders `postcard.html`:
     the background image plus one absolutely-positioned `<div>` per text
     region (position/font/style from the JSON) plus any QR-overlay
     `extra_html`.
  4. `postcard.html` is persisted the same way (`create_agent_page`).
- **Postconditions**: A `postcard-content.json` and matching
  `postcard.html` exist as project outputs, addressable like any other
  `Iteration`.
- **Acceptance Criteria**:
  - [ ] Submitting content with only a front image and regions produces
        an HTML render showing only the front face.
  - [ ] Submitting content with both front and back images and regions
        produces an HTML render with both faces.
  - [ ] Text-region positions in the rendered HTML match the submitted
        inch-based positions (converted to the render's coordinate
        system) and fonts.
  - [ ] A submitted `extra_html` QR overlay (image tag pointing at a
        provided URL/asset) appears in the rendered output.

## SUC-006: Export the postcard to a print-ready PDF

Parent: UC-010 (postcard composited output, print-ready half)

- **Actor**: System (Postcard Render & PDF Service), invoked via a new
  PDF API endpoint.
- **Preconditions**: SUC-005 has produced a `postcard.html` for the
  project.
- **Main Flow**:
  1. A caller requests a PDF for the project (the same endpoint serves
     both the iterations-view PDF button and the text editor's "Generate
     PDF" action -- both just mean "render whatever is currently
     front/back-marked").
  2. The service rasters `postcard.html` at the true 6x4in trim size via
     headless Chromium, once per face present (front only, or front and
     back).
  3. Each raster is padded by 1/8in on every side via edge-replication
     (the standard print-shop bleed technique -- matches the
     predecessor's `postcard-4x6.md` spec exactly) and rotated 90 degrees
     per the print vendor's submission requirement.
  4. Each page is assembled into a PDF with real `/TrimBox` and
     `/BleedBox` metadata (6x4in trim, 6.25x4.25in bleed) so a downstream
     tool can tell trim from bleed rather than reading the whole bled
     page as the trim.
  5. The PDF is persisted as `postcard.pdf` (`create_agent_page`, same
     pattern as SUC-005) and also streamed back directly in the HTTP
     response.
- **Postconditions**: A print-ready PDF exists as a project output and is
  returned to the caller.
- **Acceptance Criteria**:
  - [ ] A front-only postcard project's PDF has exactly one page, at the
        correct bleed-inclusive dimensions, rotated 90 degrees, with
        `/TrimBox`/`/BleedBox` set to the documented values.
  - [ ] A front-and-back postcard project's PDF has exactly two pages,
        same per-page checks.
  - [ ] The rendered PDF's dimensions and bleed match fixed reference
        values (regression test, per sprint.md Test Strategy).
  - [ ] Crop marks are either included (if implementation cost proves
        low) or explicitly recorded as a follow-up in Open Questions --
        not silently dropped without a record (predecessor gap,
        sprint.md).

---

## Coverage Summary

| SUC | Parent UC(s) | Delivered by issue |
|---|---|---|
| SUC-001 | UC-006 | `image-generation-service.md` |
| SUC-002 | UC-008 | `asset-auto-description-and-semantic-filtering.md` |
| SUC-003 | UC-008 (E4), UC-014 (E3) | `asset-auto-description-and-semantic-filtering.md` |
| SUC-004 | UC-014 | `asset-auto-description-and-semantic-filtering.md` |
| SUC-005 | UC-010 | `postcard-pdf-pipeline.md` |
| SUC-006 | UC-010 | `postcard-pdf-pipeline.md` |

UC-006, UC-008, and UC-014 become mechanism-complete (API-level) by this
sprint; their user-visible surface still requires Sprint 005's UI to be
reachable by an actual user, same caveat Sprint 003's coverage summary
recorded for its own mechanism-complete-but-not-yet-UI-reachable use
cases. UC-010 becomes mechanism-complete for the composited-output half
(render + PDF); the interactive text-editor half (drag-to-draw boxes,
click-to-edit popups) is explicitly Sprint 005 scope per sprint.md's Out
of Scope. UC-005 (prompt assembly) is indirectly strengthened by SUC-002
onward (richer retrievable descriptions) but is not itself re-scoped this
sprint.

---
id: '004'
title: Generation & Description Pipelines
status: done
branch: sprint/004-generation-description-pipelines
use-cases:
- UC-006
- UC-008
- UC-010
- UC-014
issues:
- image-generation-service.md
- asset-auto-description-and-semantic-filtering.md
- postcard-pdf-pipeline.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 004: Generation & Description Pipelines

## Goals

Build the three content-producing pipelines the agent runtime (Sprint
003) calls out to but doesn't itself implement: image generation
(`gpt-image-2`, direct OpenAI), the vision-model asset-description
pipeline that powers semantic search, and the postcard content-JSON →
HTML → print-PDF renderer. This sprint is demoable end-to-end at the API
level: a scripted chat turn that generates an image iteration, a
committed asset that comes back with a real classification/description/
tags, and a postcard project that renders to a downloadable PDF — all
before the real UI exists to trigger them by hand (Sprint 005).

## Problem

Sprint 003's Agent Runtime has an `Imaging` client interface and a
`create_iteration`/`create_agent_page` tool surface, but nothing yet
calls a real image API, scores/describes anything with vision, or
renders a postcard past its chroma-key template stage. Without this
sprint, Sprint 005's UI would have nothing live to show beyond static
mock data.

## Solution

- **Image & Vision Service** (`server/src/services/imaging.ts`): stateless
  HTTP client wrapping OpenAI direct generation (`/v1/images/generations`,
  `/v1/images/edits` when references are attached), model from
  `IMAGE_MODEL` (`gpt-image-2`), and OpenRouter for vision
  evaluation/description (model from `OPENROUTER_MODEL`). Add
  `OPENROUTER_API`, `OPENROUTER_MODEL`, `IMAGE_MODEL` to the flyerbot
  dotconfig cascade (`config/{dev,prod}`), reconciling the already-present
  `OPENAI_API_KEY` rather than duplicating it. Every generation call
  lands as a new `Iteration` row via the Sprint 003 `create_iteration` MCP
  tool — prior iterations are never overwritten. Spend is logged; no caps
  enforced yet (per stakeholder Q&A, architecture-001 Open Question 7
  remains open).
- **Description & Embedding Pipeline** (`server/src/services/description.ts`):
  triggered by the Workspace MCP Server's `add_asset_to_collection` tool
  (synchronous by default; queued for retry if the vision model is
  unavailable, per UC-008 E4). Calls the Image & Vision Service's vision
  path to classify (real photograph? logo? style? real-vs-AI person?),
  produce a description, and produce tags (free-form JSON list, vocabulary
  TBD per architecture-001 Open Question 5). Writes `AssetDescription` and
  an `Embedding` row, powering both `FTS5` and vector search from Sprint
  002's indexing.
- **Postcard PDF Pipeline** (server-side render path): persist postcard
  regions as JSON (positions in inches, fonts, exact text, QR overlay
  URL — the `create_agent_page` output for the postcard case), render to
  HTML, then to a print-ready PDF with 1/8in bleed and vendor rotation
  (predecessor parity; crop marks called out as a predecessor gap worth
  closing here). One PDF endpoint serves both the iterations-view PDF
  button (marked/accepted sides only) and the text editor's "Generate
  PDF" action described in the wireframe review.

## Success Criteria

- A generation request against a live (or recorded-fixture) OpenAI call
  produces a new `Iteration` row with `imagePath` pointing to a real file
  in `workspace/projects/<slug>/iterations/`; re-running with feedback
  adds another iteration without touching the first.
- A committed test asset receives a non-empty `AssetDescription` (all four
  required fields populated) and a queryable `Embedding` row within one
  pipeline run; a simulated vision-model failure leaves the asset
  committed but flagged for retry rather than blocking the commit (UC-008
  E4).
- A semantic query against seeded + pipeline-generated descriptions
  (e.g. "assets with robots in them") returns the expected asset via both
  the vector and FTS5 paths from Sprint 002's indexing.
- A postcard project with front/back template iterations and a filled
  regions JSON renders to a PDF with correct bleed and text placement,
  matching the predecessor's `postcard.html`/`postcard.pdf` shape; QR
  overlay renders from a provided URL.
- `OPENROUTER_API`, `OPENROUTER_MODEL`, `IMAGE_MODEL` exist in
  `config/dev` and `config/prod`; no secret values appear in any
  committed file or doc.

## Scope

### In Scope

- Image & Vision Service (generation + vision evaluation/description
  client).
- Description & Embedding Pipeline (classification, description, tags,
  embedding write, retry-on-failure path).
- Postcard content JSON → HTML → PDF render pipeline (bleed, rotation).
- Dotconfig additions for image/vision config.

### Out of Scope

- The client-side postcard text editor UI (drag-to-draw boxes,
  click-to-edit popups, QR URL popup) — Sprint 005 builds the UI against
  this sprint's PDF/render endpoints.
- Brand-guardrail rubric auto-regeneration behavior (architecture-001
  Open Question 6, still unresolved — this sprint implements
  vision-evaluation scoring as a callable capability but does not wire
  automatic regeneration decisions).
- Any change to the Agent Runtime's turn/locking model (Sprint 003, only
  consumed here).

## Test Strategy

Contract/integration tests against the Image & Vision Service using
recorded fixtures for OpenAI/OpenRouter responses (no live API calls in
CI); a dedicated iteration-never-overwritten regression test. Description
pipeline tests covering the happy path and the vision-model-unavailable
retry path, asserting the asset remains committed and searchable by
filename in the interim (UC-014 E3). PDF pipeline tests comparing
rendered output dimensions/bleed against fixed reference values and
verifying front-only vs. front+back PDF composition matches which sides
are marked/accepted.

## Architecture Notes

Implements architecture-001's Description & Embedding Pipeline and Image
& Vision Service modules directly; the postcard PDF pipeline realizes the
chroma-key-plus-sidecar-JSON mechanism described in architecture-001's
Agent Runtime Details ("Agent-authored pages") for the postcard case
specifically. No architectural changes proposed — see
`architecture-update.md` (detail planning) for any addendum needed once
vision-model fixture behavior is confirmed against real API responses.

## GitHub Issues

None yet — this sprint's issues are CLASI-internal (`clasi/issues/`), not
yet mirrored to GitHub.

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [x] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [x] Architecture review passed (verdict: APPROVE WITH CHANGES)
- [x] Stakeholder has approved the sprint plan (roadmap approved 2026-07-14;
      stakeholder said carry on 2026-07-15 -- team-lead-authorized gate
      per this dispatch)

## Tickets

Tickets execute serially in the order listed.

| # | Title | Use Cases | Depends On |
|---|---|---|---|
| 001 | Image & Vision Service client (imaging.ts) | SUC-001, SUC-002, SUC-004 | -- |
| 002 | Wire generate_image tool and real ImageVisionClient into the turn loop | SUC-001 | 001 |
| 003 | Description & Embedding Pipeline (happy path) | SUC-002 | 001 |
| 004 | Vision-unavailable retry/queue and semantic search verification | SUC-003, SUC-004 | 003 |
| 005 | Postcard content render: content JSON to HTML | SUC-005 | -- |
| 006 | Postcard PDF export: bleed, rotation, trim/bleed-box metadata, endpoint | SUC-006 | 005 |

Two independent foundation tracks (001-002-003-004 for generation/
description; 005-006 for postcard rendering) share no sprint-internal
dependency on each other -- both trace to the same architecture-update.md
addendum but touch disjoint code. Listed in this order (generation track
first) because ticket 001 is the larger, riskier foundation piece (real
external API integration) worth surfacing early; ticket 006 carries this
sprint's other major implementation risk (Alpine + `puppeteer-core`
viability, architecture-update.md Open Question 1) and is deliberately
sequenced last so its spike, if it requires a fallback, doesn't block
the generation/description tickets from proceeding in parallel execution
if the team-lead chooses to interleave them.

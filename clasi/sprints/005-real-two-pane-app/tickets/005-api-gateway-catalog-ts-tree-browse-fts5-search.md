---
id: '005'
title: 'API Gateway: catalog.ts (tree browse + FTS5 search)'
status: open
use-cases:
- SUC-002
- SUC-010
- SUC-011
depends-on: []
github-issue: ''
issue: real-two-pane-app.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# API Gateway: catalog.ts (tree browse + FTS5 search)

## Description

Add `server/src/routes/catalog.ts`, the read-only route module
architecture-001 always named as part of the API Gateway module (Module
2's original design lists `catalog.ts`/`projects.ts`/`chat.ts` as
siblings; only `chat.ts` has existed until now). Two endpoints:

- **`GET /api/catalog/tree`** — the real category browser backing the
  library drawer (SUC-002) and the Library view on the project-list page
  (SUC-010/SUC-011): `WorkspaceDirectory`/`Collection`/`KnowledgeEntry`/
  `Asset` rows, read directly via Prisma (unmoderated, D9 — this is a
  read path, not a write; never goes through the Workspace MCP Server).
- **`GET /api/catalog/search?q=`** — the literal filter-bar path (UC-014
  secondary path), calling `server/src/services/search.ts`'s existing
  `keywordSearch` (the same FTS5 function `turn.ts`'s
  `retrieveKnowledge` already uses server-side for chat, now exposed for
  the client's own filter bar).

Both endpoints inline full item detail (`description`/`bodyText`/`tags`)
in their responses rather than requiring a separate per-item detail
endpoint — see architecture-update.md Design Rationale **R6** for why
(catalog content sizes are modest; no wireframe has a "preview then drill
in" two-step flow that would benefit from deferring the fetch). Responses
should include each item's workspace-relative `path` so the client can
render its image via ticket 004's `GET /api/files/*`.

`requireAuth` only — no `requireAdmin`, matching every other new route in
this sprint.

## Acceptance Criteria

- [ ] `GET /api/catalog/tree` returns real `WorkspaceDirectory`/
      `Collection`/`KnowledgeEntry`/`Asset` data grouped in a shape the
      drawer's four categories (assets, examples, styles, projects) can
      render directly.
- [ ] `GET /api/catalog/search?q=...` returns FTS5-matched results via
      `keywordSearch`, narrowing correctly on a multi-word query.
  - [ ] An empty-catalog / no-results state returns an empty array, not
      an error (UC-002 E1).
- [ ] Every returned asset/knowledge-entry item includes its
      workspace-relative `path` and enough text (`description`/
      `bodyText`/`tags`) for the drawer to render a preview without a
      second request.
- [ ] Both endpoints are `requireAuth`-only (verify with an
      authenticated-non-admin-user test, not just an admin).
- [ ] Neither endpoint performs any write — verify no `Lock`
      acquisition, no `versioning.recordChange` call, in either handler.

## Implementation Plan

**Approach**: Two small read-only handlers, direct Prisma reads for the
tree endpoint, `keywordSearch` passthrough for search. No write path, no
Workspace MCP Server involvement (D9 asymmetry — reads bypass it by
design, matching every other read path in the codebase).

**Files to create**:
- `server/src/routes/catalog.ts`.
- Test file covering the acceptance criteria above.

**Files to modify**:
- `server/src/app.ts` — mount `catalogRouter` under `/api`.

**Testing plan**: Fixture-seeded `WorkspaceDirectory`/`Collection`/
`KnowledgeEntry`/`Asset`/`AssetDescription` rows (matching the seeding
convention Sprint 002/004's own tests already use), asserting both
endpoints' shapes and the empty-state case. An explicit non-admin
`requireAuth` test (this sprint's auth-gate posture, distinct from
`chat.ts`/`postcards.ts`'s prior `requireAdmin` gate).

**Documentation updates**: None beyond the route's own doc comment
explaining the D9 read/write asymmetry it relies on.

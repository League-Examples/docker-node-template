---
id: '002'
title: 'Workspace MCP Server: reference, iteration-state, and catalog-search tools'
status: in-progress
use-cases:
- SUC-003
- SUC-007
- SUC-011
- SUC-015
depends-on:
- '001'
github-issue: ''
issue: real-two-pane-app.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Workspace MCP Server: reference, iteration-state, and catalog-search tools

## Description

Add four new exported functions to `server/src/agent-mcp/catalogTools.ts`
(the existing file — do not create a new module), registered on
`workspaceMcpServer` alongside the existing seven tools, and added to
`server/src/agent/turn.ts`'s `DEFAULT_TOOL_HANDLERS`/
`WORKSPACE_TOOL_DEFINITIONS` so the agent loop can call them too. Follow
the exact conventions the seven existing tools already establish (see
`catalogTools.ts`'s module header and `createProject`/`createIteration`
for the pattern: `CatalogToolsOptions` bag, `acquireLock`/`releaseLock`
around the write, `versioning.recordChange` after).

1. **`add_reference(projectId, assetId, role)`** — creates a `Reference`
   row. The `Reference` model has existed in `server/prisma/
   schema.prisma` since architecture-001 but nothing has ever written to
   it (confirmed by grep — zero writers outside generated Prisma client
   code). Lock/version pattern: same as `createIteration` (lock
   `projects/<id>`, no optimistic-lock version needed since `Reference`
   has none).
2. **`remove_reference(referenceId)`** — deletes one `Reference` row.
3. **`set_iteration_state(iterationId, { accepted?, role? })`** — updates
   `Iteration.accepted`/`Iteration.role` (ticket 001's new columns)
   *inside one transaction* that also clears the same flag from
   whichever other `Iteration` in the same project previously held it —
   this is the one enforcement point for the exclusivity rules from
   stakeholder rounds 6-7 ("checking Accepted on one iteration unchecks
   any other"; "setting Front on one iteration clears Front from
   whichever other iteration held it"). See architecture-update.md R4:
   this is an application-level invariant, not a DB constraint — get the
   transaction right here since nothing else enforces it.
4. **`search_catalog(query, k?)`** — **read-only, no lock** (same pattern
   as the existing `read_file`/`stat` tools in `fsTools.ts`, not the
   write tools above). Embeds `query` via `server/src/services/
   description.ts`'s existing, already-implemented `embedText(text) ->
   Float32Array` (do **not** add a new embedding-API call — see
   architecture-update.md R8 for why: `embedText` is the only function
   that has ever produced an `Embedding` row, so query-time text must use
   the same function to stay in the same embedding space as stored
   vectors). Run `server/src/services/search.ts`'s existing
   `nearestNeighbors(vector, k)` against the embedded query, and
   `keywordSearch(query, { limit })` against the raw query text; merge/
   dedupe the two result sets by `(ownerType, ownerId)`. Return matches
   with enough denormalized fields (asset/knowledge-entry path, label)
   for the client to render/highlight them without a second lookup.

No change to the seven existing tools' signatures or behavior.

## Acceptance Criteria

- [x] `add_reference` creates a `Reference` row scoped to a project;
      calling it with a `role` of `'style' | 'composition' | 'template'`
      (per the existing `Reference.role` field's documented values)
      persists correctly.
- [x] `remove_reference` deletes exactly the targeted row.
- [x] `set_iteration_state({ accepted: true })` on one iteration clears
      `accepted` on any other iteration in the *same* project; iterations
      in a *different* project are unaffected.
- [x] `set_iteration_state({ role: 'front' })` on one iteration clears
      `role: 'front'` from whichever other iteration in the same project
      previously held it; same for `'back'`. Setting front does not
      disturb whichever iteration currently holds `'back'` (and vice
      versa) — the two roles are independently exclusive.
- [x] `search_catalog('robots')` (or similar) against fixture
      `AssetDescription`/`Embedding` rows returns matches, exercising
      both the `nearestNeighbors`/`embedText` path and the
      `keywordSearch` path, with results merged/deduped.
- [x] `search_catalog` makes zero real network calls in tests — it calls
      only `embedText`/`nearestNeighbors`/`keywordSearch`, all local.
- [x] All four tools registered on `workspaceMcpServer` (`server.tool(...)`
      calls) and present in `turn.ts`'s `DEFAULT_TOOL_HANDLERS`/
      `WORKSPACE_TOOL_DEFINITIONS` so a scripted/mock-adapter turn
      (Sprint 003's SUC-003 test pattern) can call each of them.
- [x] The seven existing tools' tests still pass unmodified.

## Implementation Plan

**Approach**: Four small additions to the existing `catalogTools.ts` +
`turn.ts` files, each modeled directly on an existing sibling function
(`add_reference`/`remove_reference` on `createIteration`'s lock pattern;
`set_iteration_state` similarly, but wrapped in a `prisma.$transaction`
for the exclusivity clear-and-set; `search_catalog` on `read_file`/`stat`'s
no-lock, read-only pattern). No new files, no new module.

**Files to modify**:
- `server/src/agent-mcp/catalogTools.ts` — add `addReference`,
  `removeReference`, `setIterationState`, `searchCatalog`, plus their
  `registerCatalogTools` entries.
- `server/src/agent/turn.ts` — add four entries to
  `DEFAULT_TOOL_HANDLERS` and four to `WORKSPACE_TOOL_DEFINITIONS`.

**Testing plan**: Follow `tests/server/*.test.ts`'s existing
`catalogTools`/`agent-turn` test-file conventions. Unit tests per new
function (success path, exclusivity behavior for
`set_iteration_state`, not-found errors). One scripted end-to-end
`runTurn` test per tool (Sprint 003's SUC-003 pattern) proving the agent
can call each through the dispatch table. `search_catalog`'s test seeds
fixture `Embedding`/`AssetDescription`/`KnowledgeEntry` rows directly
(no network, no real vision/embedding API), matching every other Sprint
004 test's fixture-based convention.

**Documentation updates**: None beyond code comments matching the
existing module's documentation density (each new tool gets a doc
comment explaining its lock/exclusivity behavior, per the existing
functions' style).

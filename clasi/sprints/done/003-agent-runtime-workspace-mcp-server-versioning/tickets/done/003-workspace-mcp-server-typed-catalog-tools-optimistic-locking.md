---
id: '003'
title: 'Workspace MCP Server: typed catalog tools + optimistic locking'
status: done
use-cases:
- SUC-002
depends-on:
- '002'
github-issue: ''
issue: workspace-mcp-server.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Workspace MCP Server: typed catalog tools + optimistic locking

## Description

Add the catalog tool family (`create_knowledge_entry`,
`propose_correction`, `resolve_correction`, `add_asset_to_collection`,
`create_project`, `create_iteration`, `create_agent_page`) to the same
`workspaceMcpServer` instance ticket 002 built, reusing its lock helper.
Enforces optimistic-lock rejection (reject-and-surface, per
`architecture-update.md` R3) on `Project`/`KnowledgeEntry` writes, and the
propose/resolve-correction split (architecture-001 D3) that keeps
`bodyText` untouched until a correction is explicitly accepted.

## Acceptance Criteria

- [x] `create_knowledge_entry` creates a `KnowledgeEntry` row (any
      `kind`) under a given `WorkspaceDirectory`.
- [x] `propose_correction` creates a `KnowledgeCorrection` row (`status:
      pending`) holding a unified diff against the target entry's
      current `bodyText`; the entry's `bodyText` and `version` are
      unchanged by this call.
- [x] `resolve_correction` (accept path) applies the correction's diff to
      `bodyText`, bumps `KnowledgeEntry.version` by exactly 1, and sets
      the correction's `status` to `accepted`, `resolvedAt` to now.
- [x] `resolve_correction` (reject path) sets `status` to `rejected`,
      `resolvedAt` to now, and changes nothing else (`bodyText`/`version`
      untouched).
- [x] `add_asset_to_collection` creates an `Asset` row under a named
      `Collection` (document whether the tool creates a missing
      `Collection` or errors -- implementer's call); no vision-model
      description call is made this sprint (`AssetDescription` may
      remain null -- Sprint 004 scope).
- [x] `create_project` creates a `Project` row (optionally with
      `parentProjectId` for a subproject).
- [x] `create_iteration` creates an `Iteration` row under a `Project`,
      never overwriting an existing iteration's `imagePath` (insert-only,
      matching Sprint 002's SUC-001 guarantee).
- [x] `create_agent_page` writes a page-definition file (markup/schema +
      optional small script) to `projects/<slug>/outputs/` via ticket
      002's `fsTools`/path-containment/lock mechanics, plus a minimal
      output-metadata record (folded into `Iteration` or equivalent) --
      generic mechanism only, no postcard-specific content-generation
      logic (Sprint 004/005).
- [x] `create_knowledge_entry`-family updates and `create_project`-family
      updates that include a `version` argument are rejected (with a
      surfaced, catchable conflict, not a silent overwrite) when the
      row's current `version` no longer matches the supplied value.
- [x] All catalog writes acquire and release a `Lock` row before/after,
      using ticket 002's shared `locks.ts` helper (`resourceKey`
      convention consistent with R5, e.g. the entry's/collection's
      `WorkspaceDirectory` path).
- [x] Every successful catalog write triggers ticket 001's Versioning
      Service commit path, same as ticket 002's fs tools.

## Implementation Plan

### Approach

`catalogTools.ts` uses the Prisma client directly (via
`services/prisma.ts`) rather than going through `ServiceRegistry` --
`architecture-update.md`'s Impact on Existing Components already notes
this is a deliberate difference, since these tools are MCP-tool-shaped,
not request-scoped CRUD services. Optimistic-lock checks are a `WHERE id
= ? AND version = ?` conditional update (Prisma's `updateMany` with a
version-matched where-clause) rather than a separate read-then-compare
step, to avoid a check-then-act race -- a zero-row result means the
version didn't match, which the tool call turns into the surfaced
conflict error. `propose_correction`/`resolve_correction` are the only
two tools touching `KnowledgeCorrection`; `resolve_correction`'s accept
path applies the diff using a small unified-diff-apply utility (a minimal
dependency or a small hand-rolled apply function is acceptable --
document the choice).

### Files to Create/Modify

- `server/src/agent-mcp/catalogTools.ts` (new)
- `server/src/agent-mcp/server.ts` (modify -- register the new tool
  family alongside ticket 002's fs tools)
- `server/package.json` (modify, only if a diff-apply dependency is
  added)

### Testing Plan

- **Existing tests to run**: `npm test`, especially
  `tests/server/prisma-domain-models.test.ts`.
- **New tests to write** (`tests/server/agent-mcp-catalog-tools.test.ts`):
  - `propose_correction` followed by a read shows unchanged
    `bodyText`/`version`.
  - `resolve_correction` accept applies the diff and bumps `version` by
    1; reject changes only `status`/`resolvedAt`.
  - A `create_knowledge_entry`-family or `create_project`-family write
    with a stale `version` argument is rejected, not applied.
  - `add_asset_to_collection` creates the `Asset` row; the documented
    duplicate-handling behavior is exercised.
  - `create_iteration` twice against the same project never overwrites
    the first iteration's `imagePath`.
  - `create_agent_page` writes the expected output file under
    `projects/<slug>/outputs/` via ticket 002's containment guarantees
    (reused, not re-derived).
  - Every write in this suite acquires/releases a `Lock` row.
- **Verification command**: `npm test`

### Documentation Updates

None beyond this ticket.

## Testing

- **Existing tests to run**: `npm test` -- green (223 server / 94 client
  before this ticket's own new file; 224 server / 94 client after, plus
  the 25 new catalog-tools tests below -- see totals note).
- **New tests to write**: `tests/server/agent-mcp-catalog-tools.test.ts`
  -- 25 tests, all passing, covering: tool-surface registration (both
  families on `createWorkspaceMcpServer()`, and `registerCatalogTools`
  in isolation); `create_knowledge_entry` create + update (id/version)
  + bodyText-rejected-on-update + stale-version rejection +
  lock-acquired/released + lock-contention rejection;
  `create_project` create (incl. subproject via `parentProjectId`) +
  update (id/version) + stale-version rejection + lock-acquired/released;
  `propose_correction` (unchanged `bodyText`/`version`) and
  `resolve_correction` accept (diff applied, version+1) / reject
  (status/resolvedAt only) / already-resolved rejection +
  lock-acquired/released; `add_asset_to_collection` (creates a missing
  `Collection`, reuses an existing one, lock-acquired/released);
  `create_iteration` (auto-incrementing `seq`, prior `imagePath` never
  overwritten, lock-acquired/released); `create_agent_page` (file
  written under `projects/<id>/outputs/`, `Iteration` metadata record,
  path-containment rejection reusing `resolveWorkspacePath`,
  lock-acquired/released).
- Also updated `tests/server/agent-mcp-fs-tools.test.ts`'s tool-surface
  test: it previously asserted `createWorkspaceMcpServer()` registers
  *only* the four fs tools, which this ticket's catalog-tool
  registration on the same instance necessarily changes. Split into (a)
  `registerFsTools` asserted in isolation on a fresh `McpServer` (still
  exactly the four fs tools, no shell/exec tool), and (b)
  `createWorkspaceMcpServer()` asserted to contain the fs tools plus no
  shell/exec tool name, with the full 11-tool list now asserted by the
  new catalog-tools test file instead.
- **Verification command**: `npm test` -- final run: 224 server tests / 94
  client tests, all passing (0 failures).

### Implementation notes / documented choices

- **Diff library**: added `diff@^8` (`server/package.json`) rather than
  hand-rolling unified-diff format/apply. `propose_correction` uses
  `createPatch` to compute the diff from the entry's current `bodyText`
  and the caller's full proposed replacement text (callers pass plain
  text, not diff syntax); `resolve_correction`'s accept path uses
  `applyPatch`, which returns `false` if the diff no longer applies
  cleanly (surfaced as a thrown error, not a partial/corrupt apply).
- **`create_knowledge_entry` / `create_project` are each a two-mode
  tool**: omitted `id` creates a new row; a supplied `id` + `version`
  updates the existing row's non-`bodyText` metadata fields (rejecting a
  `bodyText` argument outright on the update path, per D3). This is how
  the ticket's "family updates ... rejected when version doesn't match"
  acceptance criterion is satisfied without adding separate
  `update_knowledge_entry`/`update_project` tools not specified anywhere
  in architecture-001/architecture-update.md's fixed tool surface (R2).
- **`add_asset_to_collection` creates a missing `Collection`** (not an
  error) under the given `WorkspaceDirectory`, using `collectionKind`
  (default `'stock-art'`) -- an agent proposing a new collection
  grouping shouldn't need a separate create-collection round-trip first.
- **Project-scoped `resourceKey`/directory convention**: `projects/<id>`
  (numeric `Project.id`), not a human-readable slug -- no `slug` field
  exists on `Project` and this sprint makes no Prisma migration, and a
  title-derived slug would either collide across same-titled projects or
  need its own uniqueness bookkeeping. Keeps the Lock `resourceKey`, the
  Versioning Service's recorded path, and the actual on-disk path
  identical for every project-scoped write (`create_project`,
  `create_iteration`, `create_agent_page`) -- the same convention
  `fsTools.ts` already established for directory writes.

---
id: "003"
title: "Workspace MCP Server: typed catalog tools + optimistic locking"
status: open
use-cases: [SUC-002]
depends-on: ["002"]
github-issue: ""
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

- [ ] `create_knowledge_entry` creates a `KnowledgeEntry` row (any
      `kind`) under a given `WorkspaceDirectory`.
- [ ] `propose_correction` creates a `KnowledgeCorrection` row (`status:
      pending`) holding a unified diff against the target entry's
      current `bodyText`; the entry's `bodyText` and `version` are
      unchanged by this call.
- [ ] `resolve_correction` (accept path) applies the correction's diff to
      `bodyText`, bumps `KnowledgeEntry.version` by exactly 1, and sets
      the correction's `status` to `accepted`, `resolvedAt` to now.
- [ ] `resolve_correction` (reject path) sets `status` to `rejected`,
      `resolvedAt` to now, and changes nothing else (`bodyText`/`version`
      untouched).
- [ ] `add_asset_to_collection` creates an `Asset` row under a named
      `Collection` (document whether the tool creates a missing
      `Collection` or errors -- implementer's call); no vision-model
      description call is made this sprint (`AssetDescription` may
      remain null -- Sprint 004 scope).
- [ ] `create_project` creates a `Project` row (optionally with
      `parentProjectId` for a subproject).
- [ ] `create_iteration` creates an `Iteration` row under a `Project`,
      never overwriting an existing iteration's `imagePath` (insert-only,
      matching Sprint 002's SUC-001 guarantee).
- [ ] `create_agent_page` writes a page-definition file (markup/schema +
      optional small script) to `projects/<slug>/outputs/` via ticket
      002's `fsTools`/path-containment/lock mechanics, plus a minimal
      output-metadata record (folded into `Iteration` or equivalent) --
      generic mechanism only, no postcard-specific content-generation
      logic (Sprint 004/005).
- [ ] `create_knowledge_entry`-family updates and `create_project`-family
      updates that include a `version` argument are rejected (with a
      surfaced, catchable conflict, not a silent overwrite) when the
      row's current `version` no longer matches the supplied value.
- [ ] All catalog writes acquire and release a `Lock` row before/after,
      using ticket 002's shared `locks.ts` helper (`resourceKey`
      convention consistent with R5, e.g. the entry's/collection's
      `WorkspaceDirectory` path).
- [ ] Every successful catalog write triggers ticket 001's Versioning
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

- **Existing tests to run**: `npm test`.
- **New tests to write**: `tests/server/agent-mcp-catalog-tools.test.ts`
  per Testing Plan above.
- **Verification command**: `npm test`

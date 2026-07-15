---
id: "002"
title: "Workspace MCP Server: filesystem tools, path containment, locking"
status: open
use-cases: [SUC-001]
depends-on: ["001"]
github-issue: ""
issue: workspace-mcp-server.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Workspace MCP Server: filesystem tools, path containment, locking

## Description

Build the second, in-process-only `McpServer` instance
(`workspaceMcpServer`, architecture-001 D5) with its filesystem tool
family. This ticket lands the MCP server shell, the fs tools
(`read_file`, `move_file`, `create_directory`, `stat`), path containment
(reusing Sprint 002's `resolveWorkspacePath`), and the shared `Lock`
acquire/release helper -- ticket 003's catalog tools build on this same
instance and lock helper. Depends on ticket 001 because a successful
mutation must hand off to the Versioning Service's commit path.

## Acceptance Criteria

- [ ] `server/src/agent-mcp/server.ts` creates a second `McpServer`
      instance named distinctly from the existing dev-tooling server
      (e.g. `workspaceMcpServer`), never mounted on any HTTP route --
      connected only in-process.
- [ ] `read_file`, `move_file`, `create_directory`, `stat` tools are
      registered on `workspaceMcpServer` and no others -- no generic
      shell/exec tool exists on this or any MCP instance.
- [ ] All four tools resolve their path argument(s) through Sprint 002's
      `resolveWorkspacePath` (imported from
      `services/workspaceDirectorySync.ts`, not reimplemented).
- [ ] A `read_file`/`stat` call for a path inside `workspace/` succeeds
      and returns file content/metadata.
- [ ] A `move_file`/`create_directory` call for a path inside
      `workspace/` succeeds.
- [ ] A `read_file`, `move_file`, `create_directory`, or `stat` call
      whose resolved path escapes `workspace/` (via `../` traversal, an
      absolute path outside the root, or a `move_file` *destination*
      that resolves outside the root even though the source is inside
      it) is rejected before any filesystem I/O occurs.
- [ ] `move_file`/`create_directory` acquire a `Lock` row
      (`resourceType: 'directory'`, `resourceKey`: the resolved
      workspace-relative path) before executing and release it after,
      whether the operation succeeds or throws.
- [ ] A second `move_file`/`create_directory` call for the same
      `resourceKey` while the first's lock is still held is rejected
      (not queued indefinitely) with a clear, catchable error.
- [ ] `read_file`/`stat` do not acquire a lock (reads are unmoderated
      per D9 -- only mutations lock).
- [ ] A successful `move_file`/`create_directory` call triggers ticket
      001's Versioning Service commit path, invoked after the
      filesystem mutation completes, not before.
- [ ] `server/src/agent-mcp/locks.ts` exports the acquire/release helper
      used by both this ticket's fs tools and (in ticket 003) the
      catalog tools, written so the Agent Runtime (ticket 005) can import
      it for the `project_turn` lock without duplicating logic.

## Implementation Plan

### Approach

Model `agent-mcp/server.ts` on the existing `server/src/mcp/server.ts`
(same `@modelcontextprotocol/sdk` `McpServer` constructor, same
`server.tool(name, description, schema, handler)` registration pattern
already used by `server/src/mcp/tools.ts`) but give the instance a
distinct name/version and never wire it into `server/src/app.ts`'s route
mounting -- it is constructed and handed directly to the Agent Runtime's
turn controller (ticket 005) as an in-process object, not an
HTTP-reachable endpoint. `locks.ts` wraps the `Lock` model:
`acquireLock(resourceType, resourceKey, holder)` attempts a Prisma
`create` against the `@@unique([resourceType, resourceKey])` constraint
and catches the unique-constraint violation to return/throw a clear
"already locked" result instead of the raw Prisma error;
`releaseLock(resourceType, resourceKey)` deletes the row. Wrap each
mutating tool's body in `try/finally` so the lock is always released even
if the filesystem operation throws mid-way. `move_file` must resolve
**both** the source and destination path through `resolveWorkspacePath`
and reject if either escapes the root -- the "crafted `move_file`
destination" case architecture-001's Security Considerations calls out
by name.

### Files to Create/Modify

- `server/src/agent-mcp/server.ts` (new)
- `server/src/agent-mcp/fsTools.ts` (new)
- `server/src/agent-mcp/locks.ts` (new)

### Testing Plan

- **Existing tests to run**: `npm test`, especially
  `tests/server/workspace-directory-sync.test.ts` (confirms the reused
  path-containment helper's own contract is unchanged).
- **New tests to write** (`tests/server/agent-mcp-fs-tools.test.ts`):
  - Each of the four tools succeeds for an in-root path.
  - Each of the four tools rejects an out-of-root path (`../` traversal
    and absolute-path cases), including a `move_file` whose
    *destination* escapes the root.
  - `move_file`/`create_directory` acquire and release a `Lock` row
    around the operation.
  - A conflicting second lock acquisition on the same `resourceKey` is
    rejected, not queued.
  - `read_file`/`stat` never create a `Lock` row.
  - A successful mutating call invokes ticket 001's versioning commit
    function (mock/spy on `versioning.ts`'s export).
- **Verification command**: `npm test`

### Documentation Updates

None beyond this ticket.

## Testing

- **Existing tests to run**: `npm test`.
- **New tests to write**: `tests/server/agent-mcp-fs-tools.test.ts` per
  Testing Plan above.
- **Verification command**: `npm test`

---
id: '004'
title: Workspace file-serving route (GET /api/files/*)
status: done
use-cases:
- SUC-014
depends-on: []
github-issue: ''
issue: real-two-pane-app.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Workspace file-serving route (GET /api/files/*)

## Description

**This is the most important ticket in the sprint's foundation layer.**
Re-verifying `server/src/app.ts` against the actual mounted routes found
that nothing serves `workspace/` file bytes to the browser at all — the
app only calls `express.static(publicDir)` for the built client SPA.
Every image an `Asset.path`/`Iteration.imagePath` points to lives under
`workspace/` server-side with zero HTTP path to it. Without this route,
**no promoted page in this sprint can render a single real image** —
not a drawer thumbnail, not an iteration, not a postcard preview, not a
project hero image. See `clasi/sprints/005-real-two-pane-app/
architecture-update.md` Step 1-2 and Design Rationale **R7** for the full
gap analysis and why a generic route (not per-resource endpoints, not a
second `express.static` mount) is the right shape.

Add `server/src/routes/files.ts`: `GET /api/files/*`. The wildcard suffix
is resolved via the existing `resolveWorkspacePath` (`server/src/services/
workspaceDirectorySync.ts` — the same path-containment helper every other
filesystem-touching module in this codebase already reuses; do not
reimplement containment logic). Stream the file with a content-type
inferred from its extension (reuse or mirror the small MIME lookup table
`catalogTools.ts`'s `mimeTypeForAssetPath` already establishes). Gate with
`requireAuth` only (no `requireAdmin` — matches the shared-trust model
architecture-001's Security Considerations already documents, and the
gate every other new route in this sprint uses). Read-only, unmoderated
(D9 — reads bypass the Workspace MCP Server by design).

## Acceptance Criteria

- [x] `GET /api/files/{valid-workspace-relative-path}` returns the file's
      bytes with the correct `Content-Type` header.
- [x] A path-traversal attempt (e.g. `GET /api/files/../../etc/passwd` or
      an encoded equivalent) is rejected — `resolveWorkspacePath` throws
      or the route returns 400/404, never resolves outside `workspace/`.
- [x] A request for a path that doesn't exist under `workspace/` returns
      404, not a stack trace or a directory listing.
- [x] An unauthenticated request (no session) is rejected by
      `requireAuth` before any filesystem access happens.
- [x] The route is mounted in `server/src/app.ts` before the production
      `express.static(publicDir)` catch-all.

## Implementation Plan

**Approach**: One small, generic Express route. No new dependency
(reuses `resolveWorkspacePath`, already imported this way by
`fsTools.ts`, `catalogTools.ts`, `postcardPdf.ts`, `description.ts`, and
others). Stream via `fs.createReadStream`/`res.sendFile` (whichever the
implementer finds cleaner given `resolveWorkspacePath`'s return shape —
either is fine as long as containment is checked *before* any I/O).

**Files to create**:
- `server/src/routes/files.ts`.
- Test file covering the acceptance criteria above (valid path, traversal
  attempt, missing file, unauthenticated request).

**Files to modify**:
- `server/src/app.ts` — mount `filesRouter` under `/api`, alongside the
  existing five routers, before the `express.static(publicDir)` catch-all.

**Testing plan**: A dedicated test file
(`tests/server/files-route.test.ts` or similar) against a scratch
`WORKSPACE_DIR`, matching the containment-test convention already
established for `resolveWorkspacePath`'s own test suite and
`fsTools.ts`'s `move_file`/`create_directory` traversal tests. Explicitly
include a traversal-attempt test — this route's own test coverage is
disproportionately important relative to its size, since every later
image-rendering ticket depends on it (architecture-update.md Risks).

**Documentation updates**: None beyond the route's own doc comment.

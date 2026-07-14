---
id: '004'
title: Workspace filesystem scaffold and WorkspaceDirectory/_dir.json sync
status: done
use-cases:
- SUC-005
depends-on:
- '003'
github-issue: ''
issue: foundation-schema-and-knowledge-store.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Workspace filesystem scaffold and WorkspaceDirectory/_dir.json sync

## Description

Architecture-001's File-System Layout defines a `workspace/` tree
(`assets/`, `knowledge/`, `projects/`, `exports/`) where the DB
(`WorkspaceDirectory` row) is canonical and a `_dir.json` file mirrors
it for anyone browsing the raw tree outside the app (D6). Sprint 003's
Workspace MCP Server will be the actual writer of this tree at runtime,
but it needs the initial scaffold and a reusable sync utility to call —
this ticket builds both, in isolation from any agent/MCP code, so it can
be tested standalone. Depends on ticket 003 because `WorkspaceDirectory`
must exist as a Prisma model first.

## Acceptance Criteria

- [x] `workspace/` directory tree exists with `assets/`, `knowledge/`,
      `projects/`, `exports/` top-level directories, matching
      architecture-001's File-System Layout.
- [x] Initial category subdirectories exist under `assets/` (`logos/`,
      `stock-art/`, `prior-art/`) and `knowledge/` (`styles/`,
      `palettes/`, `compositions/`, `layouts/`), each with a matching
      `WorkspaceDirectory` row.
- [x] A sync utility function/module exists (e.g.
      `server/src/services/workspaceDirectorySync.ts`) that, given a
      `WorkspaceDirectory` row, writes/updates the corresponding
      `_dir.json` file at that row's `path`, with `_dir.json`'s content
      matching `descriptorJson`.
- [x] Creating a `WorkspaceDirectory` row via the sync utility produces a
      matching `_dir.json` file at the expected path.
- [x] Moving/renaming a `WorkspaceDirectory` row's `path` via the sync
      utility updates the `_dir.json` location — no orphaned old
      `_dir.json` file remains at the previous path.
- [x] The sync utility resolves all paths against `workspace/` as an
      enforced root and rejects (throws/returns an error for) any
      resolved path that would escape it — this is the path-containment
      mechanism Sprint 003's MCP server will reuse, built and tested here
      first in isolation.
- [x] `.gitignore`/workspace-repo boundary is clarified: confirm whether
      `workspace/` is nested inside this app repo (interim state) or
      already a separate git root, per architecture-001 Open Question 3 —
      if unresolved, scaffold it as a subdirectory of this repo but
      structured so it can be `git init`'d separately later without a
      file-layout change (Sprint 003's Versioning Service ticket owns the
      actual repo-split decision).

## Implementation Plan

### Approach

Build the sync utility as a small, dependency-light module with two
operations: `writeDirDescriptor(dir: WorkspaceDirectory)` (writes/
overwrites `_dir.json` at `dir.path`) and `moveDirDescriptor(oldPath,
newPath)` (moves the file, removing the stale one). Both resolve their
target path via a shared `resolveWorkspacePath(relativePath)` helper that
throws on any path escaping the `workspace/` root (reused verbatim by
Sprint 003's MCP server tools — build it here so it has one
implementation and one test suite, not two). Seed the initial category
directories via a one-time scaffold script or as part of this ticket's
own test setup / a `postmigrate` step (implementer's call — a script
under `server/src/scripts/` consistent with ticket 006's seed-import job
pattern is reasonable).

### Files to Create/Modify

- `server/src/services/workspaceDirectorySync.ts` (new) — sync utility
  and `resolveWorkspacePath` path-containment helper.
- `server/src/scripts/scaffold-workspace-directories.ts` (new) — creates
  initial `WorkspaceDirectory` rows + `_dir.json` files for the top-level
  and category directories.
- `workspace/` (new, at repo root or a configured location — confirm
  against existing `BACKUP_DIR`-style config pattern for where generated/
  runtime content lives in this repo, e.g. alongside `app-data` volume
  conventions already used for backups).

### Testing Plan

- **Existing tests to run**: `npm test` (full suite).
- **New tests to write**:
  - `writeDirDescriptor` produces correct `_dir.json` content matching
    `descriptorJson`.
  - `moveDirDescriptor` relocates the file and leaves no orphan.
  - `resolveWorkspacePath` rejects `../` traversal and absolute paths
    outside `workspace/`.
  - Scaffold script run twice is idempotent (no duplicate
    `WorkspaceDirectory` rows, no duplicate/conflicting `_dir.json`
    writes).
- **Verification command**: `npm test`

### Documentation Updates

Note in `architecture-update.md`'s Open Questions (already flagged as
Open Question 1 there, carried from architecture-001 Open Question 3)
that the one-repo-vs-two decision remains open; this ticket does not
resolve it, only avoids foreclosing either option.

## Testing

- **Existing tests to run**: `npm test` — passes, 145 server (133 existing
  + 12 new) / 91 client, exit 0.
- **New tests to write**: `tests/server/workspace-directory-sync.test.ts`
  (12 tests) — `resolveWorkspacePath` root resolution plus `../` and
  absolute-path escape rejection; `writeDirDescriptor` content-match,
  overwrite, and null-descriptor-defaults-to-`{}` cases;
  `moveDirDescriptor` relocation-with-no-orphan and safe-no-op-when-
  nothing-exists-yet cases; `scaffoldWorkspaceDirectories` creates the
  top-level tree plus one `WorkspaceDirectory` row + matching `_dir.json`
  per category directory, and a second run is idempotent (0 created, all
  re-synced, no duplicate rows). All filesystem assertions run against a
  scratch `WORKSPACE_DIR` temp directory, not the real `server/workspace/`
  tree.
- **Verification command**: `npm test` (also manually ran
  `npx tsx src/scripts/scaffold-workspace-directories.ts` from `server/`
  twice against the dev DB to confirm end-to-end idempotency outside the
  test harness: first run reported 7 created/0 resynced, second run 0
  created/7 resynced).

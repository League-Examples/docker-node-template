---
id: '001'
title: 'Workspace Versioning Service: batched git commit + config-gated push'
status: done
use-cases:
- SUC-005
depends-on: []
github-issue: ''
issue: workspace-git-versioning.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Workspace Versioning Service: batched git commit + config-gated push

## Description

Architecture-001 Module 10 (Versioning Service), as scoped by this
sprint's `architecture-update.md` **R1**: commits `workspace/` filesystem
changes plus periodic JSON export snapshots of `KnowledgeEntry`/
`Collection` rows (never the live `.db` file, per D7) to git, batched per
agent turn. This sprint implements the **one-repo-for-now** default --
`workspace/` stays inside the app repo's own git working tree (as Sprint
002 already scaffolded it); no new GitHub remote is created. The service
is written against two config values, `WORKSPACE_GIT_ROOT` (the git
working-tree root to operate against, default: the app repo root) and
`WORKSPACE_GIT_REMOTE` (unset by default -- no push is attempted, no
remote is required to exist), so that confirming architecture-001 Open
Question 3 later and splitting `workspace/` into its own repository is a
config change, not a rewrite. This ticket has no dependency on the
Workspace MCP Server (tickets 002/003) -- it is foundational, standalone,
and testable against a scratch git repo; those tickets call *into* this
one after a successful write.

## Acceptance Criteria

- [x] `server/src/services/versioning.ts` exists, exporting a function
      that stages and commits changed paths under `workspace/` plus a
      fresh JSON export snapshot of `KnowledgeEntry`/`Collection` rows
      into `workspace/exports/`, as one git commit.
- [x] The live `.db` file is never staged or committed by this service.
- [x] `WORKSPACE_GIT_ROOT` controls the git working-tree root the service
      operates against; defaults to the app repo root (so `workspace/`
      commits land in the same repo/history as the rest of the app, per
      `architecture-update.md` R1).
- [x] `WORKSPACE_GIT_REMOTE` controls whether a push is attempted after
      commit; unset (this sprint's default) means local-commit-only, no
      push attempted, no remote required to exist.
- [x] When `WORKSPACE_GIT_REMOTE` is set (test-only, pointed at a
      throwaway local bare repo) and the commit succeeds, a push is
      attempted to that remote.
- [x] A push failure (simulated: invalid/unreachable remote) does not
      raise past the caller -- the local commit stands, and the failure
      is surfaced as a non-fatal result (e.g. a returned `pushed: false`
      plus a logged warning), not a thrown exception (architecture-001
      UC-012 E1).
- [x] No GitHub remote or repository is created by this ticket --
      `WORKSPACE_GIT_REMOTE` is read from config only, never provisioned.
- [x] `WORKSPACE_GIT_ROOT` / `WORKSPACE_GIT_REMOTE` are added to
      `config/dev/public.env` and `config/prod/public.env` (non-secret,
      both optional/empty-default).
- [x] Two writes staged before one call to the commit function produce
      exactly one git commit -- the batching contract tickets 002/003
      rely on.

## Implementation Plan

### Approach

Wrap `simple-git` (new dependency) around a configurable working-tree
root. Expose a small, focused interface -- the exact shape
(`recordChange(path)` + `commitTurn(summary)`, or one combined
`commitWorkspaceChanges(paths, summary)`) is the implementer's call;
what's binding is the batching guarantee (one commit per turn, not per
write), not the function signature. Export a JSON snapshot writer
(`exportKnowledgeSnapshot()`) that dumps `KnowledgeEntry`/`Collection`
rows to `workspace/exports/` (timestamped or fixed-rolling filename,
implementer's call) as part of the same commit. Use `simple-git` (or
`execFile('git', [...])` if simpler) -- either is acceptable.

### Files to Create/Modify

- `server/src/services/versioning.ts` (new) -- commit/push logic,
  `WORKSPACE_GIT_ROOT`/`WORKSPACE_GIT_REMOTE` config reads.
- `server/package.json` (modify) -- add `simple-git` dependency.
- `config/dev/public.env`, `config/prod/public.env` (modify) -- add
  `WORKSPACE_GIT_ROOT`, `WORKSPACE_GIT_REMOTE`.
- `config/env.template` (modify) -- document the two new vars, following
  the file's existing convention.

### Testing Plan

- **Existing tests to run**: `npm test` (full suite) -- must stay green
  with no real GitHub credentials present.
- **New tests to write** (`tests/server/versioning.test.ts`):
  - A single call with two changed paths + a knowledge snapshot produces
    exactly one git commit in a scratch `WORKSPACE_GIT_ROOT` (a
    test-created temp git repo, not the real app repo).
  - The live `.db` file (or a stand-in file in the same tree) is never
    staged.
  - With no `WORKSPACE_GIT_REMOTE` set, no push is attempted.
  - With `WORKSPACE_GIT_REMOTE` pointed at a throwaway local bare repo
    (`git init --bare` in a temp dir, test setup), the commit is pushed
    and appears in the bare repo's history.
  - With `WORKSPACE_GIT_REMOTE` pointed at an invalid/unreachable path,
    the commit still succeeds locally and the function does not throw.
- **Verification command**: `npm test`

### Documentation Updates

None beyond this ticket -- `architecture-update.md` already documents
R1's rationale; update its Migration Concerns only if implementation
reveals a config-shape change.

## Testing

- **Existing tests to run**: `npm test` (baseline: 158 server / 94 client
  from Sprint 002 -- confirm no regression).
- **New tests to write**: `tests/server/versioning.test.ts` per Testing
  Plan above.
- **Verification command**: `npm test`

### Results

`npm test` exit 0: **171 server** (158 baseline + 13 new in
`tests/server/versioning.test.ts`) / **94 client** (unchanged) -- no
regressions. All 13 new tests operate against per-test scratch git repos
under `os.tmpdir()` (`WorkspaceVersioningService`'s `gitRoot`/`exportsDir`
options); the real app repo's git history and `server/workspace/` tree
were verified untouched after the full run (`git log`, `git status`,
`find server/workspace -newer ...`). Coverage: batching (two writes -> one
commit; a second `commitTurn` -> a second, separate commit; no pending
changes -> `committed: false`, no commit created), live `.db`/`.db-wal`
paths silently dropped from `recordChange` (never staged, confirmed via
`git status`'s `staged`/`not_added`), `exportKnowledgeSnapshot` writing a
JSON snapshot and joining the same commit as recorded changes, no-push
when `WORKSPACE_GIT_REMOTE` is unset, a successful push to a throwaway
local bare repo (`git init --bare`) when the remote is configured, a push
failure to an invalid/unreachable remote path returning `pushed: false` +
`pushError` without throwing (and the local commit still standing), and
`WORKSPACE_GIT_ROOT`/`WORKSPACE_GIT_REMOTE` config-read defaults/overrides.

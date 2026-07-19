---
status: pending
---

# Iteration.modelParams persists and serializes an absolute filesystem path

## Source

Code review of sprint 010 (image-edit source passthrough), 2026-07-19.
The sprint's security-critical behavior (path containment, no model-supplied
path injection, cross-project scoping) was found sound; this is a
low-severity hygiene finding, deliberately deferred out of the sprint
close rather than scope-creeping it.

## Problem

When an edit-style generation runs, `turn.ts` sets
`modelParams.referenceImages` to the **absolute** host path returned by
`resolveWorkspacePath(...)` (server/src/agent/turn.ts, the
`IMAGE_GENERATION_TOOL_NAME` dispatch branch). That object is then spread
into `recordedModelParams` in
server/src/agent/realImageVisionClient.ts and persisted in the new
`Iteration.modelParams` JSON column. The project routes
(server/src/routes/projects.ts, `PROJECT_DETAIL_INCLUDE` /
`PROJECT_LIST_INCLUDE`) return full iteration rows with no field
selection, so `GET /api/projects` and `GET /api/projects/:id` serialize
that absolute path (e.g. `/Volumes/.../workspace/projects/3/iterations/
iter-2.png`, or whatever `WORKSPACE_DIR` resolves to in prod) to every
authenticated browser on the project.

Two harms:
1. **Info disclosure** — leaks the server's absolute workspace root to
   clients. Ironically the exact "raw filesystem path" the sprint's
   design rationale set out to keep away from the model, now exposed via
   the REST payload instead.
2. **Non-portable DB data** — iteration history stores host-absolute
   paths; a restore under a different `WORKSPACE_DIR` leaves stale
   absolute strings (dead metadata — never re-read, since the resolver
   always recomputes from the relative `imagePath`).

Low risk: same-project authenticated users only, no credentials.

## Fix direction

Keep what's persisted/returned relative — resolve to an absolute path
only at the `fs.readFile` sink in `imaging.ts`'s `callOpenAiEdits` — or
strip `referenceImages` from `recordedModelParams` before persisting
(optionally record the source iteration seq for provenance instead of a
path).

## Secondary (defense-in-depth, same review)

`callOpenAiEdits` (server/src/services/imaging.ts) still does
`fs.readFile(refPath)` with no containment check of its own; today's
safety rests entirely on `turn.ts` being the sole caller that validates.
If the fix above moves resolution to the sink, add the containment check
there so the guard lives at the read site, not by caller convention.

## Acceptance criteria

- `Iteration.modelParams` no longer contains an absolute host path after
  an edit generation (relative path, seq reference, or omitted).
- `GET /api/projects` and `GET /api/projects/:id` no longer expose an
  absolute filesystem path in any iteration's `modelParams`.
- The edit read still works end-to-end and remains contained to the
  workspace root.

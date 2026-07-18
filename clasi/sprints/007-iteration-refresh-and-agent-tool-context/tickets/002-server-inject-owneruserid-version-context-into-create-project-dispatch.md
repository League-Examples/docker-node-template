---
id: '002'
title: 'Server: inject ownerUserId/version context into create_project dispatch'
status: open
use-cases: [SUC-002]
depends-on: []
github-issue: ''
issue: agent-asks-user-for-internal-ids.md
# This ticket only implements the context-injection half of the linked
# issue; ticket 003 (system prompt guardrail) is the other half. Set to
# false so the issue is not archived until ticket 003 (which completes
# it) is done.
completes_issue: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Server: inject ownerUserId/version context into create_project dispatch

## Description

Observed live (project 14, "League of Mentors", 2026-07-17): the agent
tried to rename "Untitled project" via `create_project`, the call failed
because it requires `title` + `ownerUserId` to create, or `id` + `version`
to update, and the model — with no context to supply those fields —
asked the end user "What's the owner user ID?", an internal database ID
no user should ever see.

`server/src/agent/turn.ts`'s `runTurn` already loads the scoped
`Project` row for `loadProjectContext` (`title`/`status`/`detailsHeader`).
This ticket makes `dispatchToolCall`'s `create_project` handling inject
the omitted `ownerUserId`/`version` (for an update to the turn's own
`projectId`) or `ownerUserId` from the authenticated caller (for a
genuinely new top-level project with no `id`), so the model never needs
to know or ask for those internal identifiers. `catalogTools.createProject`'s
own validation is **not** changed — it stays strict for every caller;
this ticket only changes what `turn.ts` passes into it. See sprint.md's
Architecture (Step 3, Design Rationale: "Injection at the turn-controller
layer vs. relaxing `createProject`'s validation").

This ticket also threads the authenticated user id from
`routes/chat.ts` into `runTurn`'s input (`RunTurnInput` gains an
optional `authenticatedUserId` field, mirroring the existing optional
`activeFace` field), since `create_project` for a brand-new project has
no existing `Project` row to source an owner from.

Parent sprint architecture:
`clasi/sprints/007-iteration-refresh-and-agent-tool-context/sprint.md`
(SUC-002). Depends on nothing — independent of ticket 001.

## Acceptance Criteria

- [ ] `RunTurnInput` gains an optional `authenticatedUserId?: number`
      field; omitting it (existing callers/tests) does not break any
      existing behavior.
- [ ] `routes/chat.ts` passes `req.user.id` (already established pattern,
      see `routes/projects.ts`) as `authenticatedUserId` into `runTurn`'s
      input.
- [ ] When the model calls `create_project` with `id` set (updating the
      project already scoped by `RunTurnInput.projectId`) and omits
      `version`, `dispatchToolCall` fills in `version` from the
      project row `runTurn` already loads (via `loadProjectContext` or an
      equivalent read), before the call reaches
      `catalogTools.createProject`.
  - [ ] Same for `ownerUserId` on an update — filled from the existing
      project's current owner when omitted (never changed unintentionally
      by the model; if the model explicitly supplies a different
      `ownerUserId`, that value is passed through unchanged — injection
      only fills a **gap**, it never overrides an explicit model-supplied
      value).
- [ ] When the model calls `create_project` with no `id` (a genuinely new
      project) and omits `ownerUserId`, it is filled from
      `authenticatedUserId`.
- [ ] `catalogTools.createProject`'s own signature, validation, and
      `VersionConflictError` behavior are unchanged — verified by running
      its existing test suite unmodified.
- [ ] A rename of the current project succeeds end-to-end when the model
      supplies only `id` + `title` (no `version`/`ownerUserId`).

## Testing

- **Existing tests to run**: `server`'s existing `turn.ts` test suite
  (mock-provider-driven turn tests) and `catalogTools.ts`'s existing
  `createProject` tests — both must continue to pass unmodified,
  confirming no regression to `createProject`'s own validation.
- **New tests to write** (in `turn.ts`'s test file):
  - Mock provider returns a `create_project` tool call with `{ id: <scoped
    projectId>, title: 'New Name' }` (no `version`/`ownerUserId`); assert
    the args actually dispatched to `DEFAULT_TOOL_HANDLERS.create_project`
    (or the injected wrapper) include the current `version` and
    `ownerUserId` read from the DB.
  - Mock provider returns `create_project` with no `id` (new project) and
    no `ownerUserId`; assert `ownerUserId` is filled from
    `RunTurnInput.authenticatedUserId`.
  - Mock provider returns `create_project` with an explicit `ownerUserId`
    different from the project's current owner; assert it is passed
    through unchanged (injection never overrides an explicit value).
  - Mock provider returns `create_project` with `id` set but the project
    was concurrently updated (simulate stale `version` even after
    injection, e.g. a race) — assert the existing `VersionConflictError`
    still surfaces as an `isError: true` tool result (unchanged failure
    path, not swallowed).
- **Verification command**: `npm test --workspace server` (or the
  project's configured server test command — confirm via
  `server/package.json`'s `"test"` script); do not assume
  `uv run pytest` — this is a TypeScript/Node project.

## Implementation Plan

- **Approach**: Add a small pre-dispatch step in `dispatchToolCall` (or a
  dedicated helper called from it) specifically for `call.name ===
  'create_project'`: load the current `Project` row for
  `ctx.projectId` (reuse `loadProjectContext`'s query or a lighter
  `prismaClient.project.findUnique` selecting just `version`/
  `ownerUserId`), then merge into `call.args`: if `args.id` is set and
  matches `ctx.projectId` (or `args.id` is unset — treat as "this
  project" per SUC-002), fill `version`/`ownerUserId` only where the
  model's `args` did not already supply them. If `args.id` is unset and
  this is a new top-level project, fill `ownerUserId` from
  `ctx.authenticatedUserId` (new field threaded through
  `dispatchToolCall`'s `ctx` alongside the existing `activeFace`).
- **Files to modify**:
  - `server/src/agent/turn.ts` — `RunTurnInput`, `dispatchToolCall`,
    `runTurn` (threading `authenticatedUserId` into `dispatchToolCall`'s
    `ctx`, alongside existing `activeFace`).
  - `server/src/routes/chat.ts` — pass `req.user.id` as
    `authenticatedUserId` in the `runTurn` call.
  - Corresponding `turn.ts` test file.
- **Testing plan**: see Testing section above.
- **Documentation updates**: update `turn.ts`'s module header (currently
  documents `activeFace`'s "asserted to the model as context" pattern)
  with a matching note for `create_project` argument injection, and
  `RunTurnInput`'s own doc comment for the new `authenticatedUserId`
  field, following the file's existing per-field comment convention.

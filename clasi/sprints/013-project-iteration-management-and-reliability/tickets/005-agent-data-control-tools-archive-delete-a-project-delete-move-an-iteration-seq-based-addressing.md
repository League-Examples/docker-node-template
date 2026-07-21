---
id: '005'
title: 'Agent data-control tools: archive/delete a project, delete/move an iteration,
  seq-based addressing'
status: done
use-cases:
- SUC-028
- SUC-029
depends-on:
- '001'
- '004'
github-issue: ''
issue: agent-full-data-control-tools.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Agent data-control tools: archive/delete a project, delete/move an iteration, seq-based addressing

## Description

Closes the remaining scope of `agent-full-data-control-tools.md` (the
rename sub-component is closed by ticket 004, referenced not
re-solved). Audited `WORKSPACE_TOOL_DEFINITIONS`/`DEFAULT_TOOL_HANDLERS`
in `server/src/agent/turn.ts` and `server/src/agent-mcp/catalogTools.ts`
per the issue's own instruction, before adding anything:

- **Rename**: already works via `create_project`'s update path (sprint
  007); reliability fixed by ticket 004. No change here.
- **Archive/restore a project**: `Project.status` already supports this
  (`routes/projects.ts`'s `PATCH /projects/:id`), but no chat-agent tool
  exists.
- **Delete a project**: `catalogTools.removeProject` already exists,
  already deletes dependent `ChatMessage`/`Reference`/`Iteration` rows
  and best-effort removes the workspace directory, and is already
  registered on the external MCP server (`registerCatalogTools`) and
  used by `DELETE /projects/:id`. It is **not** in `turn.ts`'s
  `DEFAULT_TOOL_HANDLERS`/`WORKSPACE_TOOL_DEFINITIONS` — the chat agent
  cannot reach it today.
- **Delete an iteration**: `catalogTools.removeIteration` already
  exists (deletes the row, best-effort removes the backing file), same
  situation — MCP-registered and REST-used, not chat-agent-reachable.
- **Move an iteration between front/back**:
  `catalogTools.setIterationState` already sets `role` and already IS in
  `turn.ts`'s `DEFAULT_TOOL_HANDLERS`/`WORKSPACE_TOOL_DEFINITIONS` — but
  its agent-facing schema requires `iterationId` (a raw `Iteration.id`).
  **Verified gap**: nothing the model ever receives — `loadProjectContext`'s
  iteration `select` (`seq`/`role`/`accepted`/`promptUsed` only,
  `turn.ts` ~line 528) and every `generate_image`/`create_iteration`
  result shape it would realistically see — ever exposes a raw
  `Iteration.id`. `set_iteration_state` is effectively unreachable by
  the model in practice today, not merely inconvenient. This ticket
  fixes that by re-addressing it via `seq` (see below), which is what
  actually satisfies the issue's own acceptance criterion ("the agent
  references iterations by their UI seq number and never asks for
  internal IDs").

**Design** (sprint.md Architecture § Design Rationale R2/R3/R4/R5 has
full reasoning; summarized here):

1. **`archive_project`** — new chat-agent tool, `{ archived: boolean }`
   only (no project id — always the turn's own `ctx.projectId`).
   `dispatchToolCall` builds `{ id: ctx.projectId }`, runs it through the
   existing `injectCreateProjectArgs` (fills `version`/`ownerUserId`),
   merges in `status: args.archived ? 'archived' : 'active'`, and calls
   the existing `catalogTools.createProject` — a thin alias, no new
   `catalogTools.ts` function.
2. **`delete_project`** — new chat-agent tool, `{ confirm: true }`
   required (no project id — always `ctx.projectId`). Dispatch rejects
   (throws, surfaced as `isError`) unless `args.confirm === true`, then
   calls the existing `catalogTools.removeProject({ projectId:
   ctx.projectId })`.
3. **`delete_iteration`** — new chat-agent tool, `{ seq: number,
   confirm: true }` required. Dispatch rejects unless `args.confirm ===
   true`, resolves `seq` to the real `Iteration` row for `ctx.projectId`
   (regardless of stream/role/accepted status, matching
   `resolveEditSourceIteration`'s numeric-seq precedent), throwing a
   clear "no iteration #N found" error if it doesn't exist, then calls
   the existing `catalogTools.removeIteration({ iterationId:
   resolved.id })`.
4. **`set_iteration_state`** — re-addressed from `iterationId` to `seq`
   in its `WORKSPACE_TOOL_DEFINITIONS` entry; `dispatchToolCall` gains
   the same seq-resolution step as `delete_iteration` (a small shared
   helper) before calling the existing, unchanged
   `catalogTools.setIterationState({ iterationId: resolved.id,
   accepted, role })`. Its REST-facing route (`PATCH /projects/:id/
   iterations/:iterId`) and `catalogTools.setIterationState` itself are
   unchanged — only the *agent tool's* input schema and the
   `dispatchToolCall` translation change.
5. A new `SYSTEM_PROMPT_BASE` sentence: the model may set `confirm:
   true` on `delete_project`/`delete_iteration` only after the user has
   explicitly asked, in this conversation, to delete that specific
   target — never speculatively or inferred from an ambiguous request.

No change to `catalogTools.ts`'s persistence functions or to
`registerCatalogTools`'s external MCP tool registration (a separate
surface for a separate consumer, per sprint.md Scope's "Out of Scope").

## Acceptance Criteria

- [x] `archive_project` is a chat-agent tool (`WORKSPACE_TOOL_DEFINITIONS`
      + `DEFAULT_TOOL_HANDLERS`) taking `{ archived: boolean }` and no
      project-identifying argument; dispatch always targets
      `ctx.projectId`, fills `version`/`ownerUserId` via the existing
      `injectCreateProjectArgs`, and results in the project's `status`
      being `'archived'`/`'active'` via the existing `createProject`.
- [x] `delete_project` is a chat-agent tool taking `{ confirm: boolean }`
      and no project-identifying argument; dispatch always targets
      `ctx.projectId`; omitting or falsifying `confirm` is rejected
      (surfaced as `isError`) before `removeProject` is ever called;
      `confirm: true` results in the existing `removeProject` deleting
      the project and its dependent rows/workspace files.
- [x] `delete_iteration` is a chat-agent tool taking `{ seq: number,
      confirm: boolean }`; omitting or falsifying `confirm` is rejected
      before any deletion; a nonexistent `seq` for `ctx.projectId`
      surfaces a clear "no iteration #N found" error via the existing
      `isError` path without crashing the turn; a valid `seq` +
      `confirm: true` resolves to the real row (regardless of role/
      accepted) and calls the existing `removeIteration`.
- [x] `set_iteration_state`'s `WORKSPACE_TOOL_DEFINITIONS` entry is
      changed from `iterationId` to `seq`; `dispatchToolCall` resolves
      `seq` to the real row for `ctx.projectId` before calling the
      existing `setIterationState` with the resolved `iterationId`; a
      nonexistent `seq` surfaces a clear error via `isError` without
      crashing the turn.
- [x] A regression test proves an agent-dispatched `set_iteration_state`
      call can change an iteration's `role` (move between front/back
      streams), not only `accepted` — the existing dispatch test at
      `tests/server/agent-turn.test.ts` ~line 1911 only exercises
      `accepted` and is updated to use `{ seq, accepted }` instead of
      `{ iterationId, accepted }`.
- [x] `SYSTEM_PROMPT_BASE` instructs the model to set `confirm: true` on
      `delete_project`/`delete_iteration` only after explicit user
      intent for that specific destructive action, this specific
      target, in this conversation.
- [x] No new `catalogTools.ts` function is added; `registerCatalogTools`'s
      external MCP tool registration is unchanged.
- [x] Each new/changed tool has `agent-turn.test.ts` dispatch coverage
      (see Testing).
- [x] Full existing test suite passes, including
      `agent-mcp-catalog-tools.test.ts`'s existing
      `removeProject`/`removeIteration`/`setIterationState` coverage,
      unmodified.

## Testing

- **Existing tests to run**: `tests/server/agent-turn.test.ts` in full
  (this ticket's primary surface), `tests/server/agent-mcp-catalog-tools.test.ts`
  (confirm no regression to the untouched persistence-layer functions).
- **New tests to write** (all in `agent-turn.test.ts`; no new
  persistence-layer tests — `agent-mcp-catalog-tools.test.ts` already
  covers `removeProject`/`removeIteration`/`setIterationState` fully at
  that layer):
  1. Dispatches an `archive_project` tool call with `{ archived: true }`
     and asserts the project's `status` becomes `'archived'`; with
     `{ archived: false }` restores it to `'active'`.
  2. Dispatches `delete_project` with `{ confirm: true }` and asserts
     the project row (and its dependent rows) are gone; dispatches it
     with `{ confirm: false }` (or omitted) and asserts the call is
     rejected (`isError: true`) and the project row still exists.
  3. Dispatches `delete_iteration` with a valid `{ seq, confirm: true }`
     and asserts the targeted `Iteration` row is gone; with `confirm`
     omitted/false, asserts rejection and the row still exists; with a
     nonexistent `seq`, asserts a clear "no iteration #N found" error
     surfaced via `isError` without crashing the turn.
  4. Updates the existing `set_iteration_state` dispatch test (~line
     1911) to use `{ seq: iteration.seq, accepted: true }`; adds a new
     test dispatching `{ seq, role: 'back' }` on a front-stream
     iteration and asserting its `role` changes (proving the
     move-between-streams path is genuinely agent-reachable, closing
     the verified reachability gap).
  5. A nonexistent `seq` passed to `set_iteration_state` surfaces a
     clear error via `isError` without crashing the turn.
  6. A system-prompt content assertion for the new `confirm: true`
     guardrail sentence, mirroring the existing guardrail-assertion
     style.
- **Verification command**: `npm test --prefix server`.

## Implementation Plan

### Approach

1. Add a small shared helper in `turn.ts`, e.g.
   `resolveIterationBySeq(seq, ctx: { projectId, prismaClient })`,
   returning the matching `Iteration` row (scoped to `projectId`,
   regardless of role/accepted) or throwing a "no iteration #N found"
   error — used by both `delete_iteration` and `set_iteration_state`'s
   new dispatch branches. Kept separate from `resolveEditSourceIteration`
   (a different concern: that one resolves to an image path for
   `generate_image`, not a full row) rather than refactored together,
   to avoid coupling this ticket's changes to ticket 002's.
2. Add four entries to `WORKSPACE_TOOL_DEFINITIONS`
   (`archive_project`, `delete_project`, `delete_iteration` new;
   `set_iteration_state` schema changed) and corresponding
   `DEFAULT_TOOL_HANDLERS`/`dispatchToolCall` branches:
   - `archive_project`: build `{ id: ctx.projectId }`, pass through
     `injectCreateProjectArgs`, merge `status`, call
     `catalogTools.createProject`.
   - `delete_project`: validate `confirm === true`, call
     `catalogTools.removeProject({ projectId: ctx.projectId })`.
   - `delete_iteration`: validate `confirm === true`, resolve `seq` via
     the new helper, call `catalogTools.removeIteration({ iterationId })`.
   - `set_iteration_state`: resolve `seq` via the new helper, call
     `catalogTools.setIterationState({ iterationId, accepted, role })`.
3. Add the `confirm: true` guardrail sentence to `SYSTEM_PROMPT_BASE`,
   near the existing destructive/guardrail sentences.
4. Add/update tests per Testing above.

### Files to Create/Modify

- **Modify**: `server/src/agent/turn.ts` (`WORKSPACE_TOOL_DEFINITIONS`,
  `DEFAULT_TOOL_HANDLERS`, `dispatchToolCall`, `SYSTEM_PROMPT_BASE`),
  `tests/server/agent-turn.test.ts`.
- **Not modified** (verified, deliberately): `server/src/agent-mcp/
  catalogTools.ts` (no new function, no registration change).

### Testing Plan

See Testing above.

### Documentation Updates

- `turn.ts`'s existing header comment listing "the N tools dispatched
  here by name" should be updated to the new count and tool names.
- `WORKSPACE_TOOL_DEFINITIONS`'s `set_iteration_state` description
  string should mention moving an iteration between the front/back
  streams explicitly (a small clarity improvement, since its current
  wording only describes the mechanics of the exclusivity rule, not the
  "move between streams" framing a user's phrasing is likely to map to).

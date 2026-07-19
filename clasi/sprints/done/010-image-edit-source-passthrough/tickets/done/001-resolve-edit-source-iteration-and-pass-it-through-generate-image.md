---
id: '001'
title: Resolve edit-source iteration and pass it through generate_image
status: done
use-cases:
- SUC-018
- SUC-019
- SUC-020
depends-on: []
github-issue: ''
issue: image-edits-must-pass-source-image.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Resolve edit-source iteration and pass it through generate_image

## Description

Implements the core plumbing fix for
`clasi/issues/image-edits-must-pass-source-image.md`, per sprint
010's Architecture section (Design Rationale: model decides
edit-vs-new and which iteration by number; the server resolves that
number to a real, validated path). All changes are confined to
`server/src/agent/turn.ts`:

1. **Tool schema**: on the `generate_image` entry in
   `WORKSPACE_TOOL_DEFINITIONS`, remove the vestigial top-level
   `referenceImages` property (never forwarded by `dispatchToolCall`
   today — its own description text already tells the model not to use
   it). Add a new optional property, `editSourceIteration`, accepting
   either an iteration number or the literal string `"last"` (follow
   the existing mixed-type precedent used by `set_iteration_state`'s
   `role` property, e.g. `type: ['integer', 'string']`). Its
   description must tell the model: set this only when the user is
   asking to edit/modify an existing image rather than create a
   brand-new one; pass the iteration number shown in PROJECT CONTEXT to
   edit that specific iteration, or `"last"` to edit the most recent
   iteration on the active stream; omit entirely for a fresh,
   from-scratch generation.

2. **PROJECT CONTEXT rendering**: change `summarizeIterations`
   (and `ProjectContextIteration`/`buildProjectContextBlock` as needed)
   from the current counts-plus-accepted-seq-only summary (e.g.
   `"front: 3 (accepted: #2)"`) to a per-stream listing of each
   iteration's `seq`, marking which one is `accepted` and which one is
   the most recent (highest `seq`) — e.g.
   `"front: #1, #2 (accepted), #3 (most recent) — 3 iterations"`,
   `"back: no iterations yet"`. Do not render `imagePath` anywhere in
   the prompt — only `seq` numbers, `role`, and `accepted` ever reach
   the model-facing text (this is the deliberate hybrid-design
   deviation from the issue's original proposal; see sprint.md Design
   Rationale for why).

3. **Dispatch-time resolution**: in `dispatchToolCall`'s
   `IMAGE_GENERATION_TOOL_NAME` branch, add a new pre-dispatch resolver
   (same shape/spot as the existing `injectCreateProjectArgs` — a
   focused, single-purpose helper, not a change to that function)
   that:
   - Reads `args.editSourceIteration` from the tool call.
   - If absent, resolves to nothing (no source image — fresh
     generation).
   - If `"last"`, queries `prismaClient.iteration` fresh (never the
     turn-start `ProjectContext` snapshot) for the highest-`seq`
     iteration where `role === activeFace`. If none exists, resolves to
     nothing (graceful fallback — no error; AC3 of the parent issue).
   - If a number, queries `prismaClient.iteration` fresh for that `seq`
     within the current `projectId`, regardless of `role`/`accepted`.
     If no matching row exists, throws a clear `Error` (existing
     tool-call `isError`/catch machinery in the dispatch loop already
     surfaces this to the model — no new failure channel needed).
   - When resolution produces an `Iteration` row, converts its
     `imagePath` through `resolveWorkspacePath` (imported from
     `services/workspaceDirectorySync`, the same containment helper
     `catalogTools.ts`/`realImageVisionClient.ts` already use) and uses
     the result as the sole entry of `modelParams.referenceImages`
     passed to `ctx.imageVisionClient.generateImage`.
   - Regardless of whether resolution produced a path, any
     `modelParams.referenceImages` the model supplied directly in its
     tool-call args is discarded/overwritten — never passed through
     unmodified (hardening decision; see sprint.md Design Rationale on
     the pre-existing unvalidated-`fs.readFile` gap in
     `imaging.ts`'s `callOpenAiEdits`).

4. **System prompt guardrail**: add one sentence to
   `SYSTEM_PROMPT_BASE`, in the same style as the existing Sprint 007
   internal-ID guardrail sentence, directing the model to use the
   PROJECT CONTEXT iteration list and the `editSourceIteration`
   argument to reference a prior image, and to never ask the user to
   supply a file name or path.

`imaging.ts`, `realImageVisionClient.ts`, and `routes/chat.ts` are not
touched by this ticket — their contracts are already correct once fed.

## Acceptance Criteria

- [x] `generate_image`'s tool definition no longer advertises the dead
      top-level `referenceImages` property; it advertises
      `editSourceIteration` (accepting a number or the literal
      `"last"`) with a clear, model-facing description of when/how to
      set it.
- [x] PROJECT CONTEXT's iteration summary lists each stream's iteration
      numbers, marking the accepted one and the most recent one,
      consistent with the stakeholder's "last = most recent by seq,
      not necessarily accepted" semantics. No raw `imagePath` string
      ever appears in the rendered prompt text.
- [x] `editSourceIteration: "last"` resolves to the highest-`seq`
      iteration on the turn's `activeFace`, read fresh from the DB at
      dispatch time (not the turn-start `ProjectContext` snapshot).
- [x] `editSourceIteration: <n>` resolves to the iteration with that
      `seq` for the current project, regardless of stream/role or
      accepted status.
- [x] The resolved path is passed through `resolveWorkspacePath` before
      being set as `modelParams.referenceImages`.
- [x] Any `modelParams.referenceImages` supplied directly by the model
      is discarded/ignored, whether or not `editSourceIteration` was
      also set.
- [x] `editSourceIteration` omitted, or `"last"` with zero iterations
      on the active stream, leaves `modelParams.referenceImages` unset
      (fresh generation via `callOpenAiGenerations`, no error).
- [x] `editSourceIteration: <n>` for a nonexistent `n` throws a clear
      error that surfaces through the existing tool-call
      `isError`/catch path (no new failure channel).
- [x] `SYSTEM_PROMPT_BASE` instructs the model to use the iteration
      list/`editSourceIteration` rather than asking the user for a file
      or path.
- [x] `imaging.ts`, `realImageVisionClient.ts`, and `routes/chat.ts`
      are unmodified by this ticket.

## Testing

- **Existing tests to run**: `tests/server/agent-turn.test.ts` (full
  file — includes the `WORKSPACE_TOOL_DEFINITIONS -- generate_image`
  describe block whose "advertises a generate_image tool definition"
  assertion must be updated for the schema change, not just left
  passing by accident), `tests/server/chat-route.test.ts`,
  `tests/server/imaging.test.ts`,
  `tests/server/real-image-vision-client.test.ts` (the latter two are
  expected to pass unmodified — confirms `imaging.ts`/
  `realImageVisionClient.ts` truly weren't touched).
- **New tests to write** (in `tests/server/agent-turn.test.ts`, next to
  the existing `generate_image`/PROJECT CONTEXT describe blocks):
  - Resolver unit tests (seed `Iteration` rows via the test's Prisma
    client, call `runTurn` with a mock provider whose tool call sets
    `editSourceIteration`, and assert on the injected
    `ImageVisionClient.generateImage` mock's received args — this
    file's existing pattern for asserting `generate_image` dispatch
    args already does this for `activeFace`):
    - `"last"` resolves to the highest-`seq` iteration on the active
      face when several exist across both faces, including when the
      accepted iteration is *not* the highest-`seq` one.
    - `"last"` with zero iterations on the active face yields no
      `referenceImages`.
    - A numeric `editSourceIteration` resolves to that iteration
      regardless of face or accepted status.
    - A numeric `editSourceIteration` with no matching row throws /
      surfaces as `isError: true` on the `tool_call_finished` event,
      and the turn still completes rather than crashing.
    - `editSourceIteration` omitted entirely behaves identically to
      today's `generate_image` calls (no `referenceImages`).
  - PROJECT CONTEXT rendering test (extend the existing
    `captureSystemPrompt` helper pattern): seed several iterations
    across both faces with a mix of accepted/non-accepted, assert the
    rendered text lists each `seq`, marks the accepted one and the
    most-recent one, and never contains a `imagePath`-shaped string
    (e.g. assert the rendered block does not contain `"iterations/"` or
    `".png"`).
  - Tool-definition shape test: assert the `generate_image` entry's
    `inputSchema.properties` no longer has a `referenceImages` key and
    does have an `editSourceIteration` key.
  - Hardening test: a mock-provider tool call that sets
    `modelParams.referenceImages` directly (an arbitrary string, no
    `editSourceIteration`) results in the injected
    `ImageVisionClient.generateImage` mock receiving no
    `referenceImages` in `modelParams`.
- **Verification command**: `npm test` (or the project's configured
  Vitest invocation) from `server/`, scoped to
  `tests/server/agent-turn.test.ts` during development, full suite
  before marking this ticket done.

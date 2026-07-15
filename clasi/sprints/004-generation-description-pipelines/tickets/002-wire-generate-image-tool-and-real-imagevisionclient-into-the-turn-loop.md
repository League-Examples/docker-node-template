---
id: '002'
title: Wire generate_image tool and real ImageVisionClient into the turn loop
status: open
use-cases:
- SUC-001
depends-on:
- '001'
github-issue: ''
issue: image-generation-service.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Wire generate_image tool and real ImageVisionClient into the turn loop

## Description

Sprint 003's `turn.ts` already dispatches a `generate_image` tool call to
an injectable `ImageVisionClient` interface, defaulting to
`createStubImageVisionClient()` (`imageVisionStub.ts`) -- and its own
header explicitly defers two things to this sprint: (1) a real
`ImageVisionClient` implementation, and (2) a `generate_image` tool
*definition* in `WORKSPACE_TOOL_DEFINITIONS` (today the dispatch exists
but no definition is advertised to the provider). This ticket does both,
using ticket 001's `imaging.ts` as the real client -- and nothing else in
`turn.ts` changes.

The real client:
1. Calls `imaging.generateImage({ prompt, referenceImages, modelParams })`.
2. Writes the returned bytes to
   `projects/<id>/iterations/iter-<seq>.<ext>` in the workspace
   filesystem (path resolved via the existing
   `resolveWorkspacePath`/lock pattern `agent-mcp/catalogTools.ts`
   already establishes for `create_iteration`/`create_agent_page` --
   reuse, don't reimplement).
3. Calls the existing `create_iteration` Workspace MCP Server tool
   (unchanged) to record the new `Iteration` row.

This satisfies `ImageVisionClient.generateImage`'s existing contract
(`GenerateImageInput` -> `GenerateImageResult { imagePath, modelParams }`)
exactly -- `turn.ts`'s `dispatchToolCall` call site does not change.

## Acceptance Criteria

- [ ] `WORKSPACE_TOOL_DEFINITIONS` gains a `generate_image` tool
      definition (prompt, optional reference image paths, optional
      model params) that a `ProviderAdapter` can see and call, matching
      the shape `dispatchToolCall` already expects at
      `IMAGE_GENERATION_TOOL_NAME`.
- [ ] The app's production turn-controller construction (wherever
      `runTurn` is invoked outside of tests, e.g. `routes/chat.ts`) is
      updated to pass the real `imaging.ts`-backed `ImageVisionClient`
      instead of relying on the stub default; tests continue to inject
      the stub or a mock unchanged.
- [ ] A `generate_image` tool call (via a scripted/mock provider turn,
      matching Sprint 003's `SUC-003` test pattern) produces one new
      `Iteration` row with `imagePath` pointing at a real file under
      `projects/<id>/iterations/` containing the fixture-returned image
      bytes.
- [ ] Two sequential `generate_image` calls on the same project produce
      two `Iteration` rows with increasing `seq`; the first call's
      `imagePath` file is byte-identical before and after the second
      call (the never-overwritten regression test, sprint.md Success
      Criteria).
- [ ] A simulated `imaging.generateImage` failure surfaces as a tool-call
      error result (per `turn.ts`'s existing `isError` tool-result
      shape) and adds no new `Iteration` row; prior iterations are
      unaffected (UC-006 E1).
- [ ] `imageVisionStub.ts` is left in place, unmodified, and still the
      default `runTurn` falls back to when no client is injected (tests
      keep working exactly as Sprint 003 left them).

## Implementation Plan

**Approach**: New thin adapter module implementing `ImageVisionClient`
against `imaging.ts` + the existing iteration-write/create_iteration
pattern; one call-site change in whatever module constructs the
production `runTurn` options; one tool-definition addition. Deliberately
minimal diff to `turn.ts` itself, per architecture-update.md's stated
"only the `ImageVisionClient` implementation... changes" claim -- verify
that claim holds during implementation (if it doesn't, that's a signal
the ticket's scope needs to grow, not that `turn.ts`'s call site was
under-specified).

**Files to create**:
- `server/src/agent/realImageVisionClient.ts` (or similar) --
  implements `ImageVisionClient` against `imaging.ts` + the
  workspace-file-write + `create_iteration` sequence described above.
- Test file covering the acceptance criteria above.

**Files to modify**:
- `server/src/agent/turn.ts` -- add the `generate_image` entry to
  `WORKSPACE_TOOL_DEFINITIONS` only; no change to `dispatchToolCall`,
  the tool-dispatch loop, or `ChatMessage` persistence.
- Whichever module constructs the app's production `TurnControllerOptions`
  (e.g. `server/src/routes/chat.ts`) -- swap in the real client.

**Testing plan**: Reuse Sprint 003's mock-adapter test harness (SUC-003
pattern) to drive a scripted turn that calls `generate_image`; assert on
the resulting `Iteration` row and file. A dedicated
never-overwritten-across-two-calls test, matching this sprint's Success
Criteria language exactly. A dedicated failure-path test (mocked
`imaging.generateImage` rejection).

**Documentation updates**: Update `imageVisionStub.ts`'s header comment
to note the real implementation now exists at
`realImageVisionClient.ts` (currently it says "Sprint 004 builds the
real Image & Vision Service and swaps this stub out" -- make that
concrete once it's true). No user-facing docs change.

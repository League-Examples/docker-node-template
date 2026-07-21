---
id: '002'
title: Fix Iteration.modelParams absolute-path leak; enforce containment at the imaging.ts
  read sink
status: done
use-cases:
- SUC-025
depends-on:
- '001'
github-issue: ''
issue: iteration-modelparams-leaks-absolute-path.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Fix Iteration.modelParams absolute-path leak; enforce containment at the imaging.ts read sink

## Description

Close `iteration-modelparams-leaks-absolute-path.md`. When an edit-style
`generate_image` call runs, `server/src/agent/turn.ts`'s
`dispatchToolCall` currently does:

```ts
modelParams.referenceImages = [resolveWorkspacePath(sourceImagePath)];
```

-- validating containment *and* converting the already-workspace-relative
`Iteration.imagePath` to an absolute host path in the same call. That
absolute value is then spread verbatim into `recordedModelParams` in
`server/src/agent/realImageVisionClient.ts` (`generateImage`) and
persisted into the new `Iteration.modelParams` JSON column.
`server/src/routes/projects.ts`'s `PROJECT_DETAIL_INCLUDE`/
`PROJECT_LIST_INCLUDE` return full iteration rows with no field
selection, so `GET /api/projects` and `GET /api/projects/:id` serialize
that absolute path to every authenticated browser on the project — an
information disclosure of the server's absolute workspace root, and
non-portable DB data (a restore under a different `WORKSPACE_DIR` leaves
a stale absolute string that's never re-read).

Fix (sprint.md Architecture § Design Rationale R1):

1. **`turn.ts`'s `dispatchToolCall`**: keep calling
   `resolveWorkspacePath(sourceImagePath)` for its containment check
   (preserving the existing early-reject behavior for an escaping path,
   and its test), but store the *original relative* `sourceImagePath`
   into `modelParams.referenceImages` — discard the resolved absolute
   value rather than persisting it.
2. **`server/src/services/imaging.ts`'s `callOpenAiEdits`**: it
   currently does an unguarded `fs.readFile(refPath)`, trusting that
   `turn.ts` is the only caller and has already validated/resolved the
   path. Add its own `resolveWorkspacePath` call (new import from
   `services/workspaceDirectorySync.ts`) immediately before
   `fs.readFile`, so containment is enforced at the actual read site
   regardless of caller convention (defense-in-depth, per the issue's
   "Secondary" note). `imaging.ts`'s module header claim of "zero
   outward dependencies on any other Flyerbot module" should be updated
   to note this one, Infrastructure-to-Infrastructure exception.

## Acceptance Criteria

- [x] `dispatchToolCall`'s `generate_image` branch still calls
      `resolveWorkspacePath(sourceImagePath)` and still rejects (via the
      existing `isError` tool-result path) a path that would escape the
      workspace root, exactly as today.
- [x] `modelParams.referenceImages` (both what's passed to the
      `ImageVisionClient` and what ends up in `recordedModelParams`) now
      contains the original relative `Iteration.imagePath`, never the
      `resolveWorkspacePath`-resolved absolute value.
- [x] `imaging.ts`'s `callOpenAiEdits` resolves each `referenceImages`
      entry via `resolveWorkspacePath` and rejects (throwing an
      `ImagingServiceError`, or propagating `resolveWorkspacePath`'s own
      "Path escapes workspace root" error) a path that would escape the
      workspace root, independent of whether the caller already
      validated it.
- [x] `imaging.ts`'s `GenerateImageInput.referenceImages` doc comment is
      updated to state these are workspace-relative paths, resolved
      internally — not raw/absolute filesystem paths as documented
      today.
- [x] A freshly-created edit-sourced `Iteration.modelParams` row
      contains no absolute filesystem path (verified by a test reading
      the row back after a `generate_image` edit call).
- [x] `GET /api/projects` and `GET /api/projects/:id` never expose an
      absolute path in any iteration's `modelParams` (verified by a
      route-level test).
- [x] The edit-read still succeeds end-to-end for a valid, in-workspace
      reference image (no regression to SUC-018/019/020 from sprint 010).
- [x] `tests/server/agent-turn.test.ts` lines 1205 and 1261 (the two
      `"last"`/named-iteration edit-source tests) are updated from
      asserting `calls[0].modelParams.referenceImages` equals
      `[resolveWorkspacePath(iteration.imagePath)]` to asserting it
      equals `[iteration.imagePath]` (the relative form).
- [x] `tests/server/agent-turn.test.ts` line 1511's "Path containment"
      test still passes unmodified in behavior (an escaping path is
      still rejected before any `imageVisionClient` call is made).
- [x] `tests/server/imaging.test.ts`'s two existing reference-image
      tests (currently at lines 98-133 and 184-203, writing their
      fixture under `os.tmpdir()` and passing that absolute path
      directly) are updated to write the fixture under a test-scoped
      `WORKSPACE_DIR` (set via `process.env.WORKSPACE_DIR` for the
      test, per `workspaceDirectorySync.ts`'s own documented test
      convention) and pass a workspace-relative path instead.
- [x] A new `imaging.test.ts` test asserts `callOpenAiEdits` rejects a
      `referenceImages` path that would escape the test-scoped
      workspace root, independent of any caller-side check.
- [x] The full existing test suite passes.

## Testing

- **Existing tests to run**: `tests/server/agent-turn.test.ts` (in
  full — this ticket touches `dispatchToolCall`'s shared edit-source
  path), `tests/server/imaging.test.ts`, `tests/server/real-image-vision-client.test.ts`
  (confirm its "passes referenceImages/background through from
  modelParams" test — which mocks `imaging.generateImage` entirely and
  never touches path resolution — is unaffected), `tests/server/projects-route.test.ts`.
- **New tests to write**:
  1. `agent-turn.test.ts`: a test asserting a freshly-created edit-
     sourced `Iteration.modelParams.referenceImages` (read back from the
     DB after the turn) contains the relative path, not an absolute one.
  2. `imaging.test.ts`: a containment-escape test at the
     `callOpenAiEdits` level — a `referenceImages` path that resolves
     outside the test-scoped `WORKSPACE_DIR` is rejected before any
     `fetch` call is made.
  3. `projects-route.test.ts` (or extend an existing test): `GET
     /api/projects/:id` for a project with an edit-sourced iteration
     returns a `modelParams.referenceImages` value containing no
     absolute path segment (e.g. does not start with `/` — or, on the
     test's actual `WORKSPACE_DIR`, does not contain that root's
     absolute prefix).
- **Verification command**: `npm test --prefix server` (full suite via
  `server/vitest.config.ts`).

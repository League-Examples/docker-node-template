---
id: '001'
title: 'Client: refresh iterations on successful generate_image completion'
status: done
use-cases:
- SUC-001
depends-on: []
github-issue: ''
issue: iterations-not-refreshed-after-generation.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Client: refresh iterations on successful generate_image completion

## Description

`handleToolCallFinished` in `client/src/pages/ProjectDetail/index.tsx`
currently only reacts to a successful `search_catalog` tool call. A
successful `generate_image` completion (new `Iteration` row + PNG landed
server-side) is silently ignored, so `OutputPane` keeps rendering the
iteration list fetched at page load and the user sees no new image
without a manual reload (observed live, project 14 "League of Mentors",
2026-07-17).

Add a `generate_image` branch to `handleToolCallFinished` that, on a
non-error completion, refetches the project via the page's existing
`loadProject()` (the same `GET /api/projects/:id` call already used on
mount) so `iterations` — and therefore the active stream — updates
immediately. Reuse `loadProject`/`setProject` rather than hand-mapping
the tool result's shape into `IterationDTO`, per sprint.md's Design
Rationale ("Full refetch vs. patch-in-place").

Parent sprint architecture: `clasi/sprints/007-iteration-refresh-and-agent-tool-context/sprint.md`
(SUC-001).

## Acceptance Criteria

- [x] A successful (`isError: false`) `generate_image` `tool_call_finished`
      event triggers a call to `loadProject()` (or equivalent refetch of
      `GET /api/projects/:id`).
- [x] The new iteration appears in the correct stream (`front`/`back`,
      per the project's `activeTab`) without any manual page reload.
- [x] A `generate_image` event with `isError: true` does **not** trigger
      a refetch.
- [x] Existing `search_catalog` handling (`setSearchCatalogMatches`) is
      unaffected — both branches coexist in the same handler.
- [x] No new SSE connection is opened; the refetch reuses the existing
      `GET /api/projects/:id` HTTP call, not a second stream.

## Testing

- **Existing tests to run**: `client` test suite covering
  `ProjectDetail/index.tsx` and `ChatPanel.tsx` (e.g.
  `npm test --workspace client` or the project's configured client test
  command) — confirm the existing `search_catalog` `tool_call_finished`
  test still passes unchanged.
- **New tests to write**:
  - A test that fires a `tool_call_finished` event with
    `name: 'generate_image'`, `isError: false` and a mocked
    `fetch(/api/projects/:id)` response containing a new iteration;
    assert `fetch` was called again and the rendered iteration list
    (or `iterations` state, depending on what's observable in the test
    harness) includes the new entry.
  - A test that fires the same event with `isError: true` and asserts no
    additional `fetch` call occurs beyond the initial page-load fetch.
  - A test that fires a `search_catalog` event immediately before/after
    a `generate_image` event, asserting both are handled independently
    (no branch clobbers the other's state).
- **Verification command**: the client project's configured test runner
  (see `client/package.json` `"test"` script) — do not assume
  `uv run pytest` for this ticket; this is a TypeScript/React change.

## Implementation Plan

- **Approach**: Extend the existing `if (name === 'search_catalog' ...)`
  check in `handleToolCallFinished` with an additional branch (or an
  `else if`) for `name === 'generate_image' && !isError`, calling
  `void loadProject()`. No new state, prop, or component is introduced.
- **Files to modify**:
  - `client/src/pages/ProjectDetail/index.tsx` — `handleToolCallFinished`.
  - Corresponding test file (e.g.
    `client/src/pages/ProjectDetail/index.test.tsx` or wherever the
    existing `search_catalog` handling is tested — locate via the
    existing test suite before adding new cases).
- **Testing plan**: see Testing section above; no server-side change in
  this ticket, so no server test changes expected.
- **Documentation updates**: update `index.tsx`'s existing module-header
  comment for `handleToolCallFinished` (currently states it only reacts
  to `search_catalog`) to describe the new `generate_image` behavior,
  consistent with the file's existing convention of documenting handler
  behavior inline.

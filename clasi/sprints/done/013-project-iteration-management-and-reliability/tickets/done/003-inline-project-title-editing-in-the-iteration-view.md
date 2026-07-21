---
id: '003'
title: Inline project title editing in the iteration view
status: done
use-cases:
- SUC-026
depends-on:
- '001'
github-issue: ''
issue: edit-project-title-inline.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Inline project title editing in the iteration view

## Description

Close `edit-project-title-inline.md`. The issue's stated file
(`client/src/pages/ProjectDetail/ProjectDetailsHeader.tsx`) is corrected
here (sprint.md Architecture § Codebase Alignment): that component
renders only `Project.detailsHeader`'s `style`/`outputType`/`goal`/
`description` fields — it never receives or renders `project.title`. The
actual project title is rendered by `client/src/pages/ProjectDetail/
index.tsx` line 265, as a static `<h1>{project.title}</h1>` inside the
fixed-top header row (alongside the back-link and `FaceTabs`).

There is also no existing REST path for a client to set a project's
`title` directly — `server/src/routes/projects.ts`'s `PATCH
/projects/:id` accepts only `status` today (the archive/restore
toggle). The only existing way to rename a project is the agent's
`create_project` chat tool (sprint 007).

This ticket:

1. Extends `PATCH /projects/:id` to also accept an optional `title`
   field, alongside its existing `status` field — both routed through
   the same existing pattern (read the current row for its `version`,
   then `catalogTools.createProject({ id, version, title?, status? })`).
   At least one of `title`/`status` must be present (today the route
   requires exactly a valid `status`).
2. Adds `version: number` to `client/src/pages/ProjectDetail/types.ts`'s
   `ProjectDetailDTO` — `GET /api/projects/:id` already returns it
   (Prisma's default `findUnique` returns every scalar column; only the
   client's TS type is missing it).
3. Adds a small inline-edit control to `index.tsx`'s title render site,
   replacing the static `<h1>` with a click-to-edit control: click
   enters edit mode (pre-filled with the current title), Enter/blur
   confirms and calls `PATCH /api/projects/:id` with the new `title` and
   the project's current `version`, Escape cancels with no network call.
   On success, update local state so the header shows the new title
   without a full reload; on a 409 (stale version / concurrent edit),
   revert to the last-known-good title and surface a plain error.

## Acceptance Criteria

- [x] `PATCH /projects/:id` accepts an optional `title` (non-empty
      string) in addition to its existing optional `status`; at least
      one of the two must be present in the request body (a request
      with neither is a 400, matching the existing validation style).
- [x] `PATCH /projects/:id`'s handler reads the current row for its
      `version` (as it already does for the `status` path) and calls
      `catalogTools.createProject({ id, version, title?, status? })` —
      no new route, no new `catalogTools.ts` function.
- [x] A concurrent-edit version conflict on this route still surfaces as
      the existing `VersionConflictError` -> 409, unchanged.
- [x] `ProjectDetailDTO` (`client/src/pages/ProjectDetail/types.ts`)
      declares `version: number`.
- [x] Clicking the project title in `index.tsx`'s header row makes it
      editable (a text input, pre-filled with the current title, ideally
      auto-focused/selected).
- [x] Confirming an edit (Enter, or blur) calls `PATCH
      /api/projects/:id` with the new `title` and the current `version`,
      and on success updates the rendered title without a full page
      reload.
- [x] Pressing Escape (or otherwise cancelling) reverts the field to the
      original title and makes no network call.
- [x] A 409 response reverts the displayed title to its last-known-good
      value and surfaces a plain, visible error (matching this page's
      existing error-surfacing style, e.g. the PDF-generation error
      state already in `index.tsx`).
- [x] Full existing test suite passes; no other project-detail behavior
      regresses.

## Testing

- **Existing tests to run**: `tests/server/projects-route.test.ts` (in
  full, for the `PATCH /projects/:id` route), plus the client test
  suite covering `client/src/pages/ProjectDetail/`.
- **New tests to write**:
  1. Server: `projects-route.test.ts` — `PATCH /projects/:id` with
     `{ title }` alone succeeds and persists; with `{ title, status }`
     both together succeeds; with neither present returns 400; with a
     stale `version` (or omitted where required) returns 409 via the
     existing `VersionConflictError` mapping.
  2. Client: a test for the new inline-edit component/flow — clicking
     the title enters edit mode; confirming calls `PATCH` with the
     expected body and updates the rendered title; Escape cancels with
     no fetch call; a non-OK response reverts the displayed title and
     shows an error.
- **Verification command**: `npm test --prefix server` for the server
  suite; the client project's configured test command (`npm test
  --prefix client`, or equivalent per `client/vitest.config.ts`/
  `package.json`) for the new component test.

## Implementation Plan

### Approach

1. **Server**: in `routes/projects.ts`'s `PATCH /projects/:id` handler
   (lines ~425-453), relax body validation to accept `title` (a
   non-empty, trimmed string) and/or `status` (`'active'`/`'archived'`
   as today), requiring at least one; pass whichever are present into
   the existing `createProject({ id, version: existing.version, ... })`
   call.
2. **Client type**: add `version: number` to `ProjectDetailDTO`.
3. **Client component**: add a small new component (e.g.
   `client/src/pages/ProjectDetail/EditableProjectTitle.tsx`) that
   receives the current `title`/`version`/`projectId` and an `onSaved`
   callback; owns its own local edit-mode/draft-text state; on
   confirm, `PATCH`es and calls `onSaved` with the updated project (or
   just the new title) on success. `index.tsx` renders this in place of
   the static `<h1>{project.title}</h1>` (line 265) and wires
   `onSaved` to update its own `project` state, mirroring the existing
   `handleIterationsChange`/`handleReferenceAdded` local-state-update
   pattern already used elsewhere in that file.

### Files to Create/Modify

- **Create**: `client/src/pages/ProjectDetail/EditableProjectTitle.tsx`
  (or equivalent name).
- **Modify**: `server/src/routes/projects.ts` (`PATCH /projects/:id`),
  `client/src/pages/ProjectDetail/types.ts` (`ProjectDetailDTO`),
  `client/src/pages/ProjectDetail/index.tsx` (title render site).

### Testing Plan

See Testing above.

### Documentation Updates

- `routes/projects.ts`'s existing comment above the `PATCH
  /projects/:id` handler (documenting it as the archive/restore toggle
  only) should be updated to describe its broadened scope (title and/or
  status).

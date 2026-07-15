---
id: '006'
title: 'API Gateway: projects.ts (CRUD, references, iteration-state) + chat/postcards
  auth-gate relaxation'
status: done
use-cases:
- SUC-003
- SUC-004
- SUC-005
- SUC-007
- SUC-008
- SUC-009
- SUC-010
- SUC-011
depends-on:
- '001'
- '002'
github-issue: ''
issue: real-two-pane-app.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# API Gateway: projects.ts (CRUD, references, iteration-state) + chat/postcards auth-gate relaxation

## Description

Two parts, sequenced together because both complete the API Gateway
module's route surface for a normal (non-admin) authenticated user.

**Part A — new `server/src/routes/projects.ts`**:
- `GET /api/projects?view=mine|all|archive` — list, filtered by owner
  (`view=mine`) or `status` (`view=archive`); `view=all` returns every
  user's projects (shared-trust model, architecture-001 Security
  Considerations — no per-user isolation below USER/ADMIN).
- `GET /api/projects/:id` — returns the project row **plus its
  `iterations`, `references`, and `chatMessages` in one response**. This
  is important and was tightened during architecture review: without
  `chatMessages` in this response, reopening a project would leave the
  chat panel blank until a second, separate fetch — `GET /api/projects/:id`
  must be the single source that rehydrates the whole `ProjectDetail`
  page (output pane + chat history + references) on load.
- `POST /api/projects` — calls ticket 002's `create_project` tool
  in-process (Sprint 004's `postcards.ts` precedent: call the Workspace
  MCP Server's tool function in-process, never write Prisma directly —
  see architecture-update.md **R1**). When the request body includes
  `sourceAssetId` (the library-asset-to-project flow, SUC-011), also
  calls `add_reference` (ticket 002) immediately after creation so the
  new project's reference strip is pre-populated with the source asset.
- `POST /api/projects/:id/references` / `DELETE /api/projects/:id/
  references/:refId` — call `add_reference`/`remove_reference` (ticket
  002).
- `PATCH /api/projects/:id/iterations/:iterId` — calls
  `set_iteration_state` (ticket 002), body `{ accepted?: boolean, role?:
  'front' | 'back' | null }`.

Every write handler in this file calls a Workspace MCP Server tool
function in-process — never raw Prisma — per **R1**.

**Part B — `chat.ts`/`postcards.ts` auth-gate relaxation**: both files'
existing routes are gated `requireAuth + requireAdmin`, explicitly
documented in both files' own header comments as a **temporary
test-harness posture** pending "the real client UI" (Sprint 003/004's own
words). Remove `requireAdmin` from both — `requireAuth` alone, matching
every other route in this sprint and architecture-001's already-documented
shared-trust model. No other line in either file changes.

## Acceptance Criteria

- [x] `GET /api/projects?view=mine` returns only the requesting user's
      non-archived projects; `view=all` returns every user's; `view=archive`
      returns only `status: 'archived'` projects.
- [x] `GET /api/projects/:id` response includes `iterations`, `references`,
      and `chatMessages` — verify a project with prior chat history
      returns those messages in the same response (no second endpoint
      needed).
- [x] `POST /api/projects` with no `sourceAssetId` creates a project via
      the `create_project` tool (verify no direct `prisma.project.create`
      call in this file).
- [x] `POST /api/projects` with `sourceAssetId` creates the project *and*
      a `Reference` row pointing at that asset in the same request (one
      round trip for SUC-011's "clicking a Library asset creates a
      project ... reference strip already shows the source asset").
- [x] `POST`/`DELETE /api/projects/:id/references[/:refId]` round-trip
      correctly through `add_reference`/`remove_reference`.
- [x] `PATCH /api/projects/:id/iterations/:iterId` round-trips through
      `set_iteration_state`, including the exclusivity behavior (verify
      via an integration test, not just unit-testing the tool in
      isolation).
- [x] `chat.ts` and `postcards.ts`'s routes are `requireAuth`-only —
      a non-admin authenticated user can start a chat turn and submit/
      request a postcard PDF. **Update the existing tests in both files
      that asserted `requireAdmin` gating** to reflect the new,
      intentionally wider gate (do not leave them passing against a
      narrower gate than production now has).
- [x] Every write handler in `projects.ts` is verified (by code
      inspection in the PR/ticket notes, or a targeted test) to call a
      Workspace MCP Server tool function, not raw Prisma.

## Implementation Plan

**Approach**: `projects.ts` mirrors `postcards.ts`'s existing structure
exactly (Express router, `requireAuth`, call an in-process tool function,
map its errors to HTTP status codes). The auth-gate change is a one-line
removal in each of two existing files.

**Files to create**:
- `server/src/routes/projects.ts`.
- Test file covering Part A's acceptance criteria.

**Files to modify**:
- `server/src/app.ts` — mount `projectsRouter` under `/api`.
- `server/src/routes/chat.ts` — remove `requireAdmin` from the route
  definition.
- `server/src/routes/postcards.ts` — remove `requireAdmin` from both
  route definitions.
- `tests/server/chat-route.test.ts`, `tests/server/postcard-pdf-route.test.ts`
  (or wherever the existing `requireAdmin` assertions live) — update to
  the new gate.

**Testing plan**: New `projects.ts` test file covering list/get/create
(with and without `sourceAssetId`)/references/iteration-state, each
verified to go through the corresponding tool function (mock/spy on the
tool, or assert on `Lock`/`Reference`/`Iteration` row side effects).
Non-admin-authenticated-user tests added to the existing `chat.ts`/
`postcards.ts` suites, alongside removal of any test that specifically
required admin.

**Documentation updates**: Update `chat.ts`/`postcards.ts`'s header
comments (both currently say "no production chat UI consumes this route
yet" / "no client UI consumes this route yet — Sprint 005 wires one in")
to reflect that Sprint 005 has now done so.

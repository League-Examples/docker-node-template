---
status: approved
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 002 — Use Cases

Sprint-level use cases (SUC-NNN), each tracing to a parent use case in
`docs/design/usecases.md` and to architecture-001's module design. Sprint
002 delivers no new stakeholder-facing flow directly — it is the
persistence, indexing, and tooling foundation the UI/agent sprints
(003-005) build on. Each SUC below states the capability this sprint
makes possible, and which parent UC(s) become buildable once it exists.

---

## SUC-001: Persist projects, subprojects, and iteration history

Parent: UC-003, UC-006, UC-009

- **Actor**: System (schema/persistence layer), consumed by later sprints.
- **Preconditions**: None — first schema work in the project.
- **Main Flow**:
  1. `Project` model exists with `parentProjectId` self-relation,
     `ownerUserId`, `detailsHeader` JSON, `status`, and `version` (optimistic
     lock).
  2. `Iteration` model exists with `projectId`, `seq`, `imagePath`,
     `promptUsed`, `modelParams` JSON, `createdAt`.
  3. No update path exists that overwrites `imagePath` on an existing
     `Iteration` row — inserts only.
- **Postconditions**: A project can be created, given subprojects via
  `parentProjectId`, and accumulate an append-only iteration history.
- **Acceptance Criteria**:
  - [ ] Creating a project, then three iterations against it, leaves all
        three iterations queryable with distinct `seq` values.
  - [ ] A second `Project` row with `parentProjectId` pointing at the
        first is a valid subproject relation.
  - [ ] No Prisma-level update operation exists that would set an
        existing `Iteration.imagePath` to a new value.

## SUC-002: Persist collections, assets, and the auto-description schema

Parent: UC-002, UC-008

- **Actor**: System (schema/persistence layer).
- **Preconditions**: None.
- **Main Flow**:
  1. `Collection`, `Asset`, and `AssetDescription` models exist.
  2. `AssetDescription` carries `isPhotograph`, `isLogo`, `style`,
     `peopleReal` (real|ai|none|unknown), `description` (text), `tags`
     (JSON array) — a nullable 1:1 relation to `Asset`.
  3. No description-generation logic ships this sprint (Sprint 004
     writes to this table); the schema only needs to accept a null
     `AssetDescription` cleanly.
- **Postconditions**: An asset can be committed to a collection and
  remain queryable/browsable even with no description yet.
- **Acceptance Criteria**:
  - [ ] An `Asset` can be created with no `AssetDescription` row and
        remains queryable by `path`.
  - [ ] Attaching an `AssetDescription` later does not require deleting
        or recreating the `Asset` row.

## SUC-003: Persist the single polymorphic knowledge store with correction history

Parent: UC-005, UC-007

- **Actor**: System (schema/persistence layer); seed-data import job.
- **Preconditions**: Predecessor `marketing` repo's `app/prompts/*` and
  `app/layouts/*` files are readable at import time.
- **Main Flow**:
  1. One `KnowledgeEntry` table exists with a `kind` discriminator
     (style|palette|composition|layout|rule|guardrail), `bodyText`,
     `structuredFields` JSON, `version` (optimistic lock).
  2. `KnowledgeCorrection` exists with `entryId`, `proposedByUserId`,
     `contextProjectId`, `diff` (unified diff text), `status`
     (pending|accepted|rejected).
  3. A one-time import job seeds real `KnowledgeEntry` rows from the
     predecessor's style/layout `.md` files (at minimum `pop-art`,
     `manga`, `flat-poster`, plus the layout definitions).
- **Postconditions**: The knowledge store is non-empty and structurally
  ready for correction proposals before Sprint 003's agent runtime exists.
- **Acceptance Criteria**:
  - [ ] Querying `KnowledgeEntry` where `kind = 'style'` returns at least
        `pop-art`, `manga`, and `flat-poster` with non-empty `bodyText`.
  - [ ] Creating a `KnowledgeCorrection` against an entry does not change
        that entry's `bodyText` or `version` until the correction's
        `status` transitions to `accepted`.

## SUC-004: Semantic and keyword search over knowledge and asset content

Parent: UC-014, UC-005

- **Actor**: System (indexing layer).
- **Preconditions**: SUC-002 and SUC-003 schemas exist and are seeded.
- **Main Flow**:
  1. `Embedding` table exists (`ownerType`, `ownerId`, `vector` blob,
     `model`, `createdAt`).
  2. A `sqlite-vec` `vec0` virtual table provides KNN queries over
     `Embedding.vector`.
  3. An `FTS5` virtual table indexes `AssetDescription.description`/
     `tags` and `KnowledgeEntry.bodyText`/`name`.
  4. Both index types are reachable through one Catalog Store
     search-function interface; callers do not need to know which index
     answered a given query.
  5. A brute-force in-memory cosine-similarity implementation exists
     behind the same interface as a fallback if `sqlite-vec` is
     unavailable on the deployment target.
- **Postconditions**: A nearest-neighbor or keyword query against seeded
  `KnowledgeEntry` content returns correct, ranked results via either
  index path.
- **Acceptance Criteria**:
  - [ ] Seeding two `KnowledgeEntry` rows with known embeddings and
        querying for a third, closer-to-one-than-the-other vector returns
        the closer row first via `sqlite-vec`.
  - [ ] The same query against the brute-force fallback path (toggled by
        a test-only flag) returns the same top result.
  - [ ] An `FTS5` query for a distinctive word in a seeded style's
        `bodyText` returns that style.

## SUC-005: Workspace filesystem layout with DB-canonical directory descriptors

Parent: UC-011 (precondition only — the MCP server that writes here is
Sprint 003)

- **Actor**: System (filesystem scaffolding).
- **Preconditions**: None.
- **Main Flow**:
  1. The `workspace/` tree (`assets/`, `knowledge/`, `projects/`,
     `exports/`) exists on disk with initial category subdirectories
     matching architecture-001's File-System Layout.
  2. `WorkspaceDirectory` rows are canonical (architecture-001 D6); a
     `_dir.json` mirror is written to the corresponding filesystem path
     by a sync utility.
  3. No MCP tool exists yet to mutate this tree — Sprint 003 calls this
     sprint's sync utility from its own tool implementations.
- **Postconditions**: The workspace tree and its DB-to-file sync
  mechanism exist and are unit-tested in isolation from any agent/MCP
  code.
- **Acceptance Criteria**:
  - [ ] Creating a `WorkspaceDirectory` row produces a matching
        `_dir.json` file at the expected path with matching
        `descriptorJson` content.
  - [ ] Moving/renaming a `WorkspaceDirectory` row's `path` updates the
        `_dir.json` location accordingly (no orphaned files left behind).

## SUC-006: Single-command, reliable test suite for process gating

Parent: none directly — internal tooling capability required by every
subsequent sprint's `close_sprint` gate.

- **Actor**: Developer/CI, CLASI `close_sprint` tooling.
- **Preconditions**: Existing `npm run test:server` and
  `npm run test:client` scripts pass independently.
- **Main Flow**:
  1. A root `npm test` script chains both suites as one shell-quoting-free
     token.
  2. The `admin-sessions.test.ts` "returns 403 for non-admin" intermittent
     timeout is reproduced, root-caused, and fixed or structurally
     mitigated (e.g. per-worker test databases if the cause is shared-DB
     write contention).
- **Postconditions**: `npm test` is safe to pass as a single
  `test_command` token to `close_sprint` for this and all future sprints.
- **Acceptance Criteria**:
  - [ ] `npm test` exits 0 on a clean tree in one invocation.
  - [ ] `admin-sessions.test.ts`'s "returns 403 for non-admin" case passes
        20 consecutive full-suite runs (`vitest run --repeat=20` or
        equivalent loop).

## SUC-007: Rebranded, sidebar-free app shell

Parent: UC-001 (the shell the user lands in immediately after login)

- **Actor**: Any authenticated user.
- **Preconditions**: UC-001 (Google login) already works (Sprint 001).
- **Main Flow**:
  1. Template branding (`docker-nodeapp` `package.json` name,
     `APP_NAME`/`APP_SLUG` = "League Web App"/"join-the-web-app", page
     titles) is replaced with Flyerbot branding.
  2. The demo `Counter` model, its API route, and any remaining UI
     references are removed.
  3. `AppLayout.tsx`'s fixed 240px dark sidebar is replaced with a top
     bar/hamburger menu, preserving the account dropdown and admin-role
     link.
- **Postconditions**: The authenticated shell is rebranded and has no
  fixed sidebar competing for screen width with Sprint 005's two-pane
  layout.
- **Acceptance Criteria**:
  - [ ] No `docker-nodeapp` or "League Web App" string remains anywhere
        in `client/` or `server/` source or config.
  - [ ] `Counter` model, route, and UI are gone; no dangling references
        in tests or seed data.
  - [ ] `AppLayout.test.tsx` passes against the new top-bar markup.

---

## Coverage Summary

| SUC | Parent UC(s) | Delivered by issue |
|---|---|---|
| SUC-001 | UC-003, UC-006, UC-009 | `foundation-schema-and-knowledge-store.md` |
| SUC-002 | UC-002, UC-008 | `foundation-schema-and-knowledge-store.md` |
| SUC-003 | UC-005, UC-007 | `foundation-schema-and-knowledge-store.md` |
| SUC-004 | UC-014, UC-005 | `foundation-schema-and-knowledge-store.md` |
| SUC-005 | UC-011 (precondition) | `foundation-schema-and-knowledge-store.md` |
| SUC-006 | (internal tooling) | `add-combined-npm-test-script.md`, `flaky-admin-sessions-test.md` |
| SUC-007 | UC-001 (shell) | `rebrand-to-flyerbot.md`, `move-app-shell-sidebar-to-top-menu.md` |

No parent use case is fully closed by Sprint 002 alone — UC-002, UC-005,
and UC-006 through UC-014 all remain open until Sprints 003-005 add the
runtime, MCP server, and UI that consume this sprint's persistence layer.
This is expected and tracked, not a gap in this sprint's scope.

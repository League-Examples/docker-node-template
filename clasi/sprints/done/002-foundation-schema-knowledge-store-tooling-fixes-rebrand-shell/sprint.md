---
id: '002'
title: 'Foundation: Schema, Knowledge Store, Tooling Fixes, Rebrand & Shell'
status: closed
branch: sprint/002-foundation-schema-knowledge-store-tooling-fixes-rebrand-shell
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
- SUC-005
- SUC-006
- SUC-007
issues:
- add-combined-npm-test-script.md
- flaky-admin-sessions-test.md
- rebrand-to-flyerbot.md
- move-app-shell-sidebar-to-top-menu.md
- foundation-schema-and-knowledge-store.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 002: Foundation: Schema, Knowledge Store, Tooling Fixes, Rebrand & Shell

## Goals

Lay every foundation later sprints build on, with zero product-visible
surface yet: the Prisma/SQLite domain schema from architecture-001 (projects,
iterations, assets, collections, the single polymorphic `KnowledgeEntry`
store, corrections, chat transcripts, locking columns), the workspace
filesystem layout with `_dir.json` descriptors, vector + full-text indexing
(`sqlite-vec` with a brute-force-cosine fallback, `FTS5`), and seed data
imported from the predecessor `marketing` repo's styles/layouts. Alongside
that: two small but load-bearing tooling fixes (a combined `npm test`
script; the flaky `admin-sessions` test), because every ticket in every
subsequent sprint depends on a green, reliable test suite before commit.
Finally, clear the last template/demo debris (rebrand, sidebar-to-top-menu)
so the app shell is ready to host the two-pane layout in Sprint 005 without
further shell rework competing for attention.

## Problem

Nothing in architecture-001's domain model exists in the codebase yet —
there is no `Project`, `Asset`, `KnowledgeEntry`, or vector index, only the
untouched template schema (`Config`, `User`, `UserProvider`, `ScheduledJob`,
`Counter`, `Session`). Sprint 001 fixed auth and produced wireframes but
deliberately left the domain undesigned. Separately, the CLASI process
itself is currently unreliable in this repo: `close_sprint`'s
`test_command` can't run compound test commands, and one server test hangs
intermittently — both of which will bite every future sprint close if not
fixed now. The app also still carries template branding (`docker-nodeapp`,
"League Web App") and a full dark sidebar that the two-pane layout has no
room for.

## Solution

- Extend `server/prisma/schema.prisma` additively with the twelve new
  models from architecture-001's Data Model (`Project`, `Iteration`,
  `ChatMessage`, `Reference`, `Collection`, `Asset`, `AssetDescription`,
  `KnowledgeEntry`, `KnowledgeCorrection`, `Embedding`, `WorkspaceDirectory`,
  `Lock`), leaving `Config`/`User`/`UserProvider`/`ScheduledJob`/`Session`
  untouched and removing the demo-only `Counter` model.
- Stand up the `workspace/` filesystem tree (`assets/`, `knowledge/`,
  `projects/`, `exports/`) with `WorkspaceDirectory` as the DB-canonical
  source and `_dir.json` as a derived mirror (architecture-001 D6).
- Add `sqlite-vec` as a loadable extension for the `Embedding` table's KNN
  queries, with a brute-force in-memory cosine-similarity fallback behind
  the same search-function interface (D1), plus an `FTS5` virtual table
  over descriptions/tags/knowledge body text.
- Write a one-time import job seeding `KnowledgeEntry` rows (styles,
  palettes, compositions, layouts) from the predecessor `marketing` repo's
  `app/prompts/*` and `app/layouts/*` `.md` files, so later sprints have
  real style data to prompt-assemble against instead of an empty store.
- Add a root `npm test` script chaining server + client suites into one
  token-passable command; investigate and fix the `admin-sessions.test.ts`
  flake (likely SQLite/session-store write contention under concurrent
  vitest workers).
- Rebrand: `package.json` name, `APP_NAME`/`APP_SLUG`, page titles; remove
  the `Counter` API/model/seed leftovers now that no UI references them;
  confirm GitHub/password Passport strategies are fully removed per spec
  §13 (Sprint 001 scope, verified not re-litigated here).
- Rework `AppLayout.tsx`: replace the fixed 240px sidebar with a top
  bar/hamburger menu, freeing the left edge for the collapsible asset-
  browser overlay Sprint 005 will add.

## Success Criteria

- `npx prisma migrate dev` applies cleanly; all new models exist with the
  relations and optimistic-lock `version` columns architecture-001
  specifies.
- A vector similarity query and an `FTS5` query both return correct
  results against seeded `KnowledgeEntry` rows, exercising both the
  `sqlite-vec` path and the brute-force fallback path.
- Seed data contains recognizable styles from the predecessor (at least
  `pop-art`, `manga`, `flat-poster`) as real `KnowledgeEntry` rows with
  non-empty `bodyText`.
- `npm test` (single command, root `package.json`) runs both server and
  client suites and exits 0 on a clean tree.
- `admin-sessions.test.ts`'s "returns 403 for non-admin" case passes
  reliably across 20 consecutive full-suite runs (or the flake's root
  cause is documented with a committed structural fix, e.g. per-worker
  test DBs).
- No `docker-nodeapp`/"League Web App" strings remain in `package.json`,
  page titles, or `APP_NAME`/`APP_SLUG` config; `Counter` model, route,
  and UI are gone.
- `AppLayout.tsx` renders a top bar/hamburger instead of the fixed
  sidebar; `AppLayout.test.tsx` passes against the new shell.

## Scope

### In Scope

- Prisma schema additions (all 12 new models) + migration.
- Workspace filesystem scaffolding + `WorkspaceDirectory`/`_dir.json` sync.
- `sqlite-vec` + `FTS5` indexing with fallback.
- Predecessor style/layout seed-data import job.
- Combined `npm test` script.
- `admin-sessions.test.ts` flake fix.
- Rebrand cleanup (naming, `Counter` removal, auth-strategy verification).
- `AppLayout.tsx` sidebar-to-top-menu rework.

### Out of Scope

- Any agent runtime, MCP server, or chat functionality (Sprint 003).
- Image generation or vision/description calls (Sprint 004).
- Wiring the real two-pane UI to live data (Sprint 005) — the mockup
  pages under `client/src/pages/mockups/` are untouched this sprint.
- Git/GitHub versioning of workspace content (Sprint 003, alongside the
  MCP server that triggers it).

## Test Strategy

Unit/integration tests for each new Prisma model's CRUD paths and the
optimistic-locking `version` bump behavior; a dedicated test asserting
vector search and FTS5 search both return the seeded styles for known
queries, and that the fallback path produces the same ranking order (or a
documented acceptable difference) as `sqlite-vec` when the extension is
unavailable. `AppLayout.test.tsx` updated for the new top-bar markup. The
flaky-test fix must include a repeated-run regression check (e.g. `vitest
run admin-sessions --repeat=20`) captured in the ticket's testing notes,
not just a single green run.

## Architecture Notes

Implements architecture-001's Data Model, Indexing Strategy, and
File-System Layout sections in full; this sprint does not revise
architecture-001, only builds against it. See
`architecture-update.md` (written during detail planning) for anything
that turns out to need a scoped addendum once implementation specifics
(e.g. `sqlite-vec` platform coverage per architecture-001 Open Question 1)
are confirmed.

## GitHub Issues

None yet — this sprint's issues are CLASI-internal (`clasi/issues/`), not
yet mirrored to GitHub.

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [ ] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [ ] Architecture review passed
- [ ] Stakeholder has approved the sprint plan

## Tickets

| # | Title | Depends On |
|---|-------|------------|
| 001 | Add combined npm test script | — |
| 002 | Fix flaky admin-sessions test | 001 |
| 003 | Prisma schema: domain models for projects, assets, and the knowledge store | 001, 002 |
| 004 | Workspace filesystem scaffold and WorkspaceDirectory/_dir.json sync | 003 |
| 005 | Vector and full-text indexing: sqlite-vec + FTS5 with brute-force fallback | 003 |
| 006 | Predecessor knowledge seed import job | 003 |
| 007 | Rebrand template to Flyerbot and remove Counter demo leftovers | 003 |
| 008 | Move AppLayout sidebar to a top menu / hamburger | 007 |

Tickets execute serially in the order listed.

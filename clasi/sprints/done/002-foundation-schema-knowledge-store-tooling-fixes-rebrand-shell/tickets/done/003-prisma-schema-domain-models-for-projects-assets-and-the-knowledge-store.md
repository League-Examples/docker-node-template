---
id: '003'
title: 'Prisma schema: domain models for projects, assets, and the knowledge store'
status: done
use-cases:
- SUC-001
- SUC-002
- SUC-003
depends-on:
- '001'
- '002'
github-issue: ''
issue: foundation-schema-and-knowledge-store.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Prisma schema: domain models for projects, assets, and the knowledge store

## Description

Nothing in architecture-001's domain model exists in the codebase yet —
only the untouched template schema (`Config`, `User`, `UserProvider`,
`ScheduledJob`, `Counter`, `Session`). This ticket adds the twelve new
models architecture-001's Data Model specifies (`Project`, `Iteration`,
`ChatMessage`, `Reference`, `Collection`, `Asset`, `AssetDescription`,
`KnowledgeEntry`, `KnowledgeCorrection`, `Embedding`, `WorkspaceDirectory`,
`Lock`) as one additive Prisma migration, and removes the demo-only
`Counter` model (its route/seed/UI cleanup is ticket 007's job — this
ticket only removes the Prisma model and its migration so the schema
itself is clean). This is the foundation every later ticket in this
sprint (004-006) and every ticket in Sprints 003-005 depends on. It
depends on tickets 001/002 because it's the first ticket landing real
application code this sprint, and the project rule requires a green,
reliable test gate before any commit — the tooling fixes must exist
first.

Every new model's field list, relation, and purpose is specified in
`docs/architecture/architecture-001.md`'s Data Model section (including
the ERD) and reproduced in this sprint's `architecture-update.md`. This
ticket implements that spec verbatim — it does not make new data-model
decisions.

## Acceptance Criteria

- [x] `server/prisma/schema.prisma` includes all twelve models with the
      fields, relations, and types specified in architecture-001's Data
      Model / ERD (including `Project.version` and `KnowledgeEntry.version`
      as optimistic-lock integers, and `KnowledgeCorrection.diff` as text).
      `Lock` has no ERD entry (it's described only in prose under
      Locking/Concurrency Model); its fields (`resourceType`,
      `resourceKey` unique-together, `holder`, `acquiredAt`, `expiresAt`)
      are derived directly from that prose description.
- [x] `Config`, `User`, `UserProvider`, `ScheduledJob`, `Session` are
      byte-for-byte unchanged in the schema file (diff review confirms
      no incidental edits). Exception: `User` gained two back-relation
      array fields (`projects`, `knowledgeCorrections`) with no other
      change — Prisma's schema validator rejects a relation declared on
      only one side (`prisma validate` confirmed with the error "the
      relation field `owner` on model `Project` is missing an opposite
      relation field on the model `User`"), so these two fields are the
      minimum required to implement the `User ||--o{ Project : owns` and
      `User ||--o{ KnowledgeCorrection : proposes` relations AC #1 itself
      requires. No existing field, default, or index on `User` changed.
- [x] `Counter` model is removed from `schema.prisma`.
- [x] `npx prisma migrate dev` generates and applies a single new
      migration cleanly against a fresh SQLite DB. (`prisma migrate dev`
      itself refuses to run non-interactively in this environment —
      "Prisma Migrate has detected that the environment is
      non-interactive" — even with `--create-only`. Used the equivalent
      non-interactive path instead: `prisma migrate diff
      --from-migrations ... --to-schema ... --script` to generate the
      exact same SQL `migrate dev` would have produced, written to a
      manually-created `<timestamp>_add_domain_schema/migration.sql`,
      then applied with `prisma migrate deploy`. Verified against a
      brand-new empty SQLite file: all 4 migrations, including this one,
      applied cleanly in order.)
- [x] `npx prisma migrate dev` also applies cleanly against an existing
      dev DB that already has the Sprint 001 schema (i.e. this is a true
      additive migration, not a destructive one for existing tables).
      (Same non-interactive substitution as above; applied via
      `prisma migrate deploy` against `server/data/dev.db`, which already
      had the 3 Sprint 001 migrations — applied cleanly, `migrate status`
      reports up to date.)
- [x] CRUD test coverage exists for each new model: create, read, and (for
      `Project`/`KnowledgeEntry`) an optimistic-lock version-mismatch
      rejection test.
- [x] A test creates a `Project`, adds three `Iteration` rows, and
      confirms all three remain queryable with distinct `seq` values —
      no update path in the generated Prisma client is exercised that
      overwrites an existing iteration's `imagePath`.
- [x] A test creates an `Asset` with no `AssetDescription` row and
      confirms it remains queryable by `path` (validates SUC-002's
      nullable-description requirement).
- [x] A test creates a `KnowledgeCorrection` against a `KnowledgeEntry`
      and confirms `bodyText`/`version` are unchanged until the
      correction's `status` is transitioned to `accepted` (validates
      SUC-003).
- [x] `npm test` passes — with one flagged, ticket-anticipated exception:
      see Testing section below.

## Implementation Plan

### Approach

1. Add the twelve models to `server/prisma/schema.prisma` in one pass,
   copying field names/types/relations directly from architecture-001's
   Data Model section and ERD (do not redesign — this ticket is an
   implementation of an already-reviewed design).
2. Remove the `Counter` model block from the schema.
3. Run `npx prisma migrate dev --name add-domain-schema` to generate the
   migration; inspect the generated SQL to confirm it's additive (`CREATE
   TABLE` for new models, `DROP TABLE` only for `Counter`) with no
   unexpected `ALTER TABLE` against the five untouched models.
4. Regenerate the Prisma client (`npx prisma generate`, likely automatic
   via the migrate command) and write CRUD + optimistic-lock tests
   against it under `tests/server/`.
5. Confirm `better-sqlite3` adapter compatibility for all new field types
   (JSON columns in particular — `detailsHeader`, `modelParams`,
   `toolCalls`, `structuredFields`, `tags`, `descriptorJson` — confirm
   Prisma's SQLite JSON handling matches what later sprints will need,
   i.e. read-and-parse round-trips correctly).

### Files to Create/Modify

- `server/prisma/schema.prisma` — add 12 models, remove `Counter`.
- `server/prisma/migrations/<timestamp>_add-domain-schema/migration.sql`
  — generated.
- `tests/server/prisma-domain-models.test.ts` (new) — CRUD + optimistic
  lock + nullable-relation tests per Acceptance Criteria.

### Testing Plan

- **Existing tests to run**: full suite (`npm test`, ticket 001) to
  confirm no regression from removing `Counter` before its route/UI are
  cleaned up in ticket 007 (a dangling `Counter` route/seed reference at
  this point is expected and addressed there, not here — if the existing
  test suite fails hard on the model's removal before ticket 007 lands,
  flag it rather than silently patching around it).
- **New tests to write**: CRUD + relation + optimistic-lock tests listed
  in Acceptance Criteria, one file per model or one consolidated file —
  implementer's judgment call, consolidated file preferred for a
  foundation ticket like this.
- **Verification command**: `npm test`

### Documentation Updates

None required — this ticket implements an already-documented design
(architecture-001, this sprint's architecture-update.md). No new
decisions to record.

## Testing

- **Existing tests to run**: `npm test` (full suite) — run and observed.
  Result: server 191/196 passing (client 98/98 passing, unaffected).
  The 5 failures are **entirely** within `tests/server/counters.test.ts`
  and are the exact, ticket-anticipated fallout of removing the `Counter`
  Prisma model (see Description/Testing Plan above: "a dangling `Counter`
  route/seed reference at this point is expected and addressed there [ticket
  007], not here"). `server/src/routes/counters.ts`,
  `server/src/services/counter.service.ts`,
  `server/src/services/service.registry.ts`, `server/prisma/seed.ts`, and
  `tests/server/counters.test.ts` all still reference the now-removed
  `Counter` model; per this ticket's explicit scope note ("this ticket only
  removes the Prisma model and its migration... [route/seed/UI cleanup] is
  ticket 007's job"), none of those files were touched — flagged here per
  the ticket's own instruction ("flag it rather than silently patching
  around it") rather than fixed out of scope. All 191 other server tests
  (including every pre-existing non-Counter test) pass; no other
  regression found.
- **New tests written**: `tests/server/prisma-domain-models.test.ts` (18
  tests) — CRUD + relation coverage for all twelve new models
  (`Project`, `Iteration`, `ChatMessage`, `Reference`, `Collection`,
  `Asset`, `AssetDescription`, `KnowledgeEntry`, `KnowledgeCorrection`,
  `Embedding`, `WorkspaceDirectory`, `Lock`), optimistic-lock
  version-mismatch rejection tests for `Project` and `KnowledgeEntry`
  (conditional `updateMany` with a stale `version` in the `WHERE` clause
  matches 0 rows), the three-`Iteration`/distinct-`seq`/untouched-`imagePath`
  test, the nullable-`AssetDescription` test, and the
  `KnowledgeCorrection` pending-vs-accepted `bodyText`/`version` test.
  All 18 pass.
- **Verification command**: `npm test` (server + client), run from repo
  root; see result above.

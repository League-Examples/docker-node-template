---
id: '001'
title: Iteration accepted/role schema migration
status: open
use-cases:
- SUC-007
- SUC-010
depends-on: []
github-issue: ''
issue: real-two-pane-app.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Iteration accepted/role schema migration

## Description

Add two additive columns to `Iteration`: `accepted Boolean @default(false)`
and `role String?` (values `'front' | 'back'`, otherwise `null`). This
resolves Sprint 004's own Open Question 2 (`docs/architecture/
architecture-update-004.md`, R3/Open Question 2), which deliberately kept
front/back/accepted state inside `postcard-content.json` only and
explicitly deferred promoting it to real columns to "whichever sprint has
the real UI requirements in hand." That sprint is this one: the
project-list home page's hero-image rule (stakeholder round 6) needs "the
most recently accepted iteration" for every project kind, not just
postcards, and JSON-only storage cannot answer that without a
per-project-kind branch and a filesystem read per project.

See `clasi/sprints/005-real-two-pane-app/architecture-update.md` Step 3
(Catalog & Knowledge Store) and Design Rationale **R4** for the full
reasoning, alternatives considered, and the note that `Iteration.role`
uniqueness (only one `'front'`-marked and one `'back'`-marked iteration
per project) is enforced by ticket 002's `set_iteration_state` tool, not
a database constraint (architecture-update.md Open Question 2) — this
ticket only adds the columns; it does not need to enforce exclusivity
itself.

## Acceptance Criteria

- [ ] `server/prisma/schema.prisma`'s `Iteration` model gains `accepted
      Boolean @default(false)` and `role String?`.
- [ ] A new Prisma migration is generated and committed; it is purely
      additive — no existing `Iteration` row becomes invalid, no other
      model changes.
- [ ] `npx prisma generate`'s output types reflect the new fields
      (verify `server/src/generated/prisma/models/Iteration.ts` picks
      them up).
- [ ] Existing tests that construct `Iteration` rows (e.g. via
      `prisma.iteration.create`) continue to pass unmodified — the new
      fields must not be required at creation time.

## Implementation Plan

**Approach**: A single, minimal additive Prisma schema change plus
migration. No application code in this ticket reads or writes the new
columns yet — ticket 002 (`set_iteration_state`) is the first writer;
ticket 006/009 are the first readers. Keep this ticket scoped to the
schema only so the migration lands cleanly before any code depends on it,
per architecture-update.md's stated deployment sequencing (schema first).

**Files to modify**:
- `server/prisma/schema.prisma` — add the two fields to `Iteration`.

**Files to create**:
- A new migration under `server/prisma/migrations/`.

**Testing plan**: Run the existing Prisma/Iteration-touching test suite
(e.g. `tests/server/*.test.ts` files that create `Iteration` rows,
including the Sprint 004 `postcards`/`catalogTools` suites) to confirm no
regression from the additive migration. No new test is required by this
ticket alone (behavior is exercised by ticket 002's tests).

**Documentation updates**: None beyond the schema/migration itself.

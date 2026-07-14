---
id: '005'
title: 'Vector and full-text indexing: sqlite-vec + FTS5 with brute-force fallback'
status: done
use-cases:
- SUC-004
depends-on:
- '003'
github-issue: ''
issue: foundation-schema-and-knowledge-store.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Vector and full-text indexing: sqlite-vec + FTS5 with brute-force fallback

## Description

The stakeholder wants lightweight vector search "inside SQLite... not a
heavyweight usage of vector DB" (spec §16 Q1 RESOLVED), and one knowledge
store found via "good indexing" (Q2 RESOLVED). Architecture-001 D1 picks
`sqlite-vec` as the KNN implementation with a brute-force in-memory
cosine-similarity fallback if the extension proves undeployable on the
target platform (Open Question 1, still unconfirmed). This ticket
implements both paths behind one Catalog Store search-function interface,
plus an `FTS5` virtual table for keyword/tag matching, so callers never
know which index answered a query. Depends on ticket 003 for the
`Embedding`, `KnowledgeEntry`, and `AssetDescription` tables this indexes.

This ticket does not populate the index with real embeddings from actual
assets/knowledge content — that's Sprint 004's Description & Embedding
Pipeline and this sprint's ticket 006 (which seeds text but not
necessarily embeddings). This ticket proves the indexing mechanics work
correctly against test-seeded vectors and text.

## Acceptance Criteria

- [x] A `vec0` virtual table exists (via `sqlite-vec` loaded as a
      `better-sqlite3` extension) keyed to `Embedding` rows by
      `(ownerType, ownerId)`.
- [x] An `FTS5` virtual table indexes `AssetDescription.description`,
      `AssetDescription.tags`, `KnowledgeEntry.bodyText`, and
      `KnowledgeEntry.name`.
- [x] One search-function module (e.g.
      `server/src/services/search.ts`) exposes `nearestNeighbors(vector,
      k)` and `keywordSearch(query)` (or a combined hybrid function) —
      callers do not import `sqlite-vec` or `FTS5` specifics directly.
- [x] A runtime capability check attempts to load the `sqlite-vec`
      extension; on failure, the same search-function interface falls
      back to an in-memory brute-force cosine-similarity implementation
      over the `Embedding` table, with no code change required by
      callers.
- [x] Seeding two `KnowledgeEntry` rows with known, distinct test
      embeddings and querying for a third vector closer to one than the
      other returns the closer row first — verified against both the
      `sqlite-vec` path and the brute-force fallback path (the fallback
      path exercised via a test-only flag/env var forcing it on,
      regardless of whether the real extension loads in the test
      environment).
- [x] An `FTS5` query for a distinctive word in a seeded
      `KnowledgeEntry.bodyText` returns that entry.
- [x] `sqlite-vec` platform-coverage verification: confirm the correct
      prebuilt native binary loads successfully in this repo's actual
      Docker base image (not just local dev) — document the result
      (works / doesn't work / needs a specific build step) either way.
      This resolves architecture-001 Open Question 1 for this
      environment specifically.
- [x] `npm test` passes with whichever index path is actually available
      in the test/CI environment, and the fallback-forced test passes
      regardless of what's available.

## Implementation Plan

### Approach

1. Add `sqlite-vec` as a dependency; write a small loader that attempts
   `db.loadExtension(...)` at startup (or lazily on first search call),
   catching failure and setting an internal flag.
2. Define the `vec0` virtual table schema and the `FTS5` virtual table
   schema as part of the Prisma migration (raw SQL via a
   `migration.sql` addition, since Prisma doesn't natively model virtual
   tables) or a post-migration setup step — confirm which pattern this
   repo already uses for any non-Prisma-managed SQL, if any exists.
3. Implement `nearestNeighbors`/`keywordSearch` in
   `server/src/services/search.ts`, branching internally on the
   extension-load flag from step 1 — this branch point is the *only*
   place in the codebase that knows both paths exist (architecture-001
   D1: "swappable implementation detail behind the Catalog Store's search
   functions, not a data-model change").
4. Implement the brute-force fallback: load all `Embedding` rows for the
   relevant `ownerType`, compute cosine similarity in JS, sort, return
   top-k. Note this is O(n) and acceptable only at the corpus sizes this
   sprint's seed data produces — flag in code comments that this is a
   fallback path, not the primary-scale design.
5. Add the test-only forcing flag (e.g. `FORCE_VECTOR_FALLBACK=1` env var
   read only in test setup) so both paths are exercised deterministically
   in CI regardless of the container's actual `sqlite-vec` support.
6. Verify platform coverage against the actual Dockerfile base image —
   build the image (or use the devcontainer) and confirm extension load
   succeeds; document the result in this ticket's PR description and
   update architecture-update.md's Open Question 1 status.

### Files to Create/Modify

- `server/package.json` — add `sqlite-vec` dependency.
- `server/prisma/migrations/<timestamp>_add-search-indexes/migration.sql`
  (new, or appended to ticket 003's migration if sequencing makes that
  cleaner) — `vec0` and `FTS5` virtual table DDL.
- `server/src/services/search.ts` (new) — `nearestNeighbors`,
  `keywordSearch`, extension-load capability check, brute-force fallback.
- `Dockerfile` — confirm/add whatever is needed for the `sqlite-vec`
  native binary to be present in the built image (platform-coverage
  verification may require an edit here; if it does, document why).

### Testing Plan

- **Existing tests to run**: `npm test` (full suite, including ticket
  003's new model tests).
- **New tests to write**:
  - KNN correctness test (closer vector wins) run once with the real
    `sqlite-vec` path (if available in test env) and once with
    `FORCE_VECTOR_FALLBACK` set.
  - `FTS5` keyword match test.
  - Extension-load-failure simulation confirms graceful fallback (no
    thrown error surfaces to the caller).
- **Verification command**: `npm test` (twice — once natural, once with
  `FORCE_VECTOR_FALLBACK=1 npm test` — until CI is confirmed to already
  cover both paths in one run).

### Documentation Updates

Update this sprint's `architecture-update.md` Open Question 1 with the
platform-coverage verification result once known (resolved / needs
Dockerfile change / falls back permanently on this deployment target).

## Testing

- **Existing tests to run**: `npm test`.
- **New tests to write**: KNN correctness (both paths), FTS5 match,
  extension-load-failure fallback.
- **Verification command**: `npm test` and `FORCE_VECTOR_FALLBACK=1 npm test`

## Testing Notes (post-implementation)

- **`npm test`**: 151 server tests (145 pre-existing + 6 new in
  `tests/server/search.test.ts`) + 91 client tests = 242, exit 0. Ran both
  plain (`npm test`) and with `FORCE_VECTOR_FALLBACK=1 npm test` — both
  green. The new test file itself exercises both index paths within a
  single process (no external env var needed) via
  `__resetCapabilityCacheForTests()` + toggling `FORCE_VECTOR_FALLBACK` per
  test; the two full-suite runs are a second, coarser confirmation the same
  behavior holds when the flag is set for the whole process (the "natural
  path" test respects an externally-set flag rather than always clearing
  it, specifically so `FORCE_VECTOR_FALLBACK=1 npm test` forces the entire
  suite, not just the dedicated fallback test).
- **macOS dev (arm64, local)**: `sqlite-vec` 0.1.9 loads successfully —
  confirmed both by a standalone `better-sqlite3`/`sqlite-vec` script
  (`vec_version()` returns `v0.1.9`) and by the search test's logged line
  `[ticket 002-005] sqlite-vec active in this test invocation: true`. The
  `vec0` KNN path is what actually answers `nearestNeighbors` in this dev
  environment.
- **This repo's actual Docker base image (`node:20-alpine`, per
  `Dockerfile`)**: **does not work.** Installed `better-sqlite3` +
  `sqlite-vec` fresh inside a `node:20-alpine` container (matching the
  Dockerfile's server stage, including the `python3 make g++` build tools
  it already installs) and attempted the load directly:
  `sqlite-vec.load(db)` throws `Error loading shared library
  /.../sqlite-vec-linux-x64/vec0.so.so: No such file or directory`. The
  `.so` file *is* present (159,816 bytes) — the double `.so.so` in the
  error is SQLite's own extension-suffix-retry behavior after the first
  `dlopen` attempt on the exact path fails. Root cause: `sqlite-vec`'s
  npm-distributed `sqlite-vec-linux-x64` prebuilt binary is built against
  glibc, and `node:20-alpine` uses musl libc — an ABI mismatch, not a
  missing-file problem, so no `RUN apk add` package fixes it.
  - This is exactly the risk architecture-001 Open Question 1 flagged
    ("if not, fall back to the brute-force BLOB approach in D1 without a
    data-model change") and exactly what `isVectorPathActive()`'s
    try/catch is designed to absorb: the failure is caught, cached as
    `false`, and every `nearestNeighbors` call transparently uses the
    brute-force cosine path instead — no thrown error, no caller code
    change, confirmed by this ticket's "does not throw when simulated to
    fail" test.
  - **Result for this environment: doesn't work; not fixable via a build
    step within the current base image.** The brute-force fallback is
    therefore the path that actually answers vector queries in this
    repo's production Docker deployment today, not just in test/CI.
  - **Not fixed in this ticket**: swapping `Dockerfile`'s `FROM
    node:20-alpine` for a glibc-based base (e.g. `node:20-slim`) would
    very likely activate the fast path in production, but that's an image
    size/security-surface tradeoff decision bigger than this ticket's
    scope, and architecture-001 D1 explicitly designed the fallback so
    production correctness doesn't depend on that decision being made.
    Flagged as a candidate follow-up ticket, not a blocker here.
- Updated this sprint's `architecture-update.md` Open Question 1 (Migration
  Concerns and Step 7) with this result.

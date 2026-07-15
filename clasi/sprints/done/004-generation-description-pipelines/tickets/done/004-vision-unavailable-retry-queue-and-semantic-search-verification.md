---
id: '004'
title: Vision-unavailable retry/queue and semantic search verification
status: done
use-cases:
- SUC-003
- SUC-004
depends-on:
- '003'
github-issue: ''
issue: asset-auto-description-and-semantic-filtering.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Vision-unavailable retry/queue and semantic search verification

## Description

Complete UC-008 E4 / UC-014 E3's degrade-gracefully requirement on top of
ticket 003's happy path, and verify the end-to-end semantic-search
promise (SUC-004) against pipeline-generated data for the first time.

Per architecture-update.md's R2: an `Asset` row with no `AssetDescription`
row *is* the pending state -- no new column or table. This ticket adds:

1. **A retry function** (`description.retryPendingDescriptions(options)`)
   that queries `Asset` rows with no `AssetDescription`, re-invokes
   ticket 003's `describeAsset` for each, and stops at the first success/
   failure per asset (idempotent -- an asset that already has a
   description is never re-processed, and a still-failing asset is
   simply left pending for the next invocation).
2. **Opportunistic retry**: `addAssetToCollection` (or a nearby hook)
   triggers a best-effort retry pass for previously-pending assets in the
   same collection when a new asset is committed into it (cheap,
   piggybacks on an already-happening write; must not block or fail the
   current commit if the retry pass itself fails).
3. **A scheduled retry**: register a new `ScheduledJob` row (`name:
   'description-retry'`, reusing the existing `ScheduledJob` model and
   `scheduler.service.ts` mechanics, no schema change) that invokes the
   same retry function on its existing frequency semantics
   (`'hourly'` is the recommended default, per architecture-update.md
   R2's stated coarse-grained-is-acceptable rationale).
4. **Semantic search verification**: an end-to-end test proving a
   natural-language query against a pipeline-generated (not
   hand-seeded) `AssetDescription` returns the right asset via both
   `nearestNeighbors` and `keywordSearch`, and that a still-pending asset
   is excluded from both until it's described.

## Acceptance Criteria

- [x] A simulated `classifyAndDescribe` failure during
      `add_asset_to_collection` leaves the `Asset` committed with no
      `AssetDescription`/`Embedding` row (ticket 003's failure path,
      re-verified here as the setup condition for this ticket's tests).
- [x] The pending asset is findable by filename/path search (Sprint
      002's existing FTS5/browse path) while pending, per UC-014 E3.
- [x] `retryPendingDescriptions` invoked directly in a test, with the
      vision model now available (fixture success), produces the same
      `AssetDescription`/`Embedding`/FTS5-index result as ticket 003's
      happy path for the previously-pending asset.
- [x] `retryPendingDescriptions` run twice in a row only calls
      `classifyAndDescribe` once for a given asset -- an asset that
      already has an `AssetDescription` is never re-processed.
- [x] A `ScheduledJob` row named `description-retry` is registered at
      startup (or via an init function tests can call directly) and
      invokes `retryPendingDescriptions` when run.
- [x] Committing a second asset into a collection that already has a
      pending (undescribed) asset triggers an opportunistic retry
      attempt for the pending one, without delaying or failing the new
      commit if that retry attempt itself fails.
- [x] End-to-end: a query semantically related to a pipeline-generated
      (fixture) description (e.g. "robots") returns the matching asset
      via `nearestNeighbors`; the same query's literal terms return it
      via `keywordSearch`; a separate still-pending asset is excluded
      from both result sets.

## Implementation Plan

**Approach**: Add the retry function to `description.ts` (ticket 003),
reusing `describeAsset` verbatim -- no duplicated classify/write logic.
Wire the opportunistic hook into `addAssetToCollection` as a
fire-and-catch call, mirroring the pattern ticket 003 already
establishes for the main pipeline call. Register the `ScheduledJob` at
app startup alongside whatever existing jobs `scheduler.service.ts`
registers.

**Files to modify**:
- `server/src/services/description.ts` -- add
  `retryPendingDescriptions`.
- `server/src/agent-mcp/catalogTools.ts` -- add the opportunistic-retry
  hook to `addAssetToCollection`.
- `server/src/services/scheduler.service.ts` (or wherever jobs are
  registered at startup) -- register `description-retry`.
- Prisma seed/init code, if any, that pre-populates `ScheduledJob` rows
  -- add the new job's row if the existing pattern requires an explicit
  seed rather than a runtime `upsert`.

**Testing plan**: A pending-asset fixture setup (reuse ticket 003's
failure-path test as the arrange step), then: direct
`retryPendingDescriptions` test, idempotency test (two invocations, one
API call), opportunistic-hook test, `ScheduledJob` registration test,
and the end-to-end semantic-search test described in the acceptance
criteria (this is also SUC-004's own acceptance test, satisfied here
rather than duplicated in a separate ticket since it depends directly on
this ticket's pending/retry machinery being exercised first).

**Documentation updates**: `description.ts`'s header comment gains a
section on the retry/pending model, cross-referencing
architecture-update.md R2 explicitly.

## Testing Notes

**Retry design as built**:
- `server/src/services/description.ts` adds `retryPendingDescriptions(options)`
  -- queries `Asset` rows with `description: null` (optionally scoped by
  `collectionId`, optionally excluding one `excludeAssetId`), and
  re-invokes `describeAsset` for each, catching and logging a per-asset
  failure so one bad asset never stops the rest of the pass. Idempotent by
  construction: a described asset no longer matches the pending query, so
  a second invocation never re-processes it. Its default `loadInput`
  reads the pending asset's bytes off the Workspace Filesystem itself
  (mirrors `addAssetToCollection`'s own fallback) since, unlike the
  original commit, no caller is holding fresh bytes for a retry pass --
  test-injectable, so this module's own tests never touch a real file.
- `registerDescriptionRetryJob(scheduler, options)` (also in
  `description.ts`) registers the `'description-retry'` handler on any
  object matching `SchedulerService`'s `registerHandler` shape -- split
  out from `server/src/index.ts`'s inline startup wiring specifically so
  a test can call it directly against a stub scheduler. `index.ts` now
  calls it alongside the existing `daily-backup`/`weekly-backup`
  registrations.
- `server/src/services/scheduler.service.ts`'s `seedDefaults()` gains a
  third default job: `{ name: 'description-retry', frequency: 'hourly' }`
  -- no schema change, reuses the existing `ScheduledJob` model/upsert
  mechanics.
- `server/src/agent-mcp/catalogTools.ts`'s `addAssetToCollection` calls
  `retryPendingDescriptions` a second time after its own pipeline
  try/catch, scoped to `collectionId: asset.collectionId` and
  `excludeAssetId: asset.id` (so it only ever retries a *previously*
  pending asset in the same collection, never doubling up on the asset
  just committed), wrapped in its own try/catch so a failure there never
  delays or fails the commit. A new `retryPendingDescriptions` option on
  `CatalogToolsOptions` lets tests inject a fixture `loadInput`/
  `imagingOptions` for that pass.

**Semantic search verification results**: a new end-to-end test
(`tests/server/description-retry-and-search.test.ts`, AC7) describes an
asset through the real pipeline (`describeAsset` via a stubbed
`classifyAndDescribe`, never a hand-seeded `AssetDescription` row) with a
"robots at a workshop" classification, then confirms `nearestNeighbors`
(vector path, `embedText`-built query) and `keywordSearch('robots')`
(FTS5 path) both return it, while a separate still-pending asset (no
`AssetDescription`/`Embedding`/keyword-index entry at all) is excluded
from both result sets. This is SUC-004's own acceptance test, satisfied
here per the testing plan above.

**Test counts**: `npm test` exit 0 -- 290 server tests (was 281; +9 new,
all in `tests/server/description-retry-and-search.test.ts`, covering
AC1-AC7) / 94 client tests, unchanged elsewhere.

**Debugging note for future reference**: an early version of the AC5
(`registerDescriptionRetryJob`) test intermittently failed with
`TypeError: Body is unusable: Body has already been read` -- caused by
`vi.fn().mockResolvedValue(response)` returning the *same* `Response`
instance across multiple `fetchImpl` calls when a single
`retryPendingDescriptions` pass processes more than one pending asset in
the same batch; `Response.json()` can only consume a given instance's
body once. Fixed by using `mockImplementation(() => classificationResponse(...))`
(a fresh `Response` per call) everywhere in the new test file, and by
scoping the AC5 test's retry pass to its own `collectionId` to avoid
incidental multi-asset batches from other tests' deliberately-still-pending
fixtures.

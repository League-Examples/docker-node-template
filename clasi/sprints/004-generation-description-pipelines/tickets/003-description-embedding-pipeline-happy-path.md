---
id: '003'
title: Description & Embedding Pipeline (happy path)
status: open
use-cases:
- SUC-002
depends-on:
- '001'
github-issue: ''
issue: asset-auto-description-and-semantic-filtering.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Description & Embedding Pipeline (happy path)

## Description

Build the real Description & Embedding Pipeline (architecture-001 Module
8, architecture-update.md Step 3) as `server/src/services/description.ts`,
and hook it into `agent-mcp/catalogTools.ts`'s `addAssetToCollection` --
the tool's own header comment today says "No `AssetDescription` row is
created (no vision-model call this sprint, Sprint 004 scope)"; this
ticket makes that call real.

Flow: `addAssetToCollection` creates the `Asset` row as it already does,
releases its directory lock (unchanged), then -- **after** the lock
release, so the vision-model network call never holds up other writers
to that directory -- calls `description.describeAsset(asset)`. That
function:

1. Calls `imaging.classifyAndDescribe` (ticket 001) with the asset's
   image bytes.
2. Writes one `AssetDescription` row (`isPhotograph`, `isLogo`, `style`,
   `peopleReal`, `description`, `tags`) -- the schema architecture-001
   already defines exactly, no migration needed.
3. Writes one `Embedding` row (`ownerType: 'asset'`, `ownerId:
   asset.id`) from an embedding computed over the description (reuse
   whatever embedding-vector convention Sprint 002 established for
   `KnowledgeEntry` embeddings, if any exists yet, so `Embedding.model`
   values stay consistent across owner types; otherwise establish it
   here and document the choice for ticket 004/future knowledge-entry
   embedding work to match).
4. Calls the existing `indexAssetDescription` (`search.ts`, unmodified)
   so the description/tags are FTS5-searchable immediately.

Tag vocabulary is free-form JSON (architecture-001's existing data-model
decision, unchanged) -- seed the `classifyAndDescribe` prompt's tag
guidance pragmatically from the predecessor's actual
`images/catalog.json` tag usage (a concrete starting point, not an
invented vocabulary) rather than leaving it fully open-ended; this
remains an open item for stakeholder confirmation (architecture-001 Open
Question 5, carried forward).

A pipeline failure (network error, timeout, malformed response) must
never propagate out of `addAssetToCollection` -- catch, log, and return
without writing `AssetDescription`/`Embedding` (ticket 004 builds the
retry path on top of this).

## Acceptance Criteria

- [ ] Committing a test asset via any `add_asset_to_collection` call
      produces an `AssetDescription` row with `isPhotograph`, `isLogo`,
      `style`, and `peopleReal` all populated and a non-empty
      `description` (fixture-backed vision response, no live network
      call in tests).
- [ ] The same commit produces exactly one `Embedding` row for that
      asset (`ownerType: 'asset'`, `ownerId` matching), retrievable via
      the existing `nearestNeighbors` (`search.ts`, unmodified).
- [ ] `keywordSearch` against a token present in the fixture-generated
      `description` or `tags` returns `{ ownerType: 'asset', ownerId }`
      for that asset.
- [ ] `addAssetToCollection`'s return value, timing, and existing
      locking/versioning behavior are unchanged when the description
      pipeline succeeds -- verified by re-running Sprint 003's existing
      `addAssetToCollection` tests unmodified and green.
- [ ] A simulated `classifyAndDescribe` failure during a commit does
      **not** throw out of `addAssetToCollection` -- the call still
      returns the created `Asset` successfully, with no
      `AssetDescription`/`Embedding` row written (the happy-path half of
      what ticket 004 verifies end-to-end).
- [ ] The pipeline call happens after the directory lock is released
      (verified by a test asserting the lock is not held during the
      simulated vision-model call, e.g. a concurrent lock-acquisition
      attempt on the same directory succeeds while the pipeline call is
      in flight).

## Implementation Plan

**Approach**: New pipeline module calling ticket 001's `imaging.ts` and
writing through the normal Prisma client + `search.ts`'s existing
indexing functions -- no new write path, no filesystem access from this
module (architecture-001's original boundary statement, unchanged).
Modify `addAssetToCollection` minimally: one new call after its existing
`finally` block, wrapped in try/catch so a failure never propagates.

**Files to create**:
- `server/src/services/description.ts` -- `describeAsset(asset,
  options)`.
- Test file covering the acceptance criteria above, including a fixture
  vision-model response and a lock-timing test.

**Files to modify**:
- `server/src/agent-mcp/catalogTools.ts` -- `addAssetToCollection` gains
  the one new call; update its header comment (which currently states
  "no vision-model call this sprint") to reflect the new behavior.

**Testing plan**: Fixture-backed happy-path test (asset commit ->
description + embedding + FTS5-searchable, per the acceptance criteria);
a failure-path test proving `addAssetToCollection` still succeeds; a
lock-timing test. All against recorded fixtures, no live OpenRouter call
in CI.

**Documentation updates**: `catalogTools.ts`'s module header comment
updated to describe the new post-lock-release pipeline call.
Cross-reference architecture-update.md's R2 (pending-description-as-
absent-row) in the new module's own header, since that's the design
decision this ticket's failure path implements.

---
id: '006'
title: Predecessor knowledge seed import job
status: open
use-cases: [SUC-003]
depends-on: ['003']
github-issue: ''
issue: foundation-schema-and-knowledge-store.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Predecessor knowledge seed import job

## Description

Without real content, Sprint 003's Agent Runtime would consult an empty
knowledge store — no styles, no layouts, nothing to assemble a prompt
from. The predecessor `marketing` repo
(`/Volumes/Proj/proj/league-projects/infrastructure/marketing`) already
has real, opinionated style/layout prompt text in
`app/prompts/styles/<style>/{positive,negative}.md`,
`app/prompts/palettes/`, `app/prompts/compositions/`, and
`app/layouts/`. This ticket writes a one-time (but idempotent) import
script that reads those files and creates `KnowledgeEntry` rows from
them, so later sprints have real data instead of a placeholder. Depends
on ticket 003 for the `KnowledgeEntry` model.

Per architecture-update.md's Open Question 2, this ticket defaults to
importing **all** predecessor content (10 styles, all palettes,
~25 compositions, all layouts) rather than a subset, for completeness —
flag during implementation if that proves excessive and scope down with
a note in the PR description rather than silently doing a partial import.

## Acceptance Criteria

- [ ] `server/src/scripts/import-predecessor-knowledge.ts` (or similar)
      exists and is runnable via an npm script (e.g. `npm run
      import:predecessor-knowledge` in `server/package.json`).
- [ ] Running the script creates a `KnowledgeEntry` row for each of the
      predecessor's 10 styles (`pop-art`, `comic-book`, `manga`,
      `dragon-ball-z`, `technical-blueprint`, `8bit-video-game`,
      `flat-poster`, `graphic-novel`, `type-sample`,
      `type-sample-8bit`), each with `kind = 'style'`, a `name` matching
      the style slug, and non-empty `bodyText` combining (or separately
      capturing, implementer's structuring choice within
      `structuredFields`) the source `positive.md` and `negative.md`
      content.
- [ ] Running the script creates `KnowledgeEntry` rows for the
      predecessor's palettes (`app/prompts/palettes/`), compositions
      (`app/prompts/compositions/`), and layouts (`app/layouts/`), each
      with the correct `kind`.
- [ ] Each imported `KnowledgeEntry` is placed under a corresponding
      `WorkspaceDirectory` row (e.g. `knowledge/styles/pop-art/`) created
      via ticket 004's sync utility, so the import produces both DB rows
      and correct `_dir.json` mirrors.
- [ ] Running the script twice does not create duplicate `KnowledgeEntry`
      rows — it upserts by a stable natural key (`kind` + slug), matching
      Migration Concerns' idempotency requirement in
      architecture-update.md.
- [ ] A test queries `KnowledgeEntry` where `kind = 'style'` and confirms
      at least `pop-art`, `manga`, and `flat-poster` exist with
      non-empty `bodyText` (validates SUC-003's acceptance criterion
      directly).
- [ ] The script does not fail the build or `npm test` if the predecessor
      repo path is unavailable (e.g. CI, a future production host) — it
      should be explicitly invoked, not run as part of `npm test` or
      `prisma migrate dev`, and should fail loudly with a clear message
      (not silently no-op) if run without the source path present.

## Implementation Plan

### Approach

1. Read each predecessor style directory
   (`app/prompts/styles/<slug>/{positive,negative}.md`), parse into a
   `bodyText` (a documented, simple combination — e.g. positive then
   negative, clearly delimited — implementer's call on exact format,
   consistent with "not formalizing this too much") and a minimal
   `structuredFields` capturing anything not natural-language (none
   expected for styles beyond the slug/name).
2. Repeat for palettes, compositions (~25 files), and layouts, mapping
   each predecessor directory/file convention to the corresponding
   `KnowledgeEntry.kind`.
3. For each entry, ensure a `WorkspaceDirectory` row exists at
   `knowledge/<kind-plural>/<slug>/` (creating it via ticket 004's sync
   utility if not already scaffolded) and set `KnowledgeEntry.directoryId`
   accordingly.
4. Upsert (not insert) each `KnowledgeEntry` by `(kind, name)` so re-runs
   are safe.
5. Wire an `npm run import:predecessor-knowledge` script in
   `server/package.json` pointing at the compiled/ts-node-executed
   script; do not call it from `prisma migrate dev`'s hooks or `npm
   test`.

### Files to Create/Modify

- `server/src/scripts/import-predecessor-knowledge.ts` (new).
- `server/package.json` — add the `import:predecessor-knowledge` script
  entry.
- `tests/server/import-predecessor-knowledge.test.ts` (new) — run
  against a small fixture directory mimicking the predecessor's file
  layout (do not depend on the actual sibling repo being present in CI;
  use a committed fixture under `tests/fixtures/predecessor-knowledge/`
  with 2-3 representative styles/layouts) to keep the test hermetic.

### Testing Plan

- **Existing tests to run**: `npm test` (full suite, including tickets
  003-005's new tests).
- **New tests to write**: import-job test against a committed fixture
  directory (not the live sibling repo, so CI doesn't depend on a path
  outside this repo); upsert-idempotency test (run twice, assert row
  count unchanged on the second run); `WorkspaceDirectory`/`_dir.json`
  creation test for imported entries.
- **Verification command**: `npm test`; manually also run
  `npm run import:predecessor-knowledge` once against the real
  predecessor repo path locally to confirm the real 10-style import
  works end-to-end (not part of the automated gate, since the path is
  environment-specific).

### Documentation Updates

Document the natural-key upsert convention (`kind` + `name`) in a code
comment at the top of the import script, since it's the mechanism that
makes re-runs safe and any future importer (e.g. a Sprint 004+ import of
additional predecessor asset catalog content) should follow the same
pattern.

## Testing

- **Existing tests to run**: `npm test`.
- **New tests to write**: fixture-based import test, idempotency test,
  `WorkspaceDirectory` creation test.
- **Verification command**: `npm test`

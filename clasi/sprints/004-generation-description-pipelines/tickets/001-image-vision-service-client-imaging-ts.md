---
id: '001'
title: Image & Vision Service client (imaging.ts)
status: open
use-cases:
- SUC-001
- SUC-002
- SUC-004
depends-on: []
github-issue: ''
issue: image-generation-service.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Image & Vision Service client (imaging.ts)

## Description

Build the real Image & Vision Service (architecture-001 Module 9,
architecture-update.md Step 3) as a new, stateless module:
`server/src/services/imaging.ts`. This is the foundation ticket every
other ticket in this sprint depends on directly or indirectly -- it is
the only place in the codebase that talks to OpenAI or OpenRouter.

Two entry points:

- `generateImage(input)` -- OpenAI direct. Calls
  `POST /v1/images/generations` when no reference images are attached,
  `POST /v1/images/edits` when one or more are attached. Model from
  `IMAGE_MODEL` (`gpt-image-2`), quality `high`, size one of
  `1536x1024` / `1024x1536` / `1024x1024` (matches the predecessor's
  `cli.py` grounding exactly -- see `_generate_openai_core`/
  `_generate_openai_edits`). Returns raw image bytes plus the
  model/params actually used; does not write to disk or the DB itself
  (that's the caller's job -- ticket 002 for the agent-loop path).
- `classifyAndDescribe(input)` -- OpenRouter vision. Calls
  `POST {OPENROUTER_BASE}/chat/completions` with an image payload
  (base64 or URL) and model from `OPENROUTER_MODEL`, asking for the four
  required classification fields (`isPhotograph`, `isLogo`, `style`,
  `peopleReal`) plus a rich `description` and a `tags` array, returned
  as structured JSON the caller (ticket 003) writes directly into
  `AssetDescription`.

Both entry points log an approximate spend estimate (a small static
price table keyed by model + size/quality, no live billing API call) via
the existing `pino` logger on every call, success or failure -- no
budget cap is enforced (architecture-001 Open Question 7, unchanged, per
stakeholder Q&A).

Also add the dotconfig cascade values this service reads:
`OPENROUTER_API`, `OPENROUTER_MODEL`, `IMAGE_MODEL` to
`config/dev/{secrets,public}.env` and `config/prod/{secrets,public}.env`
(secrets vs. public split matching the existing `OPENAI_API_KEY`/
`ANTHROPIC_API_KEY` pattern -- `OPENROUTER_API` is a secret,
`OPENROUTER_MODEL`/`IMAGE_MODEL` are public), and add
`OPENROUTER_API`/`OPENROUTER_MODEL`/`IMAGE_MODEL` entries to
`CONFIG_KEYS` in `server/src/services/config.ts` under the existing "AI
Services" group. Reconcile `OPENAI_API_KEY` (already present in both
places) -- do not duplicate it.

## Acceptance Criteria

- [ ] `generateImage` with no reference images calls
      `/v1/images/generations` (verified against a recorded fixture in
      tests, no live network call); returns image bytes + the model/size/
      quality actually used.
- [ ] `generateImage` with one or more reference image paths calls
      `/v1/images/edits` instead, attaching the reference images.
- [ ] `classifyAndDescribe` calls OpenRouter's chat-completions endpoint
      with an image payload and `OPENROUTER_MODEL`, and parses the
      response into `{ isPhotograph, isLogo, style, peopleReal,
      description, tags }` -- all four classification fields always
      present (never silently omitted, even if the model's answer is
      "unknown").
- [ ] A simulated OpenAI failure/timeout from `generateImage` throws (or
      returns a typed error) rather than returning a partial/garbage
      result; no bytes are returned on failure.
- [ ] A simulated OpenRouter failure/timeout from `classifyAndDescribe`
      throws (or returns a typed error) the same way -- this is what
      ticket 003/004's graceful-degradation path catches.
- [ ] Every successful call (both entry points) logs an approximate
      spend estimate via the existing `pino` logger.
- [ ] `OPENROUTER_API`, `OPENROUTER_MODEL`, `IMAGE_MODEL` exist in
      `config/dev` and `config/prod`; `OPENAI_API_KEY` is not duplicated;
      no secret value appears in any committed file or doc.
- [ ] `CONFIG_KEYS` in `config.ts` lists the three new keys under "AI
      Services", consistent with the existing `ANTHROPIC_API_KEY`/
      `OPENAI_API_KEY` entries' shape (`group`, `label`, `isSecret`,
      `requiresRestart`).
- [ ] `npm test` passes with no `OPENAI_API_KEY`/`OPENROUTER_API` set and
      no network access -- every test exercises `imaging.ts` against
      recorded fixtures, never a live API call.

## Implementation Plan

**Approach**: Mirror the predecessor's `cli.py` request/response shapes
(`_generate_openai_core`, `_generate_openai_edits`, `evaluate_image`) as
closely as practical in TypeScript, using the runtime's native `fetch`
(no new HTTP client dependency needed). Keep the module stateless and
side-effect-free beyond the two API calls and the spend-estimate log
line -- no DB or filesystem writes here, matching architecture-001's
original boundary statement for this module.

**Files to create**:
- `server/src/services/imaging.ts` -- `generateImage`,
  `classifyAndDescribe`, a small static price table, spend-estimate
  logging helper.
- `tests/server/imaging.test.ts` (or wherever this repo's server tests
  live -- match the existing convention) -- fixture-backed tests for
  both entry points, generation vs. edits branching, and both failure
  paths.

**Files to modify**:
- `config/dev/secrets.env`, `config/dev/public.env`,
  `config/prod/secrets.env`, `config/prod/public.env` -- add the three
  new keys (empty/placeholder values, never real secrets).
- `server/src/services/config.ts` -- extend `CONFIG_KEYS`.

**Testing plan**: Recorded-fixture tests (JSON fixtures standing in for
OpenAI/OpenRouter responses, following whatever fixture convention
Sprint 003's provider-adapter tests already established for the
Anthropic/mock adapters) for: generations path, edits path (reference
images attached), classify/describe happy path, and one failure case per
entry point. No test may require a real `OPENAI_API_KEY`/`OPENROUTER_API`
or network access.

**Documentation updates**: Module-header doc comment in `imaging.ts`
explaining the generation-vs-edits branch and the OpenAI/OpenRouter
split, mirroring the style of `server/src/agent-mcp/catalogTools.ts`'s
header. No user-facing docs change.

---
id: '001'
title: 'Ground iteration numbering: per-seq content hints + system-prompt trust statement'
status: done
use-cases:
- SUC-022
- SUC-023
depends-on: []
github-issue: ''
issue: agent-iteration-number-grounding.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Ground iteration numbering: per-seq content hints + system-prompt trust statement

## Description

Ground the agent's handling of iteration numbers, closing
`agent-iteration-number-grounding.md` (live incident, project 14,
2026-07-19: the agent hedged that UI numbering and its internal
numbering "may not line up" and then fabricated a description of
iteration 3's content — both wrong, verified against the DB and code).

Two additions, both confined to `server/src/agent/turn.ts` (sprint
012's Architecture section has the full write-up and Design Rationale;
this ticket implements it):

1. **Per-seq content hints in PROJECT CONTEXT, active stream only.**
   `loadProjectContext`'s `Iteration` select gains `promptUsed`;
   `ProjectContextIteration` gains a `promptUsed: string` field; the
   *active* stream's rendering (only) shows each entry as `#N: "<hint>"
   (tags)` instead of the current bare `#N (tags)`, where `<hint>` is a
   truncated form of that iteration's stored `promptUsed`. The inactive
   stream(s) keep today's bare rendering unchanged — this is a
   deliberate scope decision (see sprint.md Design Rationale), not an
   oversight.
2. **A system-prompt trust statement.** `SYSTEM_PROMPT_BASE` gains a
   sentence stating that the user's "iteration N" is exactly the UI's
   "Iteration N" badge and the same seq value `editSourceIteration`
   resolves against — never to be treated as possibly divergent — and
   that the model must say so plainly when it cannot identify an
   iteration or its content, rather than invent a description.

Planning also traced whether `promptUsed` is actually populated for
edit-created iterations (not just fresh generations) end to end
(`dispatchToolCall` → `realImageVisionClient.generateImage` →
`catalogTools.createIteration`) and confirmed it already is, on every
path, unconditionally. **No code fix is needed for that concern** — this
ticket adds the regression test the issue asked for instead.

## Acceptance Criteria

- [x] `loadProjectContext`'s `iteration.findMany` select includes
      `promptUsed` alongside the existing `seq`/`role`/`accepted`.
- [x] `ProjectContextIteration` includes a `promptUsed: string` field.
- [x] A new active-stream-only rendering path (e.g. a
      `summarizeActiveStream` function, called only for the role
      matching `activeFace` inside `summarizeIterations`) renders each
      entry as `#N: "<truncated promptUsed>" (tags)`, keeping the
      existing `accepted`/`most recent` tag logic unchanged in meaning.
- [x] The inactive stream(s) continue to render via the existing bare
      `summarizeStream` (`#N (tags)`), unmodified.
- [x] A truncation helper (e.g. `truncatePromptHint`, ~80 chars with an
      ellipsis) prevents a long prompt/edit-instruction from bloating
      the system prompt.
- [x] An iteration with an empty/falsy `promptUsed` renders a
      `(no prompt recorded)` placeholder rather than an empty quoted
      string, so the block never looks broken.
- [x] `SYSTEM_PROMPT_BASE` states that the user's iteration number is
      exactly the UI's seq and the `editSourceIteration` value, and that
      the two never diverge — no hedging language permitted.
- [x] `SYSTEM_PROMPT_BASE` instructs the model to say plainly when it
      cannot identify an iteration or its content, rather than
      fabricate.
- [x] The existing exact-string assertion at
      `tests/server/agent-turn.test.ts` ~line 334
      (`'front: #1 (accepted, most recent) -- 1 iteration'`, under
      `activeFace: 'front'`, in the `'includes the description in the
      PROJECT CONTEXT creative brief'` test) is updated to the new
      hint-bearing format; its sibling back-stream assertion on the
      same test is left passing, unmodified.
- [x] The existing exact-string assertion at
      `tests/server/agent-turn.test.ts` ~line 1089
      (`'front: #1, #2 (accepted), #3 (most recent) -- 3 iterations'`,
      under `activeFace: 'front'`, in the `'PROJECT CONTEXT iteration
      listing (sprint 010 ticket 001)'` describe block) is updated to
      the new hint-bearing format; its sibling back-stream assertion
      (`'back: #4 (most recent) -- 1 iteration'`) is left passing,
      unmodified.
- [x] A new test asserts a specific seq's rendered PROJECT CONTEXT line
      contains that seq's stored `promptUsed` text (or its truncation),
      directly tying "seq N" to "iteration N."
- [x] A new regression test creates an iteration via the edit path
      (`generate_image` with `editSourceIteration` set) and asserts the
      resulting iteration's `promptUsed` is non-empty and renders a hint
      in PROJECT CONTEXT.
- [x] A new test asserts the new `SYSTEM_PROMPT_BASE` sentence(s) are
      present in the rendered system prompt (same assertion style as
      the existing `'Never ask the user for internal identifiers'`
      check at ~line 2071).
- [x] The full existing test suite passes, including every test file
      under `tests/server/`, not just `agent-turn.test.ts`.

## Testing

- **Existing tests to run**: the full server suite
  (`tests/server/**/*.test.ts` via the project's vitest config,
  `server/vitest.config.ts`) — in particular
  `tests/server/agent-turn.test.ts` in full, since this ticket touches
  shared helpers (`summarizeStream`/`summarizeIterations`,
  `SYSTEM_PROMPT_BASE`) that many describe blocks in that file exercise.
- **New tests to write** (all in `tests/server/agent-turn.test.ts`,
  alongside the existing PROJECT CONTEXT / system-prompt describe
  blocks — no new test file needed):
  1. A specific seq's rendered active-stream line contains that seq's
     stored `promptUsed` (or a truncation of it) — ties "seq N" to
     "iteration N."
  2. An iteration created via the edit path (`editSourceIteration` set
     on a `generate_image` call) ends up with a non-empty `promptUsed`
     that renders a hint in the next turn's PROJECT CONTEXT — regression
     coverage for the already-confirmed-correct population.
  3. The rendered system prompt contains the new trust-statement
     sentence(s) (UI-seq/`editSourceIteration` identity; "say so
     plainly" instruction), mirroring the existing
     `'Never ask the user for internal identifiers'` assertion.
  4. Updates (not new tests, but modifications) to the two exact-string
     assertions named in Acceptance Criteria, so they assert the new
     format instead of failing against it.
- **Verification command**: from the repo root, run the server test
  suite per `server/vitest.config.ts` (e.g. `npm test --prefix server`
  or the project's configured script covering
  `tests/server/**/*.test.ts`) — confirm the full suite is green, not
  just the new/updated tests.
- **Manual/live check before sprint close** (per the stakeholder-approval
  gate note "Verify live against project 14 before close"): exercise the
  live chat against project 14 and confirm the agent no longer hedges
  about numbering or fabricates content when asked about a specific
  iteration.

## Implementation Plan

### Approach

1. Extend `loadProjectContext`'s `iteration.findMany` `select` to
   include `promptUsed: true`, and extend the `ProjectContextIteration`
   interface with `promptUsed: string`.
2. Add a small formatting helper, `truncatePromptHint(promptUsed:
   string, maxChars = 80): string`, near the other rendering helpers
   (`formatDetailsHeader`, `summarizeStream`) — trims whitespace,
   truncates to `maxChars` with a trailing ellipsis when longer, and
   returns a `(no prompt recorded)` placeholder for empty/falsy input.
3. Add a new rendering function for the active stream (e.g.
   `summarizeActiveStream(iterations: ProjectContextIteration[]):
   string`) that reuses `summarizeStream`'s existing
   `accepted`/`most-recent`-tag logic but prefixes each entry with
   `#N: "<truncatePromptHint(i.promptUsed)>"` before the tag suffix.
4. In `summarizeIterations`, use the `activeFace` parameter (already
   available at the `buildProjectContextBlock` call site — thread it
   into `summarizeIterations`'s signature) to pick
   `summarizeActiveStream` for the role matching `activeFace` and keep
   the existing `summarizeStream` for the other role(s).
5. Append the new trust-statement sentence(s) to the `SYSTEM_PROMPT_BASE`
   string constant, in the same paragraph/style as its existing
   `editSourceIteration` usage sentence.
6. Update the two named existing test assertions to the new format, and
   add the three new tests described above.

### Files to Modify

- `server/src/agent/turn.ts` — `loadProjectContext`,
  `ProjectContextIteration`, new `truncatePromptHint` helper, new
  `summarizeActiveStream`, `summarizeIterations` (signature gains
  `activeFace`), `SYSTEM_PROMPT_BASE`.
- `tests/server/agent-turn.test.ts` — update the two exact-string
  assertions named in Acceptance Criteria; add the three new tests.

### Files to Create

None. This ticket is additive within existing files only — no new
module, no new test file, no schema migration.

### Documentation Updates

None beyond this ticket and sprint 012's `sprint.md` (already complete).
No README or consolidated architecture-doc changes are warranted for a
compact, single-module change with no new component or data-model
impact.

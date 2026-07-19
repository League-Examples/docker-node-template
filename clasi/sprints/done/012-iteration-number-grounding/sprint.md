---
id: '012'
title: Iteration Number Grounding
status: closed
branch: sprint/012-iteration-number-grounding
worktree: false
use-cases:
- SUC-022
- SUC-023
issues:
- agent-iteration-number-grounding.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 012: Iteration Number Grounding

## Goals

- Give the agent enough grounding that it can describe a specific
  iteration's actual content instead of fabricating one.
- Make the system prompt state, unambiguously, that the iteration number
  the user references is the same seq shown as "Iteration N" in the UI
  and the same value `editSourceIteration` resolves against — so the
  agent stops hedging about numbering mismatches that do not exist.

## Problem

Live incident, project 14 (2026-07-19): when the user referenced
"iteration 3," the agent hedged that "the file names and the count you
see may not line up cleanly" and then fabricated a description of
iteration 3's content. Both the hedge and the fabrication are wrong —
the numbering is provably consistent (`OutputPane.tsx`'s `Iteration
{seq}` badge and `turn.ts`'s `resolveEditSourceIteration` both key off
the same `Iteration.seq`) — but nothing in the agent's context or
instructions tells it so, or gives it anything to ground a per-iteration
description in. Two gaps, verified against code:

1. `buildProjectContextBlock`/`summarizeStream` in `server/src/agent/
   turn.ts` gives the model only bare seq numbers plus `accepted`/`most
   recent` tags for each iteration — no content signal at all, and the
   model cannot see the images. With nothing to anchor a number to, it
   invents a description.
2. `SYSTEM_PROMPT_BASE` never states that the user's "iteration N" is
   exactly the UI's "Iteration N" and resolves to the same seq value —
   so the model hedges about a divergence that does not exist.

## Solution

1. Surface a short, per-seq content hint in PROJECT CONTEXT, for the
   active stream only, sourced from the already-persisted
   `Iteration.promptUsed` (the prompt — including edit instructions —
   that produced that iteration). No new persistence, no new external
   call: `promptUsed` is populated today for both fresh generations and
   edit-created iterations (verified in `realImageVisionClient.ts` —
   see Architecture § Codebase verification below).
2. Add a statement to `SYSTEM_PROMPT_BASE` that the user's iteration
   number is authoritative and identical to the UI seq and the
   `editSourceIteration` value — never to be second-guessed — and that
   the model must say plainly when it cannot identify an iteration
   rather than invent a description.

## Success Criteria

- PROJECT CONTEXT lists each iteration of the active stream by its seq
  with a short, accurate content hint derived from `promptUsed`.
- A regression/unit test asserts the context block ties each seq to its
  stored prompt summary, and that "iteration N" maps to seq N.
- The system prompt instructs the model to treat the user's iteration
  number as the UI seq and never to fabricate iteration content or hedge
  about numbering divergence.
- All existing turn/context tests pass (updated where the rendering
  format itself changes, per Impact on Existing Components below).

## Scope

### In Scope

- `server/src/agent/turn.ts`: `loadProjectContext`'s `Iteration` select,
  the `ProjectContextIteration` interface, `summarizeStream`/
  `summarizeIterations` (or an added sibling), and `SYSTEM_PROMPT_BASE`.
- Test updates/additions in `tests/server/agent-turn.test.ts` for the
  new PROJECT CONTEXT rendering and the new system-prompt statement.

### Out of Scope

- Vision-based per-iteration descriptions (`imaging.ts`'s
  `classifyAndDescribe`) — a documented, heavier alternative; not
  pursued this sprint (see Design Rationale).
- Any change to `resolveEditSourceIteration`'s resolution logic itself —
  already correct (sprint 010) and unchanged here.
- Any change to `generate_image`'s tool-definition description — already
  consistent with the new system-prompt statement, unchanged here.
- Schema changes — `Iteration.promptUsed` already exists; this sprint
  only starts reading it in one additional place.

## Test Strategy

Unit-level, in `tests/server/agent-turn.test.ts` (the existing PROJECT
CONTEXT / system-prompt test surface, no new test file needed):

- Update the two existing exact-string assertions that hard-code the
  active stream's bare `#seq (tags) -- N iterations` rendering (the
  `'includes the description in the PROJECT CONTEXT creative brief'`
  block's front-stream line, and the `'PROJECT CONTEXT iteration
  listing (sprint 010 ticket 001)'` block's front-stream line — both use
  `activeFace: 'front'`) to match the new hint-bearing format; leave
  their back-stream (non-active) assertions unchanged, confirming the
  hint is scoped to the active stream only.
- Add a test asserting a specific seq's rendered line contains that
  seq's stored `promptUsed` text (or a truncation of it), tying "seq N"
  to "iteration N" the user says.
- Add a test asserting an edit-created iteration (one produced via
  `editSourceIteration`, not a fresh generation) also carries a non-empty
  `promptUsed` and renders a hint — regression coverage confirming the
  already-correct population, per the issue's stated concern.
- Add a test asserting the new `SYSTEM_PROMPT_BASE` sentence(s) are
  present in the rendered system prompt (mirroring the existing
  `'Never ask the user for internal identifiers'` assertion style at
  line ~2071 of the current test file).
- Full existing suite must still pass unmodified elsewhere (no other
  describe block touches these functions).

## Architecture

**Sizing**: Compact (per the architecture-authoring skill's three-tier
scale) — one changed module (`server/src/agent/turn.ts`'s context-
building functions and its `SYSTEM_PROMPT_BASE` constant), no new
component, no new cross-module dependency, no dependency-direction
change, and no data-model change (`Iteration.promptUsed` already exists
in `schema.prisma`; this sprint only starts *selecting* it in one more
place). No diagrams — a single-module, no-new-dependency change is
exactly what Step 4 of the skill says to omit them for. Per the
sprint-planner's own binary effort gate this is "not trivial" (it
changes observable agent behavior and has acceptance criteria/tests),
so the full architecture self-review below still runs — the compact
sizing governs *how much* to write, not whether review happens.

### What Changed / Why

Two additions to the Agent Runtime module (`turn.ts`), both already
described under Solution above:

1. **Per-seq content hints in PROJECT CONTEXT.** `loadProjectContext`'s
   `iteration.findMany` select gains `promptUsed: true` (alongside the
   existing `seq`/`role`/`accepted`). The `ProjectContextIteration`
   interface gains a `promptUsed: string` field. A new rendering path —
   used only for the *active* stream's iterations inside
   `summarizeIterations` — renders each entry as `#N: "<truncated
   promptUsed>" (tags)` instead of the current bare `#N (tags)`; the
   *inactive* stream(s) keep today's bare rendering unchanged. A small
   truncation helper (e.g. `truncatePromptHint`, ~80 chars with an
   ellipsis) keeps a long edit-instruction prompt from bloating the
   system prompt indefinitely; an empty/missing `promptUsed` renders a
   plain "(no prompt recorded)" placeholder rather than an empty string,
   so the block never looks broken.
2. **A system-prompt trust statement.** `SYSTEM_PROMPT_BASE` gains a
   sentence stating that the user's "iteration N" is exactly the UI's
   "Iteration N" badge and the same seq `editSourceIteration` resolves
   against — they never diverge, so the model must never hedge that they
   might — and that the model must say so plainly when it cannot
   identify an iteration or its content, rather than inventing a
   description. This sits in the same constant, alongside the existing
   sentence about using `editSourceIteration` for edits (Sprint 007/010
   additions) — one paragraph, not a new block, since it is a single,
   general behavioral instruction like its neighbors, not per-turn data.

Both changes are additive within `turn.ts`'s existing internal shape:
no new exported function signatures beyond what a helper needs, no new
file, no new tool, no new Prisma model or column.

### Codebase verification: `promptUsed` for edit-created iterations

The issue flagged, as an open question, whether `promptUsed` is actually
recorded for iterations created via the sprint-010 edit path
(`editSourceIteration`), not just fresh generations — since a gap there
would mean the new content hint is silently missing for exactly the
iterations most likely to be discussed ("now change iteration 3"). This
was checked against current code, not assumed:

- `turn.ts`'s `dispatchToolCall` routes *every* `generate_image` call —
  fresh or edit — through the same `imageVisionClient.generateImage(...)`
  call. The only thing `editSourceIteration` changes is whether
  `modelParams.referenceImages` gets set (resolved via
  `resolveEditSourceIteration`); the prompt itself
  (`args.prompt`) flows through unconditionally, on both paths.
- `realImageVisionClient.ts`'s `generateImage` unconditionally calls
  `createIteration({ ..., promptUsed: input.prompt, ... })` — there is
  no branch that omits or nulls `promptUsed` for an edit call.
- The directly-model-invocable `create_iteration` tool (bypassing
  `generate_image` entirely) declares `promptUsed` as a **required**
  Zod field (`catalogTools.ts`'s `server.tool('create_iteration', ...)`),
  so that path cannot produce a row without it either.

**Conclusion: no code fix is needed for this concern** — `promptUsed` is
already populated on every path that creates an `Iteration` row, edit or
fresh. This sprint's ticket adds the regression test the issue asked
for (an edit-created iteration's `promptUsed` is non-empty and renders a
hint) to make that guarantee explicit and pin it against regression,
rather than adding a second ticket to "fix" something that already
works.

### Impact on Existing Components

- `summarizeStream`'s existing docstring rationale ("only seq/accepted,
  never `imagePath`, reach this text — a raw filesystem path is exactly
  the kind of internal identifier the model should never see") is
  **preserved, not weakened**: `promptUsed` is a prompt string the model
  itself supplied (or a user-facing edit instruction), never a
  filesystem path or internal id — the two existing `not.toContain(
  'iterations/')` / `not.toContain('.png')` test assertions continue to
  hold with the new field added.
- `generate_image`'s tool-definition description (`WORKSPACE_TOOL_
  DEFINITIONS`) already reads "Pass the iteration number shown in
  PROJECT CONTEXT to edit that specific iteration" — already consistent
  with the new system-prompt statement; left unchanged.
- `resolveEditSourceIteration` and the exact-seq-match resolution logic
  are unchanged — they were already correct per the issue's own
  findings; this sprint only changes what the model is *told* and
  *shown*, not how a number resolves server-side.
- Two existing test assertions in `tests/server/agent-turn.test.ts`
  hard-code the current bare-rendering format for an *active* stream
  (`'front: #1 (accepted, most recent) -- 1 iteration'` and `'front: #1,
  #2 (accepted), #3 (most recent) -- 3 iterations'`, both under
  `activeFace: 'front'`); these must be updated to the new hint-bearing
  format as part of this sprint's ticket. Their sibling back-stream
  (non-active) assertions on the same lines are unaffected, since the
  inactive stream keeps the old bare rendering.

### Design Rationale

**Decision: `promptUsed` (already persisted) over a vision-based
description, for the content hint.**
- *Context*: the issue itself named `imaging.ts`'s `classifyAndDescribe`
  (OpenRouter vision) as a possible source for a richer per-iteration
  description, but flagged it explicitly as "optional/heavier" and asked
  planning to weigh cost/latency.
- *Alternatives considered*: (a) `promptUsed`, already stored, zero
  marginal cost or latency to read; (b) a stored vision description via
  `classifyAndDescribe`, called once per iteration and cached; (c)
  `classifyAndDescribe` called fresh every turn for every iteration in
  the active stream.
- *Why this choice*: (c) is a non-starter under D8 (`runTurn` is
  stateless and re-derives context from the DB on every call) — it would
  mean a fresh OpenRouter vision call per iteration on every single
  turn, an unbounded and unpredictable per-message cost/latency hit for
  a project with any real iteration history. (b) would work, but
  requires a place to persist the description (a new column or table),
  which crosses this sprint into the substantial tier for what is, at
  bottom, a context-formatting problem — and the issue's own acceptance
  criteria only ask for a hint "from `promptUsed`," not a vision
  description. (a) needs no new call, no new persistence, and is already
  exactly the text a human would use to describe "what happened in this
  iteration" (the prompt, including edit instructions) — it directly
  answers "what does iteration 3 contain" for the common case, at
  read-cost of a column already in the `select`.
- *Consequences*: for an iteration whose `promptUsed` is terse or vague
  (e.g. a short edit instruction like "make it brighter" with no
  standalone description of the resulting image), the hint is
  correspondingly thin — an accepted limitation, not silently hidden:
  the new system-prompt statement explicitly tells the model to say
  plainly when it cannot describe an iteration's content rather than
  compensate by inventing detail. A future sprint could layer a cached
  vision description on top of this (additive, not a rework) if terse
  prompts prove to be a recurring problem in practice.

**Decision: content hints for the active stream only, not both
streams.**
- *Context*: `summarizeIterations` currently renders both `front` and
  `back` streams every turn, regardless of which is active.
- *Alternatives considered*: hint every stream's iterations; hint only
  the active stream's.
- *Why this choice*: matches the issue's own acceptance criterion
  verbatim ("PROJECT CONTEXT lists each iteration by its seq with a
  short, accurate content hint ... for the active stream"), and bounds
  system-prompt growth to the stream the user is actually working in —
  a project with a long history on both streams does not double its
  per-turn prompt-token cost for hints on the stream not currently in
  play. The inactive stream keeps today's bare seq/tag listing, which
  is enough to support "switch to the back and edit iteration 2"-style
  requests (the number/tag/existence information a switch needs) without
  a redundant hint that would only be read once the user actually
  switches — at which point that stream becomes active and gains hints
  in the next turn.
- *Consequences*: a request that references a *specific* iteration on
  the currently-inactive stream by number (e.g. "what was in back
  iteration 2, while I'm on front") still resolves correctly by seq —
  resolution is unaffected — but the model won't have a content hint for
  it and, per the new system-prompt statement, should say so plainly
  rather than fabricate. This is judged an acceptable, narrow edge case
  relative to the token-cost savings of the common case.

### Migration Concerns

None. No schema change, no data migration, no new environment variable,
no deployment-sequencing dependency — this sprint changes only what one
existing module reads from an existing column and what one existing
constant says. Fully backward compatible: a project with iterations
whose `promptUsed` happens to be empty (should not occur given the
schema's non-null `String` column and the tool's required-field
validation, but handled defensively) degrades to the "(no prompt
recorded)" placeholder rather than breaking context construction.

### Architecture Self-Review

Run per the `architecture-review` skill's five categories.

**Consistency**: What Changed/Why's two additions (per-seq active-stream
content hints; the `SYSTEM_PROMPT_BASE` trust statement) match Solution,
Success Criteria, and both SUC-022/SUC-023 acceptance criteria exactly —
every place in this document describes the same two changes with no
contradiction. The Codebase Verification subsection's conclusion ("no
code fix needed" for `promptUsed` population) is consistent with Scope's
"Out of Scope" listing that decision explicitly, and with the Test
Strategy adding a regression test rather than a fix. Design Rationale's
"active stream only" decision matches Impact on Existing Components'
statement that only the active-stream assertions need updating. PASS.

**Codebase Alignment**: verified against the actual current files, read
in full during planning, not assumed from the issue's own claims.
`turn.ts`'s `loadProjectContext` (lines 517-546) confirmed to select
only `seq`/`role`/`accepted` today. `ProjectContextIteration` (lines
495-499) confirmed to declare only those same three fields.
`summarizeStream`/`summarizeIterations` (lines 563-598) confirmed to
render only seq numbers and accepted/most-recent tags, never a content
signal. `SYSTEM_PROMPT_BASE` (lines 474-479) confirmed to already
instruct correct `editSourceIteration` usage but to say nothing about
UI-seq/internal-seq identity. `Iteration.promptUsed` (`schema.prisma`
line 110) confirmed to be a required, non-null `String` column, already
present — no migration needed to add the `select` field. The
edit-created-iteration population claim was independently traced end to
end: `dispatchToolCall` (turn.ts lines 878-916) → `resolveEditSourceIteration`
(only touches `modelParams.referenceImages`, never `args.prompt`) →
`realImageVisionClient.ts`'s `generateImage` (lines 123-183, confirmed
to unconditionally pass `promptUsed: input.prompt` to `createIteration`
regardless of whether `modelParams.referenceImages` was set) →
`catalogTools.createIteration` (lines 664-695, confirmed to persist
`args.promptUsed` verbatim, no branch that drops it). `OutputPane.tsx`
line ~193 confirmed to render `Iteration {iteration.seq}` exactly as the
issue states. `tests/server/agent-turn.test.ts` lines 329-336 and
1073-1096 confirmed to be the two existing describe blocks whose
exact-string assertions this sprint's ticket must update, both
identified precisely (line numbers and current asserted strings) rather
than described vaguely. No drift found between documented and actual
current-state code. PASS.

**Design Quality**: *Cohesion* — `loadProjectContext`,
`summarizeIterations`, and `SYSTEM_PROMPT_BASE` each keep their existing,
narrowly-stated one-sentence purpose ("load the project's
context-relevant rows," "render what exists so far as a stream
listing," "state the agent's fixed behavioral rules") — this sprint
deepens what each already does, it does not merge new concerns into
them. *Coupling* — no new dependency introduced; the change reads one
already-selected-adjacent column and reuses the existing
`activeFace` parameter `buildProjectContextBlock` already threads
through to `summarizeIterations`. *Boundaries* — the
`ProviderAdapter`/tool-dispatch seam is untouched; this sprint stays
entirely on the context-assembly side of that boundary, same as
`turn.ts`'s existing division of concerns. *Dependency direction* —
unchanged: Agent Runtime (Domain) still depends only on the Catalog
Store (Prisma) for this read, an Infrastructure-layer dependency in the
existing direction, no new edge. PASS.

**Anti-Pattern Detection**: no god component — `turn.ts` gains a small
amount of formatting logic inside functions that already own exactly
that responsibility (rendering the iteration listing, stating agent
rules); it does not centralize new, unrelated concerns into it. No
shotgun surgery — confined to one file (`turn.ts`) and its one test
file; no other module references `ProjectContextIteration`,
`summarizeStream`, or `SYSTEM_PROMPT_BASE`. No feature envy — the new
code reads only fields already on the `Iteration` row it already
queries, not reaching into another module's internals. No circular
dependencies (no new edges at all). No leaky abstraction — `promptUsed`
is exposed exactly as what it already is (a prompt string), not
repurposed as a stand-in for something it isn't; the existing
raw-path/internal-id exclusion is preserved and tested (Impact on
Existing Components). No speculative generality — the vision-based
alternative (`classifyAndDescribe`) is explicitly declined for this
sprint's scope (Design Rationale) rather than spuriously half-built;
nothing here serves a hypothetical beyond this issue's stated
acceptance criteria. PASS — no anti-pattern found requiring rework.

**Risks**: no data migration, no breaking change, no deployment-sequencing
concern (Migration Concerns: None). The one real risk is prompt-token
growth from per-iteration hints on a project with a long-running active
stream — mitigated by the ~80-char truncation helper and by scoping
hints to the active stream only (Design Rationale), both stated design
decisions rather than unaddressed exposure. A secondary, accepted risk:
a terse `promptUsed` (e.g. "make it brighter") yields a correspondingly
thin hint — explicitly named as a consequence in Design Rationale, with
the system-prompt statement's "say so plainly" instruction as the
mitigation, not silently left as a gap.

### Verdict: **APPROVE**

No structural issues — no circular dependencies, no god component, no
inconsistency between this section and the rest of the document. This is
a contained, single-module change that adds a read of an
already-persisted, already-required column and one clarifying sentence
to an existing prompt constant; the one thing the issue asked planning
to actively verify (edit-path `promptUsed` population) was traced
through the real call chain and confirmed already correct, not assumed.
Proceeding to ticketing.

## Use Cases

### SUC-022: Agent describes a referenced iteration's content accurately
Parent: UC-006 (Generate and iterate images)

- **Actor**: Project owner, chatting with the agent about an existing
  project with one or more iterations on the active stream.
- **Preconditions**: The active stream has at least one `Iteration` row
  with a non-empty `promptUsed`.
- **Main Flow**:
  1. User references an iteration by number (e.g. "what's in iteration
     3?" or "iteration 3 looks off").
  2. The turn's PROJECT CONTEXT includes a per-seq content hint for the
     active stream, sourced from that iteration's `promptUsed`.
  3. The agent's reply describes iteration 3 using that hint — grounded
     in the actual recorded prompt, not invented.
- **Postconditions**: The agent's description of the referenced
  iteration is consistent with its stored `promptUsed`; no fabricated
  content is presented as fact.
- **Exception**: If the referenced seq does not exist, or its
  `promptUsed` yields no usable hint (e.g. missing/placeholder), the
  agent states plainly that it cannot identify the iteration or its
  content, rather than inventing a description.
- **Acceptance Criteria**:
  - [ ] PROJECT CONTEXT's active-stream listing includes each seq's
        content hint, derived from `promptUsed`.
  - [ ] A test asserts a specific seq's rendered hint contains that
        seq's stored `promptUsed` text.
  - [ ] A test asserts an edit-created iteration also carries a usable
        `promptUsed` hint (regression coverage for the already-correct
        population).

### SUC-023: Agent treats the user's iteration number as authoritative
Parent: UC-006 (Generate and iterate images)

- **Actor**: Project owner, chatting with the agent.
- **Preconditions**: None beyond an active project/turn.
- **Main Flow**:
  1. User references "iteration N" in chat, in any context (a question,
     an edit request, a comparison).
  2. The agent treats N as exactly the seq shown as "Iteration N" in the
     UI and the value it would pass as `editSourceIteration` — the same
     number, never a different internal count.
  3. The agent proceeds (answering, or calling `generate_image` with
     `editSourceIteration: N`) without hedging that the UI numbering and
     its own numbering might not line up.
- **Postconditions**: No agent response ever claims or implies that the
  UI's iteration numbering and the number it resolves against might
  diverge — because they never do.
- **Exception**: If the agent genuinely cannot resolve iteration N (no
  such seq exists for this project), it states that plainly (mirroring
  `resolveEditSourceIteration`'s existing "no iteration #N found" error
  surfaced via `isError`), rather than hedging about numbering itself
  being unreliable.
- **Acceptance Criteria**:
  - [ ] `SYSTEM_PROMPT_BASE` states that the user's iteration number is
        the UI seq and the `editSourceIteration` value, and that they
        never diverge.
  - [ ] A test asserts this statement is present in the rendered system
        prompt.
  - [ ] `SYSTEM_PROMPT_BASE` instructs the model to state plainly when
        it cannot identify an iteration, rather than fabricate.

## GitHub Issues

None — this sprint addresses only `agent-iteration-number-grounding.md`,
a local CLASI issue with no linked GitHub issue.

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [x] Sprint planning document is complete (sprint.md, including its
      Architecture and Use Cases sections)
- [ ] Architecture review passed (or skipped, for changes with no
      architectural impact)
- [ ] Stakeholder has approved the sprint plan

## Tickets

| # | Title | Depends On |
|---|-------|------------|
| 001 | Ground iteration numbering: per-seq content hints + system-prompt trust statement | — |

Tickets execute serially in the order listed.

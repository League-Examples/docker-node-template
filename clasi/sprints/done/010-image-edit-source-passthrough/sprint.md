---
id: '010'
title: Image Edit Source Passthrough
status: closed
branch: sprint/010-image-edit-source-passthrough
worktree: false
use-cases:
- SUC-018
- SUC-019
- SUC-020
issues:
- image-edits-must-pass-source-image.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 010: Image Edit Source Passthrough

## Goals

Make "edit this image" requests actually edit an image. Feed the model
enough context to identify which prior iteration is the source of an
edit, and have the turn controller resolve that choice to a real
workspace file and pass it through `modelParams.referenceImages` so
`imaging.ts` runs the OpenAI edits path (`callOpenAiEdits`) instead of
silently degrading to a fresh text-to-image generation.

## Problem

Diagnosed 2026-07-18
(`clasi/issues/image-edits-must-pass-source-image.md`): the plumbing for
edit-style generation already exists —`generate_image` accepts
`modelParams.referenceImages`, and `imaging.ts` already routes to
`callOpenAiEdits` whenever one or more reference images are present —
but nothing ever feeds it. The PROJECT CONTEXT block the turn controller
folds into the system prompt exposes only per-stream counts and the
accepted iteration's number (`summarizeIterations`); it never exposes
individual iterations by number or their file paths. The model therefore
has nothing it could put in `modelParams.referenceImages`, so every
"edit this" request degrades to an unrelated fresh generation.

Stakeholder-decided source-image selection semantics (2026-07-19, fixed
inputs to this sprint, not re-litigated here):
- Default source = the **last** (most recent by `seq`) iteration on the
  active face — not necessarily the `accepted` one.
- A user-named iteration ("use iteration three") overrides the default.
- No prior iteration on the active face → plain text-to-image, no
  regression.

## Solution

The model decides *whether* a request is an edit and *which* iteration
is the source (only the model can tell "change the sky color" apart from
"make something totally different," and only the model can resolve an
ordinal like "iteration three" from the user's own words). It expresses
that decision as a new, optional `generate_image` argument,
`editSourceIteration` (an iteration number, or the literal `"last"`) —
never a raw filesystem path. The turn controller resolves that number to
the real `Iteration.imagePath`, validates it through the existing
`resolveWorkspacePath` containment check, and sets it as
`modelParams.referenceImages` before calling the (unchanged)
`ImageVisionClient`. See the Architecture section's Design Rationale for
the full alternatives analysis (model-supplied raw paths vs. deterministic
server-side edit/generate classification vs. this hybrid).

## Success Criteria

- An "edit this image" request with no named iteration produces a new
  iteration derived from the most recent iteration on the active
  stream — not necessarily the accepted one.
- Naming a specific iteration ("use iteration three") overrides the
  default and edits that iteration instead.
- The generation call for an edit includes the resolved source path in
  `modelParams.referenceImages`, exercising `callOpenAiEdits`.
- A plain "generate something new" request, or any edit-style request on
  a stream with no prior iterations, still uses `callOpenAiGenerations`
  — no regression.
- The model never needs to know, construct, or transcribe a raw
  filesystem path to make an edit request.

## Scope

### In Scope

- `server/src/agent/turn.ts`:
  - `generate_image`'s `WORKSPACE_TOOL_DEFINITIONS` entry: remove the
    dead top-level `referenceImages` property (never forwarded by
    `dispatchToolCall` today — its own description already tells the
    model not to use it); add `editSourceIteration` (number or `"last"`,
    optional).
  - `buildProjectContextBlock`/`summarizeIterations`: list each stream's
    iteration numbers (marking the accepted one and the most recent one)
    instead of counts-only.
  - `dispatchToolCall`'s `IMAGE_GENERATION_TOOL_NAME` branch: a new
    pre-dispatch resolver that turns `editSourceIteration` into a
    validated, workspace-rooted path, sets it as
    `modelParams.referenceImages`, and discards any raw
    `modelParams.referenceImages` the model supplied directly.
  - `SYSTEM_PROMPT_BASE`: one added sentence directing the model to use
    the iteration list/`editSourceIteration` rather than ever asking the
    user for a file or path.
- Test coverage for all of the above (see Test Strategy).

### Out of Scope

- Any client/UI change — no "pick a source image" control; selection is
  entirely conversational/inferred from chat, matching how `activeFace`
  and every other turn-level signal already works.
- `imaging.ts`, `realImageVisionClient.ts`, `routes/chat.ts` — all
  unchanged; their contracts are already correct once fed (this sprint's
  own diagnosis and Architecture section confirm this).
- Any `Iteration`/`Project` schema change — `seq`/`imagePath`/`role`/
  `accepted` already carry everything this sprint needs.
- New validation restricting a named iteration to the active face —
  naming iteration N resolves the same regardless of which face it
  belongs to; the sprint does not add a cross-face rejection rule.
- Multi-image edits — the OpenAI edits endpoint accepts more than one
  `image[]` part, but this sprint only ever resolves a single source
  image per the stakeholder's decision.

## Test Strategy

Vitest coverage entirely within the existing
`tests/server/agent-turn.test.ts` suite (existing fixture and mock-
`ProviderAdapter` conventions; no new test file needed). Two layers:
narrow tests of the new resolver and the PROJECT CONTEXT rendering
change in isolation (ticket 001), and full `runTurn` integration tests
exercising the mock provider plus an injected `ImageVisionClient` spy
across the three stakeholder-decided scenarios, a same-turn staleness
case, and a path-injection hardening case (ticket 002). No new external
API surface is added, so no new contract test is needed;
`tests/server/imaging.test.ts` and
`tests/server/real-image-vision-client.test.ts` are expected to pass
unmodified since neither module changes.

## Architecture

**Compact** — one existing module changes (`server/src/agent/turn.ts`):
a tool-schema field swap, a PROJECT CONTEXT rendering change, and one
new pre-dispatch resolver following an existing precedent
(`injectCreateProjectArgs`). No new component, no data-model change, and
no new cross-subsystem dependency-direction edge — the one new import
(`resolveWorkspacePath`) is reuse of a shared Infrastructure-layer helper
two other Agent-layer files already call, not a new subsystem edge.
Full section structure below per the architecture-authoring skill's
compact tier, diagrams omitted per Step 4 with reasons stated. The
review gate below still runs in full — "compact" is not the "trivial/
small" tier the sprint-planner's gate-skip rule reserves for "N/A"
sections; only the document's *shape* (no diagrams, prose sized to one
module) follows the compact tier.

### Architecture Overview

**Problem / responsibilities (Steps 1-2)**: the root cause is a context
gap, not a missing capability — `generate_image`/`imaging.ts` already
implement the edit path correctly. The one responsibility this sprint
changes is **how the Agent Runtime turn controller translates a
`generate_image` tool call's edit intent into resolved reference-image
bytes for the Image & Vision Service** — closing the gap between "model
wants to edit iteration N" and "`imaging.ts` receives
`referenceImages` pointing at a real file."

**Module (Step 3)**: Agent Runtime (`server/src/agent/turn.ts`) is the
sole module touched. Purpose (no "and"): *translate this turn's tool
calls, active stream, and the project's iteration history into fully-
resolved arguments for the Workspace MCP Server tools and the Image &
Vision Service adapter.* Boundary: gains (a) an `editSourceIteration`
parameter on `generate_image` (replacing the vestigial, never-wired
top-level `referenceImages` property), (b) a per-stream iteration-number
listing in the PROJECT CONTEXT block (replacing the count-and-accepted-
only summary), and (c) a new pre-dispatch resolver — same shape and
call site as the existing `injectCreateProjectArgs` — that turns
`editSourceIteration` + `activeFace` + a fresh DB read into a validated,
workspace-rooted path, sets it as `modelParams.referenceImages`, and
discards any raw path the model supplied directly. Serves: SUC-018,
SUC-019, SUC-020 below. `ImageVisionClient`, `realImageVisionClient.ts`,
and `imaging.ts` are unchanged — confirming the issue's own "the
infrastructure exists" diagnosis.

**Diagram (Step 4)**: omitted. Only one module changes; no new
subsystem, no new cross-subsystem edge, no data-model change — the same
shape Sprint 009 used to justify omitting all diagrams for a compact
update.

**What changed / why / impact (Step 5)**:

*What changed*:
1. `WORKSPACE_TOOL_DEFINITIONS`'s `generate_image` entry: remove the
   dead top-level `referenceImages` property; add `editSourceIteration`
   (an iteration number, or the literal `"last"`; optional) with a
   description telling the model when and how to set it.
2. `buildProjectContextBlock`/`summarizeIterations`: change from
   `"front: 3 (accepted: #2)"` to a per-stream listing of iteration
   numbers with the accepted one and the most recent one both marked —
   e.g. `"front: #1, #2 (accepted), #3 (most recent) — 3 iterations"`,
   `"back: no iterations yet"` — enough for the model to map "iteration
   three" or "the last one" to a `seq`, without ever putting a raw
   filesystem path in the prompt.
3. `dispatchToolCall`'s `IMAGE_GENERATION_TOOL_NAME` branch: before
   calling `imageVisionClient.generateImage`, resolve
   `args.editSourceIteration` (if present) against a fresh DB read
   (never the turn-start `ProjectContext` snapshot — see Design
   Rationale for why that matters within one multi-round turn), convert
   the resolved `Iteration.imagePath` through `resolveWorkspacePath`
   (the same containment helper `catalogTools.ts`/
   `realImageVisionClient.ts` already use), and set the result as
   `modelParams.referenceImages`. Any `modelParams.referenceImages` the
   model supplied directly is discarded, whether or not
   `editSourceIteration` was also set.
4. `SYSTEM_PROMPT_BASE`: one added sentence, in the same style as the
   Sprint 007 internal-ID guardrail, directing the model to use the
   PROJECT CONTEXT iteration list and `editSourceIteration` rather than
   ever asking the user to supply a file or path.

*Why*: this closes exactly the gap the issue diagnoses. Routing the
decision through an iteration number rather than a raw path keeps
"which image" a modeling decision (only the model can tell an edit
request from a fresh-generation request, and only the model can resolve
an ordinal like "iteration three" from natural language) while keeping
"what path is that" a deterministic, server-owned lookup — the same
responsibility split `injectCreateProjectArgs` already established for
`create_project`'s `ownerUserId`/`version` gaps, now extended to a
second tool.

*Impact on existing components*: `imaging.ts`, `realImageVisionClient.ts`,
and `routes/chat.ts` are unchanged — `ImageVisionClient.generateImage`'s
contract (`prompt`/`projectId`/`modelParams`/`activeFace`) is exactly as
Sprint 004 left it. Existing `generate_image` calls that omit
`editSourceIteration` (every call today, and every genuine "make
something new" request going forward) behave identically to today — no
`referenceImages` is set, `imaging.generateImage` takes the
`callOpenAiGenerations` branch exactly as now (Success Criteria's
no-regression requirement). The PROJECT CONTEXT rendering change is
visible to the model only; no persisted data or API response shape
changes.

### Design Rationale

**Decision: the model decides edit-vs-new and which iteration, by
number; the server resolves that number to a real path — not
model-supplied raw paths, and not a deterministic server-side
edit/generate classifier.**

- **Context**: the issue's own root-cause write-up proposed exposing
  `Iteration.imagePath` directly in PROJECT CONTEXT and letting the
  model place it straight into `modelParams.referenceImages`. This
  sprint's brief asked that plan to be weighed against a hybrid where
  the server resolves seq→path.
- **Alternatives considered**:
  - *(a) Model handles raw paths directly* (the issue's original
    proposal) — expose `imagePath` in PROJECT CONTEXT, let the model
    copy it into `modelParams.referenceImages` itself. Rejected: every
    path the model emits into a tool call becomes untrusted input
    reaching `imaging.ts`'s `callOpenAiEdits`, which calls
    `fs.readFile(refPath)` directly with **no containment check of its
    own** — unlike every other workspace-path consumer in this
    codebase, all of which resolve through `resolveWorkspacePath`
    first. It also bakes today's fixed path-naming scheme
    (`projects/<id>/iterations/iter-<seq>.png`) into prompt text the
    model must reproduce exactly on every edit call — a second, needless
    way to fail.
  - *(b) Fully deterministic server-side classification* — have
    `turn.ts` itself decide "is this message an edit request" (a
    keyword/regex heuristic over `input.message`) and auto-inject the
    last iteration's path whenever it guesses yes, with no model
    involvement. Rejected: "edit this" vs. "make something new but
    similar" is a natural-language judgment call only the model reliably
    makes; a heuristic misfires in both directions (treating "change my
    mind, make something totally different" as an edit; missing an edit
    request phrased without a trigger word) and still can't resolve
    "iteration three" without re-deriving the NLU the model already does
    for free.
  - *(c) Hybrid — model signals edit-vs-new and which iteration by
    number; server resolves the number to a path* (chosen): the model
    already parses the user's message every turn and already sees
    per-iteration numbers in PROJECT CONTEXT, so one small, structured
    signal (`editSourceIteration`, or omit it) costs it nothing new to
    reason about, while the filesystem path is constructed and validated
    entirely server-side — the same division of labor
    `injectCreateProjectArgs` already uses for `create_project`.
- **Why this choice**: (c) preserves the flexibility (a) offers — only
  the model can tell an edit from a fresh generation, and only the model
  can resolve an ordinal like "iteration three" — while eliminating the
  exact risk (a) introduces (untrusted raw paths reaching an unvalidated
  `fs.readFile`) and the exact brittleness (b) introduces (guessing
  intent without the model's language understanding). It also directly
  satisfies the internal-ID guardrail's spirit (Sprint 007): a
  filesystem path is exactly the kind of internal, implementation-owned
  identifier the model should never need to originate or transcribe —
  the same reasoning that already keeps `projectId`/`ownerUserId`/
  `version` out of every tool's model-facing schema.
- **Consequences**: `turn.ts` gains one new pre-dispatch resolver and a
  slightly richer PROJECT CONTEXT render; `generate_image`'s schema
  gains one optional field and loses one dead one. The `"last"`
  sentinel is resolved fresh against the DB at dispatch time rather than
  from the turn-start `ProjectContext` snapshot, so it can't go stale
  within a single multi-round turn (e.g., a turn that generates once,
  then is asked to "now change the color of that" later in the same
  turn) — a small but deliberate correctness detail, since
  `ProjectContext` is otherwise loaded once per turn. A named-but-
  nonexistent iteration number surfaces as a normal tool error through
  the existing `isError`/catch path already wired for every other tool,
  rather than a new failure channel.

**Decision: silently discard any model-supplied `modelParams.referenceImages`
rather than accept-if-present.**

- **Context**: today's schema nominally allows the model to nest raw
  paths under `modelParams.referenceImages`, though nothing currently
  populates it in practice — this is the same latent gap named in
  alternative (a) above.
- **Alternatives**: accept it as a fallback when `editSourceIteration`
  is absent (more "permissive"); reject the whole call with an error
  when it's present (noisy — a model that never learns the new field
  name would get a worse failure instead of a working default).
- **Why this choice**: the only sanctioned way to reference a prior
  image is now by iteration number; quietly stripping an unexpected
  raw-path value means a stale provider prompt cache or an off-spec
  model response degrades to "the value is ignored," never to an
  unvalidated-path security issue and never to a hard failure over a
  field the model was never told to omit.
- **Consequences**: no external behavior change for any caller that
  never used the old field (i.e., everyone — it was never wired up);
  this closes the latent path-injection gap as a side effect of
  activating the feature, rather than leaving it for a future sprint to
  notice once real traffic starts populating it.

### Migration Concerns

None. No data-model change — existing `Iteration.seq`/`imagePath`/
`role`/`accepted` columns, already populated by every prior sprint's
iterations, are read but never written differently. No API/DTO shape
change visible outside the model-facing tool schema and system prompt
text. No backward-compatibility break — every existing `generate_image`
call that omits `editSourceIteration` behaves exactly as before.
Single-module change (`turn.ts` only), so no deployment-sequencing risk
beyond a normal server rebuild/restart.

### Architecture Self-Review

Run per the `architecture-review` skill's five categories.

**Consistency**: the Architecture Overview's "what changed" (three
`turn.ts` edits: tool schema, PROJECT CONTEXT rendering, dispatch
resolver) matches the Design Rationale's two decisions and the Use
Cases' acceptance criteria — all describe the same seq-based,
server-resolved edit-source mechanism. Migration Concerns' "None" is
consistent with the Overview's explicit "`imaging.ts`/
`realImageVisionClient.ts`/`chat.ts` unchanged" claim. PASS.

**Codebase Alignment**: verified against the actual current files, read
in full during planning. `server/src/agent/turn.ts` confirmed to define
`summarizeIterations` as counts-plus-accepted-seq only (no per-iteration
listing today), a `generate_image` tool-definition entry carrying the
vestigial top-level `referenceImages` property whose own description
text tells the model not to use it, and a `dispatchToolCall` branch that
destructures only `{ prompt, modelParams }` from `call.args`, forwarding
`modelParams` unmodified — confirming that a model-supplied
`modelParams.referenceImages` today would in fact reach `imaging.ts`
unvalidated, exactly the latent gap the Design Rationale names.
`server/src/services/imaging.ts`'s `callOpenAiEdits` confirmed to call
`fs.readFile(refPath)` directly with no `resolveWorkspacePath`
containment check. `server/src/services/workspaceDirectorySync.ts`'s
`resolveWorkspacePath` confirmed synchronous, throwing on any path that
resolves outside the workspace root — the exact function this sprint's
resolver reuses. `server/prisma/schema.prisma`'s `Iteration` model
confirmed to already carry `seq`/`imagePath`/`role`/`accepted` with no
schema change needed. No drift between documented and actual
current-state code.

**Design Quality**: *Cohesion* — the Agent Runtime's purpose sentence
already covers `injectCreateProjectArgs`; this sprint's resolver is the
same responsibility applied to a second tool, not a new one. *Coupling*
— `turn.ts` gains a direct call to `resolveWorkspacePath` (already
transitively part of the Agent Runtime's dependency footprint via the
tools it dispatches to) and one more `prismaClient.iteration` read (a
table it already reads in `loadProjectContext`); no new external
dependency, no change to `ImageVisionClient`'s interface, no fan-out
increase for any other module. *Boundaries* — the `ImageVisionClient`
seam stays narrow and unchanged (`prompt`/`projectId`/`modelParams`/
`activeFace`); "which path is the source" resolution stays entirely on
the Agent Runtime side of that seam, never leaking into the Image &
Vision Service. *Dependency direction* — unaffected; Agent Runtime
(Domain layer) calling `resolveWorkspacePath` (Infrastructure layer)
matches the existing Presentation→Domain→Infrastructure direction, the
same direction `catalogTools.ts` and `realImageVisionClient.ts` already
call it in. PASS.

**Anti-Pattern Detection**: no god component — `turn.ts` gains one more
narrowly-scoped pre-dispatch resolver, the same shape as
`injectCreateProjectArgs`, not a new do-everything function. No shotgun
surgery — one module, one tool's dispatch branch, one prompt-rendering
function; `imaging.ts`/`realImageVisionClient.ts`/`chat.ts` untouched.
No feature envy — the resolver reads `Iteration` rows through the
existing Prisma client the same way `loadProjectContext` already does,
not by reaching around any other module's internals. No circular
dependencies (single-module change; no new edge in the module graph).
No leaky abstraction — the raw path never crosses into the prompt or the
model-facing schema; the model only ever sees/emits a seq number,
exactly the abstraction level the internal-ID guardrail calls for. No
speculative generality — no configurability beyond the three
stakeholder-decided cases (named iteration, last iteration, no
iteration). PASS.

**Risks**: the one security-relevant item this sprint touches is the
pre-existing, previously-latent `callOpenAiEdits` unvalidated-
`fs.readFile` gap (Design Rationale) — this sprint closes it as a
required part of activating the feature, not as separately-scoped
hardening; flagged here so it isn't mistaken for scope creep. No data
migration. No breaking API change. No deployment-sequencing risk
(single module, no schema migration). Test-coverage risk: the "last
iteration" resolution must be verified fresh-per-dispatch (not stale
from turn start) and the no-prior-iteration fallback must be verified to
degrade silently rather than error — both flagged in Test Strategy and
ticket acceptance criteria below.

### Verdict: **APPROVE**

No structural issues — no circular dependencies, no god component, no
inconsistency between the Overview and the rest of the document. This
is a contained, single-module fix with one incidental, justified
hardening change (path containment on the edit-source resolution)
bundled in because it sits on the exact code path this sprint activates.
Proceeding to ticketing.

## Use Cases

### SUC-018: Edit the most recent iteration by default
Parent: UC (iteration review / postcard generation flow)

- **Actor**: Project owner chatting with the agent about an existing
  postcard face.
- **Preconditions**: The active stream (front or back) has at least one
  prior iteration.
- **Main Flow**:
  1. User asks to change something about the current image ("make the
     sky more orange") without naming a specific iteration.
  2. The model recognizes this as an edit of the existing image, not a
     fresh generation, and calls `generate_image` with
     `editSourceIteration: "last"`.
  3. The turn controller resolves `"last"` to the most recent
     iteration's row on the active stream (by `seq`, not necessarily the
     `accepted` one) and passes its file as `modelParams.referenceImages`.
  4. `imaging.ts` routes the call through `callOpenAiEdits` (not
     `callOpenAiGenerations`).
  5. A new iteration is recorded, visibly derived from the source image.
- **Postconditions**: The new iteration is a modification of the most
  recent prior iteration, not an unrelated image.
- **Acceptance Criteria**:
  - [ ] An "edit this" request with no named iteration edits the most
        recent iteration on the active stream, not necessarily the
        accepted one.
  - [ ] The generation call includes the resolved source path in
        `modelParams.referenceImages`.
  - [ ] `imaging.ts` selects `callOpenAiEdits` for this call.

### SUC-019: Edit a specifically named iteration
Parent: UC (iteration review / postcard generation flow)

- **Actor**: Project owner chatting with the agent about an existing
  postcard face.
- **Preconditions**: At least one iteration exists with the number the
  user names.
- **Main Flow**:
  1. User asks to edit a specific iteration by number ("use iteration
     three and make it brighter").
  2. The model calls `generate_image` with `editSourceIteration: 3`.
  3. The turn controller resolves iteration 3's row (by `seq`,
     project-scoped) and passes its file as `modelParams.referenceImages`,
     regardless of whether iteration 3 is the currently-accepted one or
     on the active stream.
  4. `imaging.ts` routes the call through `callOpenAiEdits`.
- **Postconditions**: The new iteration is a modification of the named
  iteration specifically.
- **Acceptance Criteria**:
  - [ ] Naming a specific iteration number overrides the "last
        iteration" default.
  - [ ] The resolved source path corresponds to the named iteration, not
        the most recent one, when they differ.
  - [ ] Naming a nonexistent iteration number surfaces as a plain tool
        error the model can report, not a silent fallback or a crash.

### SUC-020: Fresh generation with no prior iteration (no regression)
Parent: UC (iteration review / postcard generation flow)

- **Actor**: Project owner chatting with the agent, starting a new
  stream.
- **Preconditions**: The active stream has no prior iterations.
- **Main Flow**:
  1. User asks for a new image (or asks to "change" something with
     nothing yet to change).
  2. The model calls `generate_image` with no `editSourceIteration` (or
     `"last"` when nothing exists yet on that stream).
  3. The turn controller finds no matching iteration to resolve and
     leaves `modelParams.referenceImages` unset.
  4. `imaging.ts` routes the call through `callOpenAiGenerations`,
     exactly as before this sprint.
- **Postconditions**: Behavior identical to pre-sprint text-to-image
  generation; no error surfaced for the "nothing to edit yet" case.
- **Acceptance Criteria**:
  - [ ] A plain "generate a new image from scratch" request still uses
        `callOpenAiGenerations`.
  - [ ] An edit-style request on a stream with zero prior iterations
        falls back to fresh generation without error.

## GitHub Issues

(none)

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [ ] Sprint planning document is complete (sprint.md, including its
      Architecture and Use Cases sections)
- [ ] Architecture review passed (or skipped, for changes with no
      architectural impact)
- [ ] Stakeholder has approved the sprint plan

## Tickets

| # | Title | Depends On |
|---|-------|------------|
| 001 | Resolve edit-source iteration and pass it through generate_image | — |
| 002 | Verify edit-source resolution end-to-end and harden against raw path injection | 001 |

Tickets execute serially in the order listed.

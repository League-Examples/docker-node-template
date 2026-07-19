---
id: '011'
title: Structured Tool-Call History Replay
status: closed
branch: sprint/011-structured-tool-call-history-replay
worktree: false
use-cases:
- SUC-021
issues:
- tool-call-history-prose-causes-hallucinated-calls.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 011: Structured Tool-Call History Replay

## Goals

Fix the confirmed root cause of the live project-14 ("League of
Mentors") hallucination incident
(`clasi/issues/tool-call-history-prose-causes-hallucinated-calls.md`):
`chatMessageToProviderMessage` in `server/src/agent/turn.ts` replays
every past assistant tool round to the model as free-form text (`Called
tool "<name>" with args <json> -> result <json>`) instead of the
structured `tool_use`/`tool_result` provider content the *live*
in-turn round already uses. Once enough of this prose accumulates in a
long, tool-heavy conversation, the model imitates the pattern and emits
the narration itself instead of a real function call — no call, no
image, no new iteration.

- Reconstruct past tool rounds as structured provider messages
  (assistant `tool_use` + matching user `tool_result`), minting fresh
  synthetic ids at replay time, so the model always sees a genuine,
  well-formed tool-use exchange no matter how many rounds have
  accumulated.
- Add regression coverage that reproduces the failure shape (several
  accumulated prior tool rounds) and asserts both the replayed message
  shape and that the model's next call is a real tool call.
- Unstick project 14 and any project in the same state with no manual
  data fix — see Migration Concerns.

## Problem

DB inspection confirmed project 14's failing `ChatMessage` rows (id 72,
74) contain the prose sentence `Called tool "generate_image" with args
{...} -> result {"imagePath":"projects/14/iterations/iter-9.png",...}`
in their **content**, while their **`toolCalls` column is empty** — the
opposite of a real tool round (9 real rounds exist elsewhere in the
project's history, all with a populated `toolCalls` column and empty
`content`). `iter-9` does not exist; the project has only 4 real
iterations. The model wrote the narration as plain text and never
issued a function call.

Root cause, confirmed at the code level: `chatMessageToProviderMessage`
renders every past assistant tool round as that same prose sentence, on
the stated (and, per this sprint's investigation, mistaken) premise
that a live provider tool-call id "no longer exist[s] once a turn is
over" and so can't be replayed structurally. Project 14 is a long,
edit-heavy conversation — enough prose-rendered rounds had accumulated
that the model began imitating the format instead of calling the tool.
This is not specific to image generation or to sprint 010's edit path;
any tool-heavy conversation will eventually hit it.

## Solution

Reconstruct each persisted tool-round `ChatMessage` row as the exact
structured shape the live in-turn loop already produces — an assistant
message carrying `toolCalls` plus a following user message carrying the
matching `toolResults` — instead of a prose sentence. The persisted
`toolCalls` JSON column already stores `{name, args, result}` per call
(ticket-004 `ProviderToolCallRecord` shape), so nothing new needs to be
persisted. The one piece that doesn't already exist is a call **id** —
never persisted, because none is needed: this sprint mints a fresh,
synthetic id at replay time (`hist-<row.id>-<index>`), scoped only to
the one `sendTurn` request being built. See Architecture > Design
Rationale for why a freshly-minted id is exactly as valid to the
provider as an original one, and why no `ProviderMessage`/adapter
contract change is required to do this.

## Success Criteria

- After several (4+) prior persisted tool-call rounds in a project's
  history, a new edit/generation request results in a real dispatched
  tool call — a `ChatMessage` row with a populated `toolCalls` field —
  never fabricated "Called tool … -> result …" prose in `content`.
- A regression test reproduces the failure shape: seeded history with
  several past tool rounds, replayed to a mock provider, asserted to
  arrive as structured `tool_use`/`tool_result`-shaped `ProviderMessage`
  content, with the model's scripted next turn issuing a real tool
  call.
- All existing `tests/server/agent-turn.test.ts` and
  `tests/server/agent-providers.test.ts` assertions still pass.

## Scope

### In Scope

- Rewriting `chatMessageToProviderMessage` (`server/src/agent/turn.ts`)
  to reconstruct past tool rounds as structured `ProviderMessage`s
  instead of prose, and updating its one call site
  (`historyRows.map(...)` building the `messages` array fed to
  `provider.sendTurn`).
- Minting synthetic-but-consistent call ids at replay time.
- Updating the one existing test assertion this signature change
  mechanically touches (`tests/server/agent-turn.test.ts`'s D8
  statelessness test).
- A new regression test reproducing the hallucination failure shape via
  the mock adapter.
- Correcting the function's/module's doc comments, which currently
  document the (now-superseded) prose-replay decision and its
  reasoning.

### Out of Scope

- Any change to the *live* in-turn tool-call round-trip — it already
  uses the correct structured shape (`turn.ts` lines ~1044-1045); this
  sprint touches only how *past, persisted* rounds are replayed.
- Any change to `ProviderMessage`/`ProviderToolCall`/`ProviderToolResult`
  (`providers/types.ts`), `providers/anthropic.ts`, or `providers/mock.ts`
  — investigated and confirmed unnecessary (Architecture > Design
  Rationale, Decision 2).
- Any `ChatMessage`/Prisma schema change — the persisted `toolCalls`
  shape is unchanged; no migration.
- Persisting `isError` on historical tool-call records so a replayed
  failed call can set the Anthropic-specific `is_error` flag — a
  pre-existing gap (never persisted, live or replayed), not introduced
  or worsened by this sprint; logged as an Open Question rather than
  bundled in, to keep this fix narrowly scoped to the confirmed
  hallucination root cause.
- Any UI/SSE (`TurnEvent`) change.
- Manually fixing/backfilling project 14 or any other stuck project's
  data — not needed; see Migration Concerns.

## Test Strategy

Vitest, extending the existing patterns in `tests/server/agent-turn.test.ts`
(the file already seeds `ChatMessage` rows directly via the test's
Prisma client and drives `runTurn` against a scripted
`createMockAdapter`, with an `onSendTurn` hook for inspecting
`ProviderTurnInput.messages` — the exact tool this sprint's regression
test needs, already proven out by the existing D8 "statelessness"
describe block at line ~408). No new test infrastructure required.
Coverage needed:

- Unit-level shape assertions on the rewritten reconstruction function:
  a tool-round row maps to an assistant `toolCalls` message + user
  `toolResults` message pair with matching, `hist-`-prefixed ids; a
  plain row maps to one unchanged message; a tool-round row with
  non-empty `content` carries that text as the assistant message's
  leading `content`.
- End-to-end regression: seed 4+ prior tool-round rows (matching the
  live incident's scale), run a new turn through a mock adapter
  scripted to return a real `generate_image` call, and assert (a) the
  captured `ProviderTurnInput.messages` for the historical rounds are
  structured, never prose, (b) roles strictly alternate across the full
  replayed history, and (c) the resulting persisted `ChatMessage` row
  has a populated `toolCalls` field.
- Full existing suite (`tests/server/agent-turn.test.ts`,
  `tests/server/agent-providers.test.ts`) run to confirm no regression.

## Architecture

**Compact** — one existing module changes
(`server/src/agent/turn.ts`'s history-reconstruction function and its
one call site): no new component, no data-model change, and no new
cross-module dependency (the fix stays entirely on the caller side of
the already-existing `ProviderAdapter`/`ProviderMessage` seam). Full
section structure below per the architecture-authoring skill's compact
tier; diagrams omitted per Step 4 with reasons stated. The review gate
below still runs in full, per this sprint's explicit brief — "compact"
governs the document's *shape* (no diagrams, prose sized to one
module), not whether the self-review runs.

### Architecture Overview

**Problem / responsibilities (Steps 1-2)**: the root cause is a
*representation* defect, not a missing capability — the live in-turn
tool-call loop, the Workspace MCP Server dispatch, and the persisted
`ChatMessage.toolCalls` column are all already correct. The one
responsibility this sprint changes is **how the Agent Runtime turn
controller translates a *past, persisted* assistant tool round back
into provider-message history for the *next* turn** — closing the gap
between "what actually happened" (a structured tool call and result)
and "what the model is told happened" (a sentence describing one).

**Module (Step 3)**: Agent Runtime (`server/src/agent/turn.ts`) is the
sole module touched. The function's purpose (no "and"): *map one
persisted `ChatMessage` row back into the `ProviderMessage`(s) it
represents.* Boundary: the function's signature changes from a 1-row-
to-1-message mapping (`chatMessageToProviderMessage`) to a 1-row-to-
(1-or-2)-messages mapping (`chatMessageToProviderMessages`) — a plain
content row still yields exactly one message; a tool-round row (`role
=== 'assistant'` with non-null `toolCalls`) now yields an assistant
`toolCalls` message immediately followed by a user `toolResults`
message, using freshly-minted ids. Its one call site
(`historyRows.map(...)` building the outgoing `messages` array) becomes
`historyRows.flatMap(...)`. Nothing else in `turn.ts` — dispatch,
persistence, lock handling, stage events — changes. Serves: SUC-021
below.

**Diagram (Step 4)**: omitted. One module changes, no new subsystem, no
new cross-module edge, no data-model change — the same shape sprint
010 used to justify omitting diagrams for a compact update. The "before
vs. after" shape of one function's return value is fully described in
prose above and in Design Rationale below; a component diagram would
add a box for a module that already exists and draw no new edge.

**What changed / why / impact (Step 5)**:

*What changed*: `chatMessageToProviderMessage` is replaced by
`chatMessageToProviderMessages`, which:
1. For a row with `role !== 'assistant'` or a null `toolCalls`: returns
   `[{ role, content: row.content }]` — unchanged from today.
2. For a row with `role === 'assistant'` and non-null `toolCalls`
   (a persisted tool round, one or more calls): returns two messages —
   `{ role: 'assistant', content: row.content || undefined, toolCalls:
   [...] }` where each call gets a fresh id `hist-<row.id>-<index>`,
   followed by `{ role: 'user', toolResults: [...] }` using the same
   ids to pair each result to its call. This exactly mirrors the shape
   the live loop already appends mid-turn (`turn.ts` lines ~1044-1045).

*Why*: the model has always been perfectly capable of handling
structured tool-use/tool-result history — it does so every single live
round, in the very same conversation. The prose rendering was never
necessary; it was a workaround for a premise (see Design Rationale,
Decision 1) that doesn't hold for how this codebase calls the provider.
Replaying the same shape the model just produced seconds ago, instead
of a paraphrase of it, removes the only thing there was for the model
to imitate.

*Impact on existing components*: `providers/types.ts`,
`providers/anthropic.ts`, `providers/mock.ts`, and the
`ChatMessage`/Prisma schema are all unchanged (see Decision 2). The
`messages` array's overall length grows (one persisted tool-round row
now contributes two provider messages instead of one), but this is
exactly proportionate to what the *live* loop already sends mid-turn
for the same rounds — no new order of magnitude, and well within
existing model context limits at the conversation lengths observed
(project 14: 9 historical tool rounds). A secondary, incidental
correction falls out of this change: today, two or more persisted
tool-round rows from the same turn replay as consecutive assistant-role
messages (no synthetic user-role message sits between them, unlike the
live loop, which always inserts one); because every tool-round row now
expands to an `[assistant, user]` pair, replayed history is
strictly alternating user/assistant for the first time, matching what
the live loop already guarantees mid-turn. This is called out as a
consequence, not pursued as separate scope.

### Design Rationale

**Decision 1: reconstruct past tool rounds as structured
`tool_use`/`tool_result` messages with freshly-minted ids, rather than
prose, and rather than trying to preserve or reuse the original live
call id.**

- **Context**: the code being replaced has a doc comment defending
  prose specifically because "matching provider-call ids... no longer
  exist once a turn is over and persisted." This sprint's task was to
  verify that premise before designing around it.
- **Investigation**: `providers/anthropic.ts`'s own module doc states
  the adapter wraps the Messages API as "a single request/response
  round trip... no hidden loop or session state of its own" — each
  `sendTurn` call is one independent, stateless HTTP request. Anthropic
  only needs a `tool_use.id` and a later `tool_result.tool_use_id` to
  match *within that one request's `messages` array*; it has no way to
  check an id against some earlier, separate request, and no
  requirement that an id was ever "real." `toAnthropicMessage`
  (`anthropic.ts` lines 160-183) confirms this in code: it builds
  `tool_use`/`tool_result` blocks purely from whatever `id`/
  `toolCallId` values the `ProviderMessage` already carries — it has no
  special handling, validation, or distinction for "this id came from a
  live API response" versus "this id was synthesized just now." A
  synthetic id, never having existed as a real provider call id, is
  exactly as valid to the API as the original one was. The premise in
  the old doc comment does not hold for this adapter's design.
- **Alternatives considered**:
  - *(a) Keep prose but summarize/truncate older rounds* — rejected:
    doesn't fix the category error (still not real tool content to the
    model), only delays the same failure to a longer conversation, and
    discards information a later turn might need (e.g., a `promptUsed`
    or an exact prior arg value).
  - *(b) Persist the original live provider call id
    (e.g., Anthropic's `toolu_...`) on `ChatMessage.toolCalls` and
    replay it verbatim* — rejected: the investigation above shows
    reusing the *original* id buys nothing (self-consistency within one
    request is all that's required); it would also add a schema/shape
    change for no benefit and leak one specific provider's id format
    into the provider-neutral `ProviderToolCallRecord` shape
    (`providers/types.ts`'s own doc comment: this type exists precisely
    so `ChatMessage.toolCalls` never holds "a raw copy of any one
    vendor's wire format").
  - *(c) Mint a fresh id per historical call at replay time, derived
    from that call's own row id and position* (chosen) — no schema
    change; deterministic and stable across repeated loads (the same
    row always reconstructs to the same id, which is convenient for
    tests and debugging though not required by the API); guaranteed
    unique across the whole replayed history plus the live round
    (`ChatMessage.id` is a globally unique, monotonically increasing
    primary key; live ids come from the Anthropic SDK's own `toolu_`
    namespace and will never collide with the chosen `hist-` prefix).
- **Why this choice**: (c) is the only option that both fixes the root
  cause (the model sees genuine structured tool content, nothing to
  imitate) and requires touching nothing outside the one function that
  already owned this responsibility.
- **Consequences**: `chatMessageToProviderMessage` becomes
  `chatMessageToProviderMessages` (1-to-many); its one call site
  becomes a `flatMap`; the one existing test that calls it directly
  needs the same mechanical update (Migration Concerns). As a side
  effect, multi-round-per-turn history now replays with strict
  user/assistant alternation (see Impact on Existing Components above)
  — a latent defect this change happens to close, not a separate effort.

**Decision 2: no change to `ProviderMessage`/`ProviderToolCallRecord`
(`providers/types.ts`) or either adapter
(`providers/anthropic.ts`, `providers/mock.ts`).**

- **Context**: the task explicitly asked this to be verified, not
  assumed, since the fix's viability depends on it.
- **Finding**: `ProviderMessage` already declares optional `toolCalls`/
  `toolResults` fields (`types.ts` lines 85-90) for exactly this
  purpose — the live in-turn round already produces and consumes them
  every turn (`turn.ts` lines ~1044-1045; ticket-004/005 scope).
  `toAnthropicMessage` already branches on them generically with no
  live-response-only assumption (see Decision 1's investigation).
  `providers/mock.ts` has no involvement in message-shape translation
  at all — it only returns scripted `ProviderTurnResult`s and,
  optionally, inspects the outgoing `ProviderTurnInput` via
  `onSendTurn` — which is in fact the exact mechanism this sprint's
  regression test uses to assert the new shape, unmodified.
- **Alternatives considered**: adding an explicit `ProviderToolCall
  .synthetic?: boolean` marker, for traceability in logs/debugging —
  rejected as speculative generality: nothing downstream would read it,
  and the `hist-` id prefix already makes a synthetic id visually
  distinguishable without widening a shared, provider-neutral type for
  a need that hasn't materialized.
- **Consequences**: this is a pure caller-side (`turn.ts`) fix. No
  ripple into `providers/`, no adapter-swap risk (architecture-001 D10,
  architecture-update-001 R4's "swap is contained to the adapter" claim
  is unaffected — if anything, more thoroughly exercised, since the
  mock adapter now needs to correctly round-trip the same shape the
  real adapter does for the regression test to mean anything).

**Decision 3: preserve D8 ("fresh every turn from the DB") exactly.**

- **Context**: reconstruction must not introduce any cross-request
  cache or memoized state.
- **Finding**: the rewritten function is a pure, synchronous mapping
  over the same `historyRows` that `loadHistory` already reloads fresh
  from `prismaClient` on every `runTurn` call (`turn.ts` line ~944) — no
  new state is introduced, no caching, no dependency on anything from a
  prior process. D8 is unaffected.

### Migration Concerns

None requiring action, and specifically **no backfill or data
migration is needed to unstick project 14 or any other affected
project**: the persisted `ChatMessage.toolCalls` JSON already carries
the exact `{name, args, result}` shape reconstruction reads — it was
never the data that was wrong, only how it was replayed. The very next
turn run against the patched code reconstructs *all* of a project's
existing history through the new structured path, automatically. No
schema change, no API/DTO shape change, no backward-compatibility
break, no deployment-sequencing concern beyond a normal server
rebuild/restart (single-module change).

**Open Question**: historical tool-call records
(`ProviderToolCallRecord`) have never carried an `isError` flag — a
historical *failed* call replays with its error object as the
`tool_result`'s JSON content (still informative to the model) but
without Anthropic's `is_error` flag set, unlike a live-round failure,
which does set it. This is a pre-existing gap (not introduced or
widened by this sprint) and not required by any acceptance criterion
here; flagged for a stakeholder/future-sprint decision on whether it's
worth widening `ProviderToolCallRecord` to carry it.

### Architecture Self-Review

Run per the `architecture-review` skill's five categories.

**Consistency**: the Architecture Overview's "what changed"
(`chatMessageToProviderMessage` → `chatMessageToProviderMessages`,
1-to-many, `hist-<row.id>-<index>` ids) matches Design Rationale's
three decisions and the Use Cases' acceptance criteria — all describe
the same reconstruction mechanism and the same "no adapter/type change"
finding. Migration Concerns' "no migration, self-heals next turn" is
consistent with the Overview's explicit "reads the same
already-persisted `toolCalls` column" claim. PASS.

**Codebase Alignment**: verified against the actual current files,
read in full during planning. `turn.ts`'s
`chatMessageToProviderMessage` (lines 410-428) confirmed to render
prose exactly as the issue describes, guarded on `role === 'assistant'
&& row.toolCalls`. The live in-turn loop (lines 1039-1047) confirmed to
already persist one `ChatMessage` row per round (`content: ''`,
`toolCalls: records`) and to already push the target structured shape —
`{role:'assistant', toolCalls: result.calls}` then
`{role:'user', toolResults}` — into `messages` mid-turn, proving the
target shape already exists and is exercised every turn, just not
reused at replay time. `providers/types.ts`'s `ProviderMessage` (lines
85-90) confirmed to already declare optional `toolCalls`/`toolResults`
generically. `providers/anthropic.ts`'s `toAnthropicMessage` (lines
160-183) confirmed to build blocks purely from whatever ids are present,
with no live-only invariant. `providers/mock.ts` confirmed to do no
message-shape translation. `tests/server/agent-turn.test.ts` line 433
confirmed to be the one existing direct call to
`chatMessageToProviderMessage`, on two tool-call-free rows — a case
where old and new behavior coincide (one message each), needing only a
mechanical `flatMap` update. No drift found between the documented
Anthropic Messages API contract (stateless, per-request id matching)
and this adapter's actual implementation.

**Design Quality**: *Cohesion* — the function's purpose narrows to
exactly what it always claimed: "map one persisted row to the
`ProviderMessage`(s) it represents," now correctly discharged for the
tool-round case. *Coupling* — no new dependency; `turn.ts` already
imports `ProviderMessage`/`ProviderToolCall`/`ProviderToolCallRecord`
from `providers/types.ts` and only needs to add `ProviderToolResult` to
that existing import — a type-only addition to an existing import
line, not a new module edge. *Boundaries* — the `ProviderAdapter`
interface (`sendTurn(input) -> result`) is untouched; reconstruction
stays entirely on the caller side of that seam, exactly where D10
already places context assembly. *Dependency direction* — Agent
Runtime (Domain) depending on the Provider interface types
(Infrastructure-facing seam) is the existing, unchanged direction.
PASS.

**Anti-Pattern Detection**: no god component — the change narrows and
corrects one function's existing responsibility, it doesn't grow it
into a new one. No shotgun surgery — one function, one call site, one
test call site, contained to `turn.ts`/its own test file. No feature
envy — the function reads only `ChatMessageModel`'s own fields
(`role`, `content`, `toolCalls`, `id`), the same fields it read before.
No circular dependencies (no new edges). No leaky abstraction —
checked specifically for the synthetic-id scheme: `ProviderToolCall.id`
/`ProviderToolResult.toolCallId` are documented as opaque,
provider-neutral strings already ("not necessarily any vendor's own
call-id format" — `types.ts`), so a `hist-`-prefixed synthetic value is
exactly the flexibility that field already promised, not a new leak.
No speculative generality — the rejected `synthetic?: boolean` marker
(Decision 2) was declined for this reason. PASS.

**Risks**: the alternation side-effect (Impact on Existing Components)
is a fix, not a new risk, but is explicitly asserted on in the
regression test rather than left implicit. The `isError`-fidelity gap
(Open Question) is pre-existing, non-blocking, and explicitly
out-of-scope rather than silently ignored. No data migration, no
breaking API/type change, no deployment-sequencing risk beyond a normal
restart. Test-coverage risk: the regression test must seed history at a
scale resembling the real incident (multiple rounds, one containing
more than one call) rather than a single trivial round, or it risks
passing without actually exercising the multi-round alternation and
id-uniqueness properties that matter — flagged in Test Strategy and
ticket 002's acceptance criteria below.

### Verdict: **APPROVE**

No structural issues — no circular dependencies, no god component, no
inconsistency between the Overview and the rest of the document. This
is a contained, single-module correctness fix that replaces a
mistaken-premise workaround with the same structured shape the codebase
already produces and relies on every live turn. The one deliberately
deferred item (`isError` fidelity on replayed history) is flagged as an
Open Question, not a defect in this plan. Proceeding to ticketing.

## Use Cases

### SUC-021: Continue a tool-using conversation after several prior tool rounds without hallucinated calls
Parent: UC-006 (Generate and iterate images), also grounding the general
tool-call-replay property any MCP-dispatched tool (UC-011) depends on.

- **Actor**: Project owner in an established project chat with several
  prior tool-call rounds already in its history (e.g., prior
  `generate_image` calls/edits).
- **Preconditions**: The project's `ChatMessage` history contains
  multiple (4+) prior assistant tool-call rounds — rows with a
  non-null, populated `toolCalls` column.
- **Main Flow**:
  1. User sends another edit or generation request in the same
     conversation.
  2. The turn controller reconstructs history fresh from the DB
     (`loadHistory`), including every prior tool round.
  3. Each prior tool round is rendered as a structured assistant
     `toolCalls` message (one call per persisted record, with a freshly
     minted id) immediately followed by a matching user `toolResults`
     message — never as free-form "Called tool …" text.
  4. The provider receives a well-formed, strictly alternating
     tool-use/tool-result history and issues a genuine tool call for
     the new request, rather than narrating one as text.
  5. The turn controller dispatches the real call; for `generate_image`,
     a new `Iteration` row is created with a real image file.
- **Postconditions**: The new round's `ChatMessage.toolCalls` column is
  populated with the real dispatched call; no assistant `ChatMessage`
  content anywhere in the conversation contains fabricated "Called tool
  … -> result …" narration; the project's iteration count increases
  when the call is `generate_image`.
- **Acceptance Criteria**:
  - [ ] Given a project with 4+ prior persisted tool-call rounds, a new
        edit/generation request results in a `ChatMessage` row with a
        populated `toolCalls` field, not prose narration in `content`.
  - [ ] The provider is sent replayed history as structured
        `toolCalls`/`toolResults` `ProviderMessage`s for every
        historical tool round — verified via a mock-adapter regression
        test inspecting `ProviderTurnInput.messages`.
  - [ ] A turn whose history includes a round with 2+ calls, or 2+
        rounds from the same prior turn, replays with strictly
        alternating user/assistant roles (no back-to-back assistant
        messages).
  - [ ] All existing `tests/server/agent-turn.test.ts` and
        `tests/server/agent-providers.test.ts` assertions continue to
        pass, updated only where the reconstruction function's 1-to-many
        return shape mechanically requires it.

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
| 001 | Reconstruct past tool rounds as structured provider messages | — |
| 002 | Regression test: history replay stays structured across accumulated tool rounds | 001 |

Tickets execute serially in the order listed.

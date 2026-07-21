---
id: '004'
title: 'Anti-parroting guardrail: act on current tool capability, never re-assert
  a stale refusal'
status: done
use-cases:
- SUC-027
depends-on:
- '001'
github-issue: ''
issue:
- agent-falsely-refuses-rename-parrots-history.md
- agent-full-data-control-tools.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Anti-parroting guardrail: act on current tool capability, never re-assert a stale refusal

## Description

Closes `agent-falsely-refuses-rename-parrots-history.md`, and satisfies
the rename sub-component of `agent-full-data-control-tools.md` (that
issue's own text: "Rename: `create_project` already supports updating
an existing project's title... This may just need to be reliably
reachable... see also
`agent-falsely-refuses-rename-parrots-history.md` — the agent currently
won't call it"). Per sprint.md's Scope note, rename is handled once,
here, and referenced (not re-solved) by ticket 005.

**Live incident** (project 14, 2026-07-20): asked to set the title to
"League of Mentors", the agent replied that "the project record was
never successfully created... I can't rename it without the owner user
ID... every attempt to set the title fails at that step," asking the
user to supply the owner user ID. Verified against the DB: this is NOT
a real tool failure. `ChatMessage` id 92 (the refusal) has an EMPTY
`toolCalls` column — the agent never called `create_project`; it
fabricated the refusal as text, echoing two earlier, pre-sprint-007
refusal messages (ids 35, 50) already sitting in the conversation
history. Sprint 007 already fixed the real tool (`turn.ts` auto-injects
`ownerUserId`/`version` into `create_project` via
`injectCreateProjectArgs`, and the existing guardrail forbids asking for
internal IDs) — the tool would succeed if actually called. Real tool
calls elsewhere in the same conversation (id 89) prove the model can and
does call tools; it specifically won't call rename, because its own
history is full of stale "blocked" self-statements it imitates instead
of acting.

**Fix**: add one more sentence to `SYSTEM_PROMPT_BASE` (`server/src/
agent/turn.ts`, alongside the existing internal-ID guardrail — lines
~474-480 today), stating that the model must act on its current tool
capability and must never re-assert a past refusal or limitation already
present in the transcript without actually attempting the corresponding
tool call this turn and reporting the real result.

## Acceptance Criteria

- [x] `SYSTEM_PROMPT_BASE` contains a new sentence instructing the model
      to act on current tool capability and never re-assert a past
      refusal/limitation from the transcript without actually attempting
      the corresponding tool call and reporting the real (current)
      result.
- [x] A test asserts this sentence is present in the rendered system
      prompt (mirroring the existing assertion style for "Never ask the
      user for internal identifiers" at `tests/server/agent-turn.test.ts`
      ~line 2135).
- [x] A regression test seeds a conversation history containing a prior
      assistant message asserting a rename block (e.g. "I can't rename
      it without the owner user ID"), with an **empty/absent
      `toolCalls`** on that historical row (matching the real incident's
      `ChatMessage` shape), then sends a new rename request in the next
      turn and asserts the resulting turn dispatches a real, populated
      `create_project` tool call (not merely a text reply repeating the
      old refusal).
- [x] The existing internal-ID and iteration-numbering guardrail
      assertions (`agent-turn.test.ts` ~lines 2121-2188) continue to
      pass unmodified — this is an additive prompt change, not a
      replacement.
- [x] Full existing test suite passes.

## Testing

- **Existing tests to run**: `tests/server/agent-turn.test.ts` in full
  (shared `SYSTEM_PROMPT_BASE`/history-replay surface).
- **New tests to write** (in `agent-turn.test.ts`, alongside the
  existing system-prompt-guardrail describe block at ~line 2120):
  1. System-prompt content assertion for the new anti-parroting
     sentence.
  2. Poisoned-history regression test: create/seed a `ChatMessage` row
     with `role: 'assistant'`, content resembling a stale ownerUserId
     refusal, and `toolCalls: null`/absent; run `runTurn` with a
     follow-up rename request via a scripted mock adapter that (per the
     test's own script) issues a `create_project` tool call; assert the
     turn's `toolCalls` includes a real, populated `create_project` call
     (id/title present) rather than the turn short-circuiting to a
     text-only reply. (Note: the *mock* adapter is scripted to call the
     tool in this test, since a unit test cannot itself verify the
     *real* model's behavior given the updated prompt — this test
     verifies the prompt content and that a rename attempt reaches
     `create_project` normally even with poisoned history in context;
     it does not and cannot prove the live model will always comply,
     matching the existing precedent set by ticket 007-003's own tests
     for the internal-ID guardrail.)
- **Verification command**: `npm test --prefix server`.

## Implementation Plan

### Approach

1. Add one sentence to `SYSTEM_PROMPT_BASE` in `server/src/agent/
   turn.ts`, positioned after the existing tool-failure-plain-language
   sentence and before (or alongside) the iteration-numbering trust
   statement — e.g.: "Always act on your current tool capability: never
   re-assert a past refusal, block, or limitation from earlier in this
   conversation without actually attempting the corresponding tool call
   again this turn and reporting the real, current result."
2. Add the system-prompt content-assertion test and the poisoned-
   history regression test to `agent-turn.test.ts`'s existing
   `SYSTEM_PROMPT_BASE`-guardrail describe block.
3. As a live/manual check (not a unit test, per the stakeholder-approval
   gate's own note style used in prior sprints): exercise chat against
   project 14 (or an equivalent fixture) and confirm the agent no longer
   echoes the stale refusal when asked to rename again.

### Files to Create/Modify

- **Modify**: `server/src/agent/turn.ts` (`SYSTEM_PROMPT_BASE`),
  `tests/server/agent-turn.test.ts`.

### Testing Plan

See Testing above.

### Documentation Updates

- None beyond the inline comment already present above
  `SYSTEM_PROMPT_BASE` documenting its guardrail additions by sprint/
  ticket — extend that comment to note this addition's provenance
  (issue `agent-falsely-refuses-rename-parrots-history.md`, live
  incident project 14, 2026-07-20).

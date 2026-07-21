---
status: done
sprint: '013'
tickets:
- 013-004
---

# Agent falsely refuses to rename the project ("needs owner user ID")

## Symptom (live, project 14, 2026-07-20)

Asked to set the title to "League of Mentors", the agent replies that
"the project record was never successfully created... I can't rename it
without the owner user ID... every attempt to set the title fails at that
step" and asks the user to supply the owner user ID.

## Diagnosis (verified against the DB)

This is NOT a real tool failure and NOT a sprint-007 regression — it's
poisoned-history parroting:

- The refusal message (ChatMessage id 92) has an EMPTY `toolCalls`
  column: the agent never actually called `create_project`/rename. It
  fabricated the refusal as text.
- All three "owner user ID" messages (ids 35, 50, 92) have empty
  `toolCalls`. Ids 35/50 are the ORIGINAL pre-sprint-007 refusals still
  in the conversation; id 92 is the model reading those and repeating
  them.
- Real tool calls work fine alongside this (id 89 has a populated
  `toolCalls` — it reshot iteration 7). So the model can call tools; it
  just won't call rename because its history is full of stale "blocked on
  owner ID" self-statements.
- Sprint 007 already fixed the actual tool: `turn.ts` auto-injects
  `ownerUserId`/`version` into `create_project`, and a guardrail forbids
  asking the user for internal IDs. The tool would succeed if called.
  (Project 14 still shows title "Untitled project", ownerUserId 5 — the
  rename never ran because it was never attempted.)

## Root cause

Same class as tool-call-history-prose-causes-hallucinated-calls.md and
agent-iteration-number-grounding.md: the model imitates/echoes its own
prior assistant text (here, stale refusals) instead of acting on current
capability. Sprint 011's structured-replay fix addresses tool-round
replay, but these plain-text refusal messages are ordinary assistant
content and still get replayed verbatim, so the model keeps parroting
them. The sprint-007 guardrail forbids asking for internal IDs but
doesn't stop the model from repeating a stale "I'm blocked" narrative
already in the transcript.

## Fix direction

- The durable fix is the same family as the anti-hedging/trust work:
  instruct the model to act on current tool capability and NOT repeat a
  past refusal/limitation from the transcript without re-attempting the
  tool; when it believes an action is blocked, it must actually call the
  tool and report the real result, never assert a block from memory.
- Consider not persisting (or not replaying as authoritative) assistant
  turns that claim a tool failed when no corresponding tool call exists
  in that turn — these are the poison.
- Immediate remedy for project 14: purge the stale refusal messages
  (ids 35, 50, 92) so the agent stops echoing them. (Relatedly, the UI
  inline-title-edit feature in edit-project-title-inline.md sidesteps the
  agent for renames entirely.)

## Acceptance criteria

- Asked to rename, the agent actually calls the rename tool (populated
  `toolCalls`) and reports the real result, even when the transcript
  contains earlier refusals — it never re-asserts a stale "needs owner
  user ID" block without attempting the call.
- A regression test: with a history containing a prior "can't rename
  without owner ID" assistant message, a new rename request produces a
  real `create_project` tool call.

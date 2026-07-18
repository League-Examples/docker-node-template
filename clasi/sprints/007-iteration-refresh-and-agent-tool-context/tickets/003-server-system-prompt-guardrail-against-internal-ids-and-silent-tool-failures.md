---
id: '003'
title: 'Server: system prompt guardrail against internal IDs and silent tool failures'
status: open
use-cases: [SUC-002]
depends-on: ["002"]
github-issue: ''
issue: agent-asks-user-for-internal-ids.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Server: system prompt guardrail against internal IDs and silent tool failures

## Description

Observed live (project 14, "League of Mentors", 2026-07-17): after a
`create_project` rename call failed, the agent asked the end user "What's
the owner user ID?" instead of surfacing a plain-language failure. Ticket
002 fixes the underlying context gap (the turn controller now injects
`ownerUserId`/`version` so a rename of the current project no longer
fails for that reason in the first place), but nothing yet tells the
model, as policy, (a) never to ask a user for an internal identifier, or
(b) to state a tool failure plainly rather than improvising a
data-collection question when a call still fails for some other reason
(e.g. a genuine concurrent-edit version conflict).

Add both instructions to `server/src/agent/turn.ts`'s
`SYSTEM_PROMPT_BASE`. This ticket depends on ticket 002 because it
extends the same constant/module and its acceptance criteria describe the
guardrail as the backstop for exactly the residual failure case ticket
002's own Acceptance Criteria and Design Rationale name (the concurrent
version-conflict alternate flow) — sequencing after 002 keeps the prompt
wording aligned with the actual injected context rather than being
written against a stale mental model of what the model does and doesn't
already know.

Parent sprint architecture:
`clasi/sprints/007-iteration-refresh-and-agent-tool-context/sprint.md`
(SUC-002, "Alternate flow (tool failure)").

## Acceptance Criteria

- [ ] `SYSTEM_PROMPT_BASE` (or an appended section of the system prompt)
      explicitly instructs the model to never ask the user for internal
      identifiers (database IDs, version numbers, internal keys, or
      similar).
- [ ] `SYSTEM_PROMPT_BASE` explicitly instructs the model that when a
      tool call fails, it must state the failure to the user in plain
      language in its next message, rather than inventing a follow-up
      question or silently proceeding as if nothing happened.
- [ ] The instruction wording is generic across all 15 Workspace MCP
      Server tools (not hard-coded to `create_project` specifically) —
      matching Out of Scope's rejection of a tool-specific fix in favor
      of a general prompt policy.
- [ ] Manual verification: given a scripted/mock provider turn where a
      tool call returns `isError: true` for a reason ticket 002 does not
      eliminate (e.g. a simulated `VersionConflictError` after
      injection), the turn's final assistant message states the failure
      in plain language and does not ask for an internal identifier.
      (Exact model behavior is not mechanically assertable — see Testing.)

## Testing

- **Existing tests to run**: `server`'s existing `turn.ts` test suite
  (`buildSystemPrompt`/prompt-construction tests, if any) — confirm no
  regression to prompt assembly (knowledge-consulted listing,
  PROJECT CONTEXT block) around the new instruction text.
- **New tests to write**:
  - A unit test asserting `SYSTEM_PROMPT_BASE` (or `buildSystemPrompt`'s
    output) contains both new instructions as literal substrings, so a
    future edit can't silently drop them.
  - Where the test harness supports a scripted/mock `ProviderAdapter`
    (per `architecture-update.md R4`'s mock-adapter precedent): a turn
    test that dispatches a tool call returning `isError: true` and
    asserts the mock provider's next `sendTurn` call received the
    updated system prompt (content assertion only — the *model's*
    resulting behavior with a real provider is not something a unit test
    can assert; that's a manual/product-review check, per this ticket's
    last Acceptance Criterion).
- **Verification command**: `npm test --workspace server` (or the
  project's configured server test command); this is a
  TypeScript/Node project, not `uv run pytest`.

## Implementation Plan

- **Approach**: Append two sentences to `SYSTEM_PROMPT_BASE` in
  `server/src/agent/turn.ts`: one forbidding requests for internal
  identifiers, one requiring plain-language failure statements on a tool
  error. Keep the addition generic (not naming `create_project`
  specifically) since the policy should hold for all 15 registered tools,
  not just the one that triggered this issue.
- **Files to modify**:
  - `server/src/agent/turn.ts` — `SYSTEM_PROMPT_BASE`.
  - Corresponding `turn.ts` test file (prompt-content assertions).
- **Testing plan**: see Testing section above.
- **Documentation updates**: update the doc comment immediately above
  `SYSTEM_PROMPT_BASE` (currently: "Deliberately generic --
  postcard/flyer-specific prompt content generation is Sprint 004/005
  scope") to note the two policy additions and point to this sprint's
  linked issue for context, following the file's existing convention of
  documenting *why* prompt content exists, not just what it says.

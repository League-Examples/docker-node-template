---
id: '003'
title: Agent Runtime, Workspace MCP Server & Versioning
status: ticketed
branch: sprint/003-agent-runtime-workspace-mcp-server-versioning
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
- SUC-005
issues:
- workspace-mcp-server.md
- agent-runtime-and-chat.md
- workspace-git-versioning.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 003: Agent Runtime, Workspace MCP Server & Versioning

## Goals

Stand up the moderated write path and the conversational loop that every
later feature (generation, description, postcard editing, the real
two-pane UI) calls into: a second, in-process MCP server exposing the
fixed, no-shell tool surface architecture-001 specifies (file
read/move/create-directory/stat, typed catalog operations, the `Lock`
table), a Claude Agent SDK loop that turns per-project chat into calls
against that tool surface, and the git-versioning service the MCP server
invokes after every successful write. This sprint is demoable as a
backend capability: a scripted or admin-only chat turn that creates a
knowledge entry or adds an asset to a collection through the agent loop,
moderated by the MCP server, with a resulting git commit — without yet
requiring the real UI (Sprint 005 wires the chat panel to this).

## Problem

Sprint 002 gives the system data to store but no way for the agent to
write to it safely, and no runtime to hold a conversation at all. Per
spec §9, the agent must be "fairly flexible" but explicitly moderated —
"probably not running full Unix commands" — and per spec §16 Q7,
Flyerbot's own runtime is a Claude Agent SDK loop, not Claude Code. None
of that exists yet. Separately, "everything commits to GitHub for version
control" (spec §12) has no implementation, and the workspace repo has
never been created or pointed at a real GitHub remote.

## Solution

- Build the Workspace MCP Server (`server/src/agent-mcp/`) as a second,
  separate `McpServer` instance from the existing dev-tooling
  `/api/mcp` endpoint (architecture-001 D5) — connected in-process to the
  Agent Runtime, never exposed over HTTP. Tool families: filesystem
  (`read_file`, `move_file`, `create_directory`, `stat`) and catalog
  (`create_knowledge_entry`, `propose_correction`, `add_asset_to_collection`,
  `create_project`, `create_iteration`, `create_agent_page`,
  `resolve_correction`). Every write acquires the `Lock` table entry
  first (per-directory-path or per-project-turn) and releases it after.
  Enforce path containment against `workspace/` as an enforced root; no
  shell tool exists at this or any layer.
- Build the Agent Runtime (`server/src/agent/`) as a Claude Agent SDK loop
  scoped to one `Project` per turn, stateless between turns (architecture-001
  D8: context reconstructed each turn from `ChatMessage` history plus
  fresh knowledge retrieval — no session store). Reads chat history and
  `KnowledgeEntry` rows directly and unmoderated (D9); every write goes
  through the Workspace MCP Server. Enforce one active turn per project
  via the `project_turn` lock; a second message queues rather than races.
  Persist chat messages to `ChatMessage`; stream token/tool-call/status
  events to callers over SSE (server side only this sprint — the client
  panel is Sprint 005).
- Build the Versioning Service (`server/src/services/versioning.ts`):
  commits `workspace/` filesystem changes plus periodic JSON export
  snapshots of `KnowledgeEntry`/`Collection` rows (never the live `.db`
  file, per D7), batched per agent turn, pushed to a dedicated workspace
  GitHub remote. Resolve the ops precondition: create the workspace repo
  and wire its credentials through the dotconfig cascade.

## Success Criteria

- A test (or admin-only harness) drives one full agent turn — chat
  message in, `create_knowledge_entry` or `add_asset_to_collection` tool
  call out — and the resulting row exists in the DB with a corresponding
  git commit in the workspace repo.
- Attempting a filesystem tool call with a path outside `workspace/`
  (including via a crafted `move_file` destination) is rejected.
- Two simulated concurrent turns on the same project serialize (second
  waits for the first) rather than interleaving tool calls.
- A `KnowledgeCorrection` proposed via `propose_correction` is not applied
  to `bodyText` until `resolve_correction` confirms it; `KnowledgeEntry.version`
  only bumps on acceptance.
- Workspace git commits appear on the dedicated GitHub remote after a
  turn completes; a forced push failure (network/auth) does not block the
  user's turn from completing locally (per architecture-001 UC-012 E1).
- No component outside the Workspace MCP Server writes to `workspace/` or
  performs a catalog write in the new code added this sprint.

## Scope

### In Scope

- Workspace MCP Server: fixed tool surface, locking, path containment.
- Agent Runtime: Claude Agent SDK loop, per-project turn state, SSE
  streaming (server-side), chat persistence.
- Versioning Service: batched commit-and-push, workspace repo creation
  and dotconfig wiring.

### Out of Scope

- Image generation / vision calls (Sprint 004 — the Agent Runtime this
  sprint calls a stubbed or not-yet-built Image & Vision Service client
  interface, wired for real in Sprint 004).
- Asset auto-description pipeline (Sprint 004).
- Any client-side chat UI (Sprint 005 wires `MockupChatPanel.tsx` to this
  sprint's SSE endpoint).
- Postcard-specific `create_agent_page` content generation logic beyond
  the generic tool mechanism (Sprint 004/005).

## Test Strategy

Integration tests exercising the Workspace MCP Server's tool surface
directly (lock acquisition/rejection, path-containment rejection,
catalog-write shape validation) independent of the Agent Runtime. Agent
Runtime tests using a scripted/mocked Claude Agent SDK client to verify
turn statelessness (context fully reconstructable from `ChatMessage` +
knowledge retrieval after a simulated process restart) and turn
serialization under concurrent requests. Versioning Service tests against
a throwaway local git remote, verifying batched-per-turn commit behavior
and graceful handling of push failure.

## Architecture Notes

Implements architecture-001's Agent Runtime Details, Workspace MCP
Server module, Locking/Concurrency Model, and D5/D7/D8/D9 rationale
directly. Resolves the ops precondition in Migration Concerns ("GitHub
remote — workspace repo"). If architecture-001 Open Question 3 (one repo
vs. two) is confirmed by the stakeholder before this sprint's detail
planning, this sprint proceeds with D7's two-repo default; otherwise
detail planning will need a scoped `architecture-update.md` addendum.

## GitHub Issues

None yet — this sprint's issues are CLASI-internal (`clasi/issues/`), not
yet mirrored to GitHub.

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [x] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [x] Architecture review passed
- [x] Stakeholder has approved the sprint plan

## Tickets

All five tickets are created (status: open) in `tickets/`. Tickets
execute serially in this order:

| # | Title | Depends on | Issue | Path |
|---|---|---|---|---|
| 001 | Workspace Versioning Service: batched git commit + config-gated push | -- | `workspace-git-versioning.md` | `tickets/001-workspace-versioning-service-batched-git-commit-config-gated-push.md` |
| 002 | Workspace MCP Server: filesystem tools, path containment, locking | 001 | `workspace-mcp-server.md` | `tickets/002-workspace-mcp-server-filesystem-tools-path-containment-locking.md` |
| 003 | Workspace MCP Server: typed catalog tools + optimistic locking | 002 | `workspace-mcp-server.md` | `tickets/003-workspace-mcp-server-typed-catalog-tools-optimistic-locking.md` |
| 004 | Provider-neutral LLM interface + Anthropic adapter + mock adapter | 003 | `agent-runtime-and-chat.md` | `tickets/004-provider-neutral-llm-interface-anthropic-adapter-mock-adapter.md` |
| 005 | Agent Runtime turn loop + ChatMessage persistence + SSE chat API | 003, 004 | `agent-runtime-and-chat.md` | `tickets/005-agent-runtime-turn-loop-chatmessage-persistence-sse-chat-api.md` |

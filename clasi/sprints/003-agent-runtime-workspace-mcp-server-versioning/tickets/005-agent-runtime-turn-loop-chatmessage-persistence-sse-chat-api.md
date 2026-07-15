---
id: "005"
title: "Agent Runtime turn loop + ChatMessage persistence + SSE chat API"
status: open
use-cases: [SUC-003, SUC-004]
depends-on: ["003", "004"]
github-issue: ""
issue: agent-runtime-and-chat.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Agent Runtime turn loop + ChatMessage persistence + SSE chat API

## Description

Build the turn controller that ties tickets 001-004 together into
architecture-001's Agent Runtime: reconstructs context from `ChatMessage`
history plus unmoderated knowledge retrieval each turn (D8, no session
store), dispatches tool-use responses to the Workspace MCP Server
(tickets 002/003), persists `ChatMessage` rows in the provider-neutral
shape (ticket 004), enforces one active turn per project via the
`project_turn` lock (ticket 002's `locks.ts`, SUC-004), and exposes a
server-side SSE chat endpoint. Image-generation calls are routed through
a stub `ImageVisionClient` interface only -- the real Image & Vision
Service is Sprint 004, per sprint.md's explicit Out of Scope. No client
UI is wired to this endpoint this sprint (Sprint 005 wires
`MockupChatPanel.tsx` to it).

## Acceptance Criteria

- [ ] `server/src/agent/turn.ts` exports a turn-controller function/class
      that, given a `Project` id and a new user chat message,
      reconstructs context from that project's `ChatMessage` history plus
      a fresh knowledge-retrieval read (calling `services/search.ts`
      directly, unmoderated, per D9) -- no in-memory or cross-request
      session state is read or required.
- [ ] The turn controller calls the active `ProviderAdapter` (the
      Anthropic adapter by default; injectable for tests) and dispatches
      any `tool_calls` response to the Workspace MCP Server (tickets
      002/003), feeding results back to the adapter until a final
      message is produced.
- [ ] The full exchange (user message, any tool calls + results, final
      assistant message) is persisted as `ChatMessage` rows, with
      `toolCalls` stored in the provider-neutral `{ name, args, result }`
      shape ticket 004 defined -- never a raw SDK object.
- [ ] A turn acquires a `Lock` row (`resourceType: 'project_turn'`,
      `resourceKey: <Project.id>`) before starting and releases it when
      the turn completes (success or error).
- [ ] A second turn-start request for the same project while the first's
      `project_turn` lock is held queues/waits rather than starting a
      second, interleaved turn; a turn-start request for a *different*
      project, or a read-only catalog/search request, is not blocked by
      it.
- [ ] Simulating a process restart between two turns (dropping all
      in-memory state and re-invoking the turn controller fresh)
      reproduces the same reconstructed context for a continued
      conversation -- confirms D8 statelessness.
- [ ] `server/src/routes/chat.ts` exposes a route that starts/continues a
      turn and streams token/tool-call/status events over Server-Sent
      Events; gated behind existing auth (`requireAuth`) plus an
      admin-only or test-harness-only guard (document which is chosen --
      no production chat UI consumes this route yet, per sprint.md's Out
      of Scope).
- [ ] A test (or admin-only harness) drives one full turn end-to-end
      through the mock adapter: chat message in, a
      `create_knowledge_entry` or `add_asset_to_collection` tool call
      out, and the resulting row exists in the DB with a corresponding
      `ChatMessage` history entry -- this sprint's own top-level success
      criterion, verified here.
- [ ] Two simulated concurrent turn-start requests on the same project,
      run against the test suite's mock adapter, demonstrably serialize
      (the second one's tool calls never interleave with the first's).
- [ ] The Agent Runtime calls a stub `ImageVisionClient` interface (e.g.
      `server/src/agent/imageVisionStub.ts`) for any image-generation
      step in the loop, not the real OpenAI/OpenRouter APIs -- Sprint 004
      replaces the stub with the real Image & Vision Service without
      changing `turn.ts`'s call site shape.

## Implementation Plan

### Approach

`turn.ts`'s controller is the one place in this sprint that composes
tickets 001-004: knowledge retrieval (`services/search.ts`, read-only),
the active `ProviderAdapter` (ticket 004), the Workspace MCP Server's
tool dispatch (tickets 002/003, invoked in-process -- the turn controller
holds a reference to `workspaceMcpServer`'s tool-call handlers, not an
HTTP client), and `locks.ts` (ticket 002) for the `project_turn` lock.
Keep the loop simple: reconstruct context -> call adapter -> if
tool_calls, dispatch each to the Workspace MCP Server and feed results
back to the adapter -> repeat until a final message -> persist
`ChatMessage` rows -> release lock. `chat.ts`'s SSE route wraps this
loop, translating its internal step-by-step events (token deltas,
tool-call-started/finished, final message) into SSE `data:` frames --
exact event shape is the implementer's call, but should be structured
enough that Sprint 005's `MockupChatPanel.tsx` wiring doesn't need to
guess. Gate the route behind `requireAdmin` (simplest option, reuses an
existing middleware) unless a dedicated test-harness flag proves
simpler -- document whichever is chosen in the route file's own comment,
since this is an explicit, temporary scope boundary Sprint 005 will
revisit when the real UI wires in.

### Files to Create/Modify

- `server/src/agent/turn.ts` (new)
- `server/src/agent/imageVisionStub.ts` (new)
- `server/src/routes/chat.ts` (new)
- `server/src/app.ts` (modify -- mount the new chat route under `/api`,
  matching the existing `app.use('/api', ...)` pattern)

### Testing Plan

- **Existing tests to run**: `npm test` (full suite) -- must stay green
  with no real `ANTHROPIC_API_KEY`, using the mock adapter throughout.
- **New tests to write**:
  - `tests/server/agent-turn.test.ts` -- end-to-end turn via the mock
    adapter: message in, `create_knowledge_entry` tool call out, DB row
    exists, `ChatMessage` history recorded correctly; statelessness
    (context reconstruction survives a simulated restart); `project_turn`
    lock acquired/released; two concurrent same-project turn-starts
    serialize; a different-project turn-start is not blocked.
  - `tests/server/chat-route.test.ts` -- SSE endpoint auth gate rejects
    unauthenticated/non-admin requests; an authorized request streams the
    expected event sequence for a scripted mock-adapter turn.
- **Verification command**: `npm test`

### Documentation Updates

None beyond this ticket -- Sprint 005's own planning documents the real
UI wiring against whatever event shape this ticket ships.

## Testing

- **Existing tests to run**: `npm test`.
- **New tests to write**: `tests/server/agent-turn.test.ts`,
  `tests/server/chat-route.test.ts` per Testing Plan above.
- **Verification command**: `npm test`

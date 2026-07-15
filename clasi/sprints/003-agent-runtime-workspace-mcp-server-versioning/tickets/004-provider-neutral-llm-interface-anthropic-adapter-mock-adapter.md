---
id: "004"
title: "Provider-neutral LLM interface + Anthropic adapter + mock adapter"
status: open
use-cases: [SUC-003]
depends-on: ["003"]
github-issue: ""
issue: agent-runtime-and-chat.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Provider-neutral LLM interface + Anthropic adapter + mock adapter

## Description

Build the `ProviderAdapter` interface (architecture-001 D10) and its two
implementations: the Anthropic adapter (Claude Agent SDK, default) and a
minimal mock adapter (test-only, proves the swap-containment claim per
`architecture-update.md` R4). This ticket does not build the turn
controller that calls these adapters (ticket 005) -- it builds the
interface and both implementations in isolation, each independently
testable against a scripted tool-use exchange. Depends on ticket 003
because the adapters' tool-schema translation needs the Workspace MCP
Server's finished tool surface (fs + catalog) to translate against.

## Acceptance Criteria

- [ ] `server/src/agent/providers/types.ts` defines a `ProviderAdapter`
      interface covering: sending a chat-completions-plus-tool-use
      request (system prompt, message history, available tool
      definitions) and receiving a response that is either a final
      assistant message or one or more tool-use requests; the interface
      has zero outward dependencies on any specific vendor SDK type.
- [ ] `server/src/agent/providers/anthropic.ts` implements
      `ProviderAdapter` using the Claude Agent SDK (or the Anthropic
      Messages API with tool use -- document which), translating the
      Workspace MCP Server's tool definitions (tickets 002/003) into the
      SDK's expected tool-schema format and translating the SDK's
      tool-use response back into the interface's provider-neutral
      shape.
- [ ] `server/src/agent/providers/mock.ts` implements the same
      `ProviderAdapter` interface against a scripted/canned response
      sequence (no real network call), configurable per test.
- [ ] A test drives one scripted tool-use exchange (e.g. "call
      `create_knowledge_entry`, then respond with a final message")
      through **both** adapters and confirms: (a) the mock adapter
      completes it with no network access; (b) the Anthropic adapter's
      request/response translation is correct against a mocked Claude
      Agent SDK client (no real API call, no real `ANTHROPIC_API_KEY`
      required) -- the full suite is green with no real Anthropic
      credentials present.
- [ ] Neither adapter file is imported by, or has any awareness of,
      `ChatMessage`, `Lock`, or any Prisma model -- adapters translate
      wire formats only; persistence and tool dispatch belong to ticket
      005's turn controller.
- [ ] A documented, provider-neutral tool-call result shape (e.g. `{
      name: string; args: unknown; result: unknown }`) is exported from
      `providers/types.ts` for ticket 005 to use when persisting
      `ChatMessage.toolCalls` (D10 Consequences -- no raw SDK object ever
      reaches storage).

## Implementation Plan

### Approach

Keep the interface deliberately small: e.g. `sendTurn(input:
ProviderTurnInput): Promise<ProviderTurnResult>` where
`ProviderTurnResult` is a discriminated union of `{ kind: 'message';
content: string }` and `{ kind: 'tool_calls'; calls: ProviderToolCall[]
}` (exact shape is the implementer's call; the binding requirement is
vendor-neutrality and zero SDK leakage, not a specific TypeScript shape).
The Anthropic adapter wraps the Claude Agent SDK client; inject the SDK
client (or an equivalent thin HTTP wrapper) so it can be mocked in tests
without a real API key. The mock adapter takes its scripted response
sequence as a constructor/factory argument so each test controls its own
script.

### Files to Create/Modify

- `server/src/agent/providers/types.ts` (new)
- `server/src/agent/providers/anthropic.ts` (new)
- `server/src/agent/providers/mock.ts` (new)
- `server/package.json` (modify -- add the Anthropic/Claude Agent SDK
  dependency)

### Testing Plan

- **Existing tests to run**: `npm test` -- must stay green with no real
  `ANTHROPIC_API_KEY`.
- **New tests to write** (`tests/server/agent-providers.test.ts`):
  - Mock adapter: scripted tool-call-then-final-message sequence returns
    the expected provider-neutral shape at each step.
  - Anthropic adapter: a mocked Claude Agent SDK client returns a canned
    tool-use response; assert the adapter translates it into the same
    provider-neutral shape the mock adapter produces for an equivalent
    scripted exchange (structural parity check -- the concrete test
    proving R4's swap-containment claim).
  - Anthropic adapter's outbound translation: given a Workspace MCP
    Server-shaped tool definition (name, description, JSON-schema-ish
    args), assert the adapter produces the tool-schema shape the mocked
    SDK client expects.
- **Verification command**: `npm test`

### Documentation Updates

None beyond this ticket.

## Testing

- **Existing tests to run**: `npm test`.
- **New tests to write**: `tests/server/agent-providers.test.ts` per
  Testing Plan above.
- **Verification command**: `npm test`

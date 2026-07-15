/**
 * Provider-neutral LLM interface (architecture-001 §Module 3 "Provider
 * interface" bullet, D10; this sprint's ticket 004). This is the seam
 * D10 requires: the Agent Runtime's turn controller (ticket 005) talks
 * only to `ProviderAdapter`, never to a vendor SDK type directly.
 *
 * Deliberately small: send a chat-completions-plus-tool-use request
 * (system prompt, message history, available tool definitions) and get
 * back either a final assistant message or one or more tool-use
 * requests. Nothing in this file imports a vendor SDK type (Anthropic's
 * or otherwise) and nothing here imports `ChatMessage`, `Lock`, or any
 * Prisma model -- this is a wire-format boundary only. Persistence and
 * tool dispatch belong to ticket 005's turn controller, not to an
 * adapter (D10 Consequences: no raw SDK object ever reaches storage).
 *
 * Two implementations live alongside this file: `anthropic.ts` (the
 * default provider, wrapping the Anthropic Messages API) and `mock.ts`
 * (a test-only scripted adapter that proves the swap-containment claim
 * per architecture-update.md R4 -- the same turn-controller code must be
 * able to run against either implementation with no changes elsewhere).
 */

/** One tool the provider may call this turn, in the Workspace MCP
 * Server's own shape (tickets 002/003: `name`, `description`, a
 * JSON-schema-ish `inputSchema`) -- adapters translate this into their
 * vendor's tool-schema format (see `anthropic.ts`'s outbound
 * translation). */
export interface ProviderToolDefinition {
  name: string;
  description: string;
  /** JSON-schema-shaped argument spec, e.g.
   * `{ type: 'object', properties: {...}, required: [...] }`. */
  inputSchema: Record<string, unknown>;
}

/** One tool call the provider is requesting -- the turn controller
 * dispatches this to the Workspace MCP Server and eventually feeds a
 * `ProviderToolResult` back for it. `id` correlates a call to its result
 * within one turn; it is a provider-neutral identifier, not necessarily
 * any vendor's own call-id format (though the Anthropic adapter happens
 * to reuse the SDK's `tool_use.id` verbatim -- an implementation detail,
 * not a contract callers may rely on). */
export interface ProviderToolCall {
  id: string;
  name: string;
  args: unknown;
}

/** The result of one previously-requested tool call, shaped for
 * re-inclusion in `ProviderMessage.toolResults` on a follow-up
 * `sendTurn` call. Carries `toolCallId` (not just `name`) because a
 * single turn can request the same tool more than once. */
export interface ProviderToolResult {
  toolCallId: string;
  result: unknown;
  /** True if the tool dispatch itself failed -- lets the provider
   * distinguish "the tool ran and returned this error" from a normal
   * result, matching the vendor SDKs' own `is_error` convention. */
  isError?: boolean;
}

/** The documented, provider-neutral tool-call **record** shape (this
 * ticket's AC6): `{ name, args, result }`. Ticket 005's turn controller
 * assembles one of these per dispatched call (joining a
 * `ProviderToolCall` with its `ProviderToolResult` by id) when
 * persisting `ChatMessage.toolCalls` -- D10 Consequences requires that
 * column hold a provider-neutral shape, never a raw copy of any one
 * vendor's wire format. Adapters never construct this type themselves;
 * it exists here only so ticket 005 has a single shared definition to
 * import. */
export interface ProviderToolCallRecord {
  name: string;
  args: unknown;
  result: unknown;
}

/** One entry in the message history passed to `sendTurn`. `toolCalls` is
 * present on an assistant-role message that requested tool use in a
 * prior round of this turn; `toolResults` is present on a user-role
 * message that is actually feeding those calls' results back to the
 * provider (shaping that message is the turn controller's job -- an
 * adapter only translates it, it never dispatches tools itself, per
 * D10). `content` may be omitted on a message that consists solely of
 * tool calls or tool results. */
export interface ProviderMessage {
  role: 'user' | 'assistant';
  content?: string;
  toolCalls?: ProviderToolCall[];
  toolResults?: ProviderToolResult[];
}

export interface ProviderTurnInput {
  systemPrompt: string;
  messages: ProviderMessage[];
  tools: ProviderToolDefinition[];
}

/** A completed turn is either a final assistant message, or one or more
 * tool-use requests the turn controller must dispatch (via the
 * Workspace MCP Server) before calling `sendTurn` again with a
 * `ProviderMessage` carrying the corresponding `toolResults` appended to
 * `messages`. */
export type ProviderTurnResult =
  | { kind: 'message'; content: string }
  | { kind: 'tool_calls'; calls: ProviderToolCall[] };

/** The provider-neutral seam architecture-001 D10 requires. Implemented
 * by `anthropic.ts` (default, Claude Agent SDK's Messages API) and
 * `mock.ts` (test-only, scripted). Nothing outside `providers/` ever
 * imports a vendor SDK type -- callers depend only on this interface and
 * the types above. */
export interface ProviderAdapter {
  sendTurn(input: ProviderTurnInput): Promise<ProviderTurnResult>;
}

/**
 * Default `ProviderAdapter` implementation (architecture-001 D10;
 * ticket 004): wraps the **Anthropic Messages API** (`@anthropic-ai/sdk`,
 * `client.messages.create` with `tools` -- not streaming, since
 * `ProviderAdapter.sendTurn` is specified as a single request/response
 * round trip) -- not the Claude Agent SDK.
 *
 * **Which one, and why (ticket 004 AC2 asks this to be documented):** the
 * Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) is a batteries-
 * included harness -- it owns its own agent loop, session model, and
 * built-in tool dispatch. This sprint's turn controller (ticket 005) is
 * *itself* that harness for Flyerbot: it owns turn lifecycle, context
 * reconstruction (D8), `project_turn` lock acquisition, and dispatch to
 * the Workspace MCP Server. Handing all of that to a second harness
 * underneath it would fight the Agent SDK's own loop rather than compose
 * with it. The plain Messages API's tool-use request/response shape maps
 * directly onto `ProviderAdapter.sendTurn`'s contract -- one turn in, one
 * turn (message or tool-use requests) out -- with no hidden loop or
 * session state of its own, which is exactly the seam D10 asks for.
 *
 * **Credentials (ticket 004 "construct lazily" requirement):** no
 * `Anthropic` client is constructed until `sendTurn` actually runs. The
 * `ANTHROPIC_API_KEY` config slot (`server/src/services/config.ts`) may
 * be genuinely absent in dev/test/CI; failing at adapter-construction
 * time would make every other module that merely imports this file
 * require a key. Instead, `sendTurn` resolves a key (or a test-injected
 * `client`) lazily and throws a clear, specific error only if it is
 * actually invoked with neither. This is also what keeps `npm test`
 * green with no real key present (architecture-update.md R4) -- test
 * adapters always inject `options.client`, so the real SDK client is
 * never constructed and no network call is ever attempted in the suite.
 */
import Anthropic from '@anthropic-ai/sdk';
import type {
  ProviderAdapter,
  ProviderMessage,
  ProviderToolCall,
  ProviderToolDefinition,
  ProviderTurnInput,
  ProviderTurnResult,
} from './types';

/** Default model per the claude-api skill's current guidance -- override
 * via `options.model` or `ANTHROPIC_MODEL`. */
const DEFAULT_MODEL = 'claude-opus-4-8';
const DEFAULT_MAX_TOKENS = 8192;

// ---------------------------------------------------------------------------
// Minimal wire-shape types for the Anthropic Messages API surface this
// adapter uses. Defined locally (not imported from the SDK's own type
// tree) so the injectable `client` in `AnthropicAdapterOptions` can be
// satisfied by a plain test stub with no dependency on SDK internals --
// the real `Anthropic` client's `.messages` object satisfies this shape
// structurally (it returns a superset of these fields).
// ---------------------------------------------------------------------------

interface AnthropicToolParam {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicTextBlockParam {
  type: 'text';
  text: string;
}

interface AnthropicToolUseBlockParam {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

interface AnthropicToolResultBlockParam {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

type AnthropicContentBlockParam =
  | AnthropicTextBlockParam
  | AnthropicToolUseBlockParam
  | AnthropicToolResultBlockParam;

interface AnthropicMessageParam {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlockParam[];
}

interface AnthropicCreateParams {
  model: string;
  max_tokens: number;
  system?: string;
  tools?: AnthropicToolParam[];
  messages: AnthropicMessageParam[];
}

interface AnthropicResponseTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicResponseToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

/** The response may contain other block types (e.g. `thinking`); this
 * adapter only reads `text` and `tool_use` blocks, per `ProviderTurnResult`. */
type AnthropicResponseContentBlock =
  | AnthropicResponseTextBlock
  | AnthropicResponseToolUseBlock
  | { type: string; [key: string]: unknown };

interface AnthropicMessageResponse {
  content: AnthropicResponseContentBlock[];
}

/** The minimal shape of the Anthropic SDK's `client.messages` this
 * adapter depends on -- narrow enough to stub in tests with no real SDK
 * client, no network access, and no `ANTHROPIC_API_KEY`. */
export interface AnthropicMessagesClient {
  create(params: AnthropicCreateParams): Promise<AnthropicMessageResponse>;
}

export interface AnthropicAdapterOptions {
  /** Falls back to `process.env.ANTHROPIC_API_KEY`. Only consulted when
   * `client` is not supplied. */
  apiKey?: string;
  /** Falls back to `process.env.ANTHROPIC_MODEL`, then `DEFAULT_MODEL`. */
  model?: string;
  maxTokens?: number;
  /** Test-injectable stand-in for the real SDK client. When supplied,
   * `apiKey` is never consulted and no real `Anthropic` instance is ever
   * constructed. */
  client?: AnthropicMessagesClient;
}

/** Translates a `ProviderToolDefinition` (Workspace MCP Server shape)
 * into the Anthropic Messages API's tool-schema shape. */
export function toAnthropicTool(tool: ProviderToolDefinition): AnthropicToolParam {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}

/** Translates one `ProviderMessage` into the Anthropic Messages API's
 * message-param shape. An assistant message with `toolCalls` becomes a
 * `tool_use`-block-bearing assistant turn (plus a leading text block if
 * `content` is also present); a user message with `toolResults` becomes
 * a `tool_result`-block-bearing user turn. Anthropic's `tool_result`
 * `content` is always a string -- non-string tool results are
 * JSON-serialized. */
function toAnthropicMessage(message: ProviderMessage): AnthropicMessageParam {
  if (message.toolCalls && message.toolCalls.length > 0) {
    const blocks: AnthropicContentBlockParam[] = [];
    if (message.content) {
      blocks.push({ type: 'text', text: message.content });
    }
    for (const call of message.toolCalls) {
      blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args });
    }
    return { role: 'assistant', content: blocks };
  }

  if (message.toolResults && message.toolResults.length > 0) {
    const blocks: AnthropicContentBlockParam[] = message.toolResults.map((result) => ({
      type: 'tool_result',
      tool_use_id: result.toolCallId,
      content: typeof result.result === 'string' ? result.result : JSON.stringify(result.result),
      is_error: result.isError,
    }));
    return { role: 'user', content: blocks };
  }

  return { role: message.role, content: message.content ?? '' };
}

/** Translates the Anthropic Messages API's response back into the
 * provider-neutral `ProviderTurnResult`. Any `tool_use` block present
 * means the turn is a tool-call request (`ProviderTurnResult` is a
 * discriminated union -- a response can technically carry both text and
 * tool_use blocks, but the interface asks for exactly one of "final
 * message" or "tool-use requests", so tool_use blocks take priority and
 * any accompanying text is dropped, matching how the turn controller
 * will resume the turn after dispatching the calls). */
function fromAnthropicResponse(response: AnthropicMessageResponse): ProviderTurnResult {
  const toolUseBlocks = response.content.filter(
    (block): block is AnthropicResponseToolUseBlock => block.type === 'tool_use'
  );

  if (toolUseBlocks.length > 0) {
    const calls: ProviderToolCall[] = toolUseBlocks.map((block) => ({
      id: block.id,
      name: block.name,
      args: block.input,
    }));
    return { kind: 'tool_calls', calls };
  }

  const text = response.content
    .filter((block): block is AnthropicResponseTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
  return { kind: 'message', content: text };
}

/** Default `ProviderAdapter`: the Anthropic Messages API, default and
 * only adapter wired into the running app this sprint (architecture-
 * update.md R4 -- `mock.ts` is test-only, not a second production
 * option). */
export function createAnthropicAdapter(options: AnthropicAdapterOptions = {}): ProviderAdapter {
  return {
    async sendTurn(input: ProviderTurnInput): Promise<ProviderTurnResult> {
      const client = options.client ?? buildRealClient(options);

      const response = await client.create({
        model: options.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: input.systemPrompt,
        tools: input.tools.map(toAnthropicTool),
        messages: input.messages.map(toAnthropicMessage),
      });

      return fromAnthropicResponse(response);
    },
  };
}

/** Constructs the real SDK client, lazily, only when `sendTurn` actually
 * runs with no injected `client`. Throws a clear, specific error if no
 * API key is available -- never throws at `createAnthropicAdapter(...)`
 * call time, so importing/constructing this adapter never requires a key
 * (see module header). */
function buildRealClient(options: AnthropicAdapterOptions): AnthropicMessagesClient {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'AnthropicAdapter: no ANTHROPIC_API_KEY configured (set the env var, the AI Services config value, or pass options.apiKey) -- cannot call the Anthropic API without credentials.'
    );
  }
  const sdkClient = new Anthropic({ apiKey });
  // The real SDK's `messages.create` returns a superset of
  // AnthropicMessageResponse's fields, so it satisfies
  // AnthropicMessagesClient structurally; a direct cast keeps this
  // module's exported types independent of the SDK's own type tree
  // (see the wire-shape comment above).
  return sdkClient.messages as unknown as AnthropicMessagesClient;
}

/**
 * Coverage for the Agent Runtime's provider-neutral LLM interface
 * (ticket 003-004): `providers/types.ts`'s `ProviderAdapter` contract,
 * the mock adapter (`providers/mock.ts`), and the Anthropic adapter's
 * request/response translation (`providers/anthropic.ts`) against a
 * stubbed SDK client -- no real `ANTHROPIC_API_KEY`, no network call,
 * anywhere in this file (architecture-update.md R4).
 *
 * The central test in this file drives one scripted tool-use exchange
 * ("call create_knowledge_entry, then respond with a final message")
 * through *both* adapters and asserts they produce the same
 * provider-neutral shape at each step -- the concrete proof of D10's
 * swap-containment claim, not just documentation of it.
 */
import fs from 'fs/promises';
import path from 'path';
import {
  createAnthropicAdapter,
  toAnthropicTool,
  type AnthropicMessagesClient,
} from '../../server/src/agent/providers/anthropic';
import { createMockAdapter, type MockProviderScript } from '../../server/src/agent/providers/mock';
import type {
  ProviderToolDefinition,
  ProviderTurnInput,
  ProviderTurnResult,
} from '../../server/src/agent/providers/types';

const previousApiKey = process.env.ANTHROPIC_API_KEY;
const previousModel = process.env.ANTHROPIC_MODEL;

beforeEach(() => {
  // This suite must stay green with no real ANTHROPIC_API_KEY present,
  // even if the developer's own shell happens to export one (e.g. via
  // dotconfig) -- every adapter under test here is either the mock or an
  // Anthropic adapter with an injected stub client, so a real env key
  // must never be consulted.
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_MODEL;
});

afterAll(() => {
  if (previousApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = previousApiKey;
  if (previousModel === undefined) delete process.env.ANTHROPIC_MODEL;
  else process.env.ANTHROPIC_MODEL = previousModel;
});

// ---------------------------------------------------------------------------
// The shared scripted exchange both adapters are driven through.
// ---------------------------------------------------------------------------

const createKnowledgeEntryTool: ProviderToolDefinition = {
  name: 'create_knowledge_entry',
  description: "Create a new KnowledgeEntry, or update an existing one's metadata.",
  inputSchema: {
    type: 'object',
    properties: {
      directoryId: { type: 'integer' },
      kind: { type: 'string' },
      name: { type: 'string' },
      bodyText: { type: 'string' },
    },
    required: ['directoryId', 'kind', 'name', 'bodyText'],
  },
};

const toolCallArgs = { directoryId: 1, kind: 'note', name: 'Test Entry', bodyText: 'hello world' };

const turn1Input: ProviderTurnInput = {
  systemPrompt: 'You are the Flyerbot agent.',
  messages: [{ role: 'user', content: 'Please create a knowledge entry for this.' }],
  tools: [createKnowledgeEntryTool],
};

function turn2Input(callId: string): ProviderTurnInput {
  return {
    systemPrompt: turn1Input.systemPrompt,
    tools: turn1Input.tools,
    messages: [
      ...turn1Input.messages,
      { role: 'assistant', toolCalls: [{ id: callId, name: 'create_knowledge_entry', args: toolCallArgs }] },
      {
        role: 'user',
        toolResults: [{ toolCallId: callId, result: { id: 42, name: 'Test Entry' } }],
      },
    ],
  };
}

describe('mock adapter (providers/mock.ts)', () => {
  it('returns the scripted tool-call-then-final-message sequence, one entry per sendTurn call', async () => {
    const script: MockProviderScript = [
      { kind: 'tool_calls', calls: [{ id: 'call-1', name: 'create_knowledge_entry', args: toolCallArgs }] },
      { kind: 'message', content: 'Created the knowledge entry.' },
    ];
    const adapter = createMockAdapter(script);

    const first = await adapter.sendTurn(turn1Input);
    expect(first).toEqual(script[0]);
    expect(first.kind).toBe('tool_calls');

    const second = await adapter.sendTurn(turn2Input('call-1'));
    expect(second).toEqual(script[1]);
    expect(second.kind).toBe('message');
  });

  it('throws a clear error rather than returning undefined when called past the end of the script', async () => {
    const adapter = createMockAdapter([{ kind: 'message', content: 'only one turn scripted' }]);
    await adapter.sendTurn(turn1Input);
    await expect(adapter.sendTurn(turn1Input)).rejects.toThrow(/script only has 1 entries/);
  });

  it('invokes onSendTurn with each input, without importing ChatMessage/Lock/Prisma to do so', async () => {
    const seen: ProviderTurnInput[] = [];
    const adapter = createMockAdapter([{ kind: 'message', content: 'ok' }], {
      onSendTurn: (input) => seen.push(input),
    });
    await adapter.sendTurn(turn1Input);
    expect(seen).toEqual([turn1Input]);
  });

  it('makes no network access to complete the scripted exchange (no fetch/http import anywhere in the module)', async () => {
    const source = await fs.readFile(
      path.resolve(__dirname, '../../server/src/agent/providers/mock.ts'),
      'utf8'
    );
    expect(source).not.toMatch(/\bfetch\(|require\(['"]https?['"]\)|from ['"]https?['"]/);
  });
});

describe('anthropic adapter -- outbound translation (providers/anthropic.ts)', () => {
  it('toAnthropicTool translates a Workspace MCP Server-shaped tool definition into the SDK tool-schema shape', () => {
    const translated = toAnthropicTool(createKnowledgeEntryTool);
    expect(translated).toEqual({
      name: 'create_knowledge_entry',
      description: createKnowledgeEntryTool.description,
      input_schema: createKnowledgeEntryTool.inputSchema,
    });
  });

  it('sendTurn calls the injected client with the translated tools, system prompt, and message history -- never a real SDK client', async () => {
    let capturedParams: unknown;
    const stubClient: AnthropicMessagesClient = {
      async create(params) {
        capturedParams = params;
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    };
    const adapter = createAnthropicAdapter({ client: stubClient, model: 'claude-opus-4-8' });

    await adapter.sendTurn(turn1Input);

    expect(capturedParams).toMatchObject({
      model: 'claude-opus-4-8',
      system: turn1Input.systemPrompt,
      tools: [
        {
          name: 'create_knowledge_entry',
          description: createKnowledgeEntryTool.description,
          input_schema: createKnowledgeEntryTool.inputSchema,
        },
      ],
      messages: [{ role: 'user', content: 'Please create a knowledge entry for this.' }],
    });
  });

  it('translates an assistant toolCalls message into tool_use content blocks, and a toolResults message into tool_result blocks', async () => {
    let capturedParams: any;
    const stubClient: AnthropicMessagesClient = {
      async create(params) {
        capturedParams = params;
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    };
    const adapter = createAnthropicAdapter({ client: stubClient });

    await adapter.sendTurn(turn2Input('call-1'));

    const [, assistantMsg, userMsg] = capturedParams.messages;
    expect(assistantMsg).toEqual({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'call-1', name: 'create_knowledge_entry', input: toolCallArgs }],
    });
    expect(userMsg).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call-1',
          content: JSON.stringify({ id: 42, name: 'Test Entry' }),
          is_error: undefined,
        },
      ],
    });
  });

  it('fails with a clear error only when sendTurn actually runs with no client and no ANTHROPIC_API_KEY -- never at adapter-construction time', async () => {
    // Construction must not throw even with no key configured (env is
    // cleared in beforeEach above) -- only the eventual sendTurn call
    // that would need real credentials should fail, and with a specific,
    // actionable message rather than an SDK-internal error.
    const adapter = createAnthropicAdapter();
    await expect(adapter.sendTurn(turn1Input)).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe('anthropic adapter -- inbound translation (mocked SDK client, no real API call)', () => {
  it("translates a tool_use response block into a 'tool_calls' ProviderTurnResult", async () => {
    const stubClient: AnthropicMessagesClient = {
      async create() {
        return {
          content: [{ type: 'tool_use', id: 'call-1', name: 'create_knowledge_entry', input: toolCallArgs }],
        };
      },
    };
    const adapter = createAnthropicAdapter({ client: stubClient });

    const result = await adapter.sendTurn(turn1Input);

    expect(result).toEqual({
      kind: 'tool_calls',
      calls: [{ id: 'call-1', name: 'create_knowledge_entry', args: toolCallArgs }],
    });
  });

  it("translates a text-only response into a 'message' ProviderTurnResult, joining multiple text blocks", async () => {
    const stubClient: AnthropicMessagesClient = {
      async create() {
        return {
          content: [
            { type: 'text', text: 'Created the ' },
            { type: 'text', text: 'knowledge entry.' },
          ],
        };
      },
    };
    const adapter = createAnthropicAdapter({ client: stubClient });

    const result = await adapter.sendTurn(turn2Input('call-1'));

    expect(result).toEqual({ kind: 'message', content: 'Created the knowledge entry.' });
  });
});

describe('structural parity -- the concrete proof of the D10 swap-containment claim (R4)', () => {
  it('drives the same scripted tool-call-then-final-message exchange through the mock adapter and a stubbed Anthropic adapter and gets the same provider-neutral shape at each step', async () => {
    const script: MockProviderScript = [
      { kind: 'tool_calls', calls: [{ id: 'call-1', name: 'create_knowledge_entry', args: toolCallArgs }] },
      { kind: 'message', content: 'Created the knowledge entry.' },
    ];
    const mockAdapter = createMockAdapter(script);

    const stubClient: AnthropicMessagesClient = {
      async create(params) {
        // A minimal canned SDK response equivalent to the mock's script,
        // keyed off which turn this is (first call has no tool_result
        // messages yet; second does).
        const isFollowUp = params.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result'));
        if (!isFollowUp) {
          return {
            content: [{ type: 'tool_use', id: 'call-1', name: 'create_knowledge_entry', input: toolCallArgs }],
          };
        }
        return { content: [{ type: 'text', text: 'Created the knowledge entry.' }] };
      },
    };
    const anthropicAdapter = createAnthropicAdapter({ client: stubClient });

    async function driveExchange(adapter: { sendTurn(input: ProviderTurnInput): Promise<ProviderTurnResult> }) {
      const first = await adapter.sendTurn(turn1Input);
      if (first.kind !== 'tool_calls') throw new Error('expected tool_calls on the first turn');
      const second = await adapter.sendTurn(turn2Input(first.calls[0].id));
      return [first, second] as const;
    }

    const mockResults = await driveExchange(mockAdapter);
    const anthropicResults = await driveExchange(anthropicAdapter);

    // Both adapters, implementing the exact same ProviderAdapter
    // interface against completely different backends (a canned script
    // vs a stubbed SDK client), produce structurally identical
    // provider-neutral results -- the turn controller (ticket 005)
    // cannot tell which one it's talking to.
    expect(anthropicResults).toEqual(mockResults);
  });
});

describe('adapters have zero awareness of ChatMessage, Lock, or any Prisma model (ticket AC5)', () => {
  it('neither providers/anthropic.ts nor providers/mock.ts has an import statement referencing ChatMessage, Lock, or the Prisma client', async () => {
    // Scoped to actual `import ...` statements (not doc-comment prose,
    // which is free to *mention* these names when explaining why the
    // adapter doesn't need them -- see mock.ts's module header).
    const forbidden = /ChatMessage|\bLock\b|services\/prisma|generated\/prisma/;
    for (const file of ['anthropic.ts', 'mock.ts']) {
      const source = await fs.readFile(
        path.resolve(__dirname, `../../server/src/agent/providers/${file}`),
        'utf8'
      );
      const importLines = source.match(/^import[^\n]+$/gm) ?? [];
      expect(importLines.join('\n')).not.toMatch(forbidden);
    }
  });
});

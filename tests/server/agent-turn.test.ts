/**
 * Coverage for the Agent Runtime turn controller (ticket 005):
 * `server/src/agent/turn.ts`'s `runTurn` -- context reconstruction (D8),
 * traceable knowledge retrieval (D9), the provider/tool-dispatch loop
 * against the mock adapter (architecture-update.md R4 -- no real
 * `ANTHROPIC_API_KEY`, no network call anywhere in this file),
 * `ChatMessage` persistence in the provider-neutral `{ name, args,
 * result }` shape, the `project_turn` `Lock` acquire/release, this
 * sprint's bounded wait/retry serialization for a same-project concurrent
 * turn-start (R5), and the stub `ImageVisionClient` call site (AC8).
 *
 * This file's first `describe` block ("end-to-end via the mock adapter")
 * is this sprint's own top-level success criterion (sprint.md), verified
 * directly: chat message in, a `create_knowledge_entry` tool call out,
 * the resulting row exists in the DB with a corresponding `ChatMessage`
 * history entry.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { prisma } from '../../server/src/services/prisma';
import {
  runTurn,
  chatMessageToProviderMessage,
  TurnLockTimeoutError,
  IMAGE_GENERATION_TOOL_NAME,
  type TurnEvent,
  type TurnVersioningService,
  type WorkspaceToolHandler,
} from '../../server/src/agent/turn';
import { createMockAdapter, type MockProviderScript } from '../../server/src/agent/providers/mock';
import { createKnowledgeEntry } from '../../server/src/agent-mcp/catalogTools';
import { acquireLock, releaseLock } from '../../server/src/agent-mcp/locks';
import type { ImageVisionClient } from '../../server/src/agent/imageVisionStub';

const marker = `t005turn${Date.now()}`;

let ownerId: number;
let knowledgeDirId: number;
let projectAId: number;
let projectBId: number;

const cleanup = {
  knowledgeEntryIds: [] as number[],
  projectIds: [] as number[],
  workspaceDirectoryIds: [] as number[],
};

/** A `TurnVersioningService` spy: records every `recordChange` path and
 * `commitTurn` summary without touching git or the real singleton. */
function makeVersioningSpy(): TurnVersioningService & { recordChangeCalls: string[]; commitSummaries: string[] } {
  const recordChangeCalls: string[] = [];
  const commitSummaries: string[] = [];
  return {
    recordChangeCalls,
    commitSummaries,
    recordChange(p: string) {
      recordChangeCalls.push(p);
    },
    async commitTurn(summary: string) {
      commitSummaries.push(summary);
      return { committed: true, commitHash: `fake-${commitSummaries.length}`, pushed: false };
    },
  };
}

beforeAll(async () => {
  const owner = await prisma.user.create({
    data: { email: `${marker}-owner@example.com`, displayName: 'Turn Test Owner' },
  });
  ownerId = owner.id;

  const dir = await prisma.workspaceDirectory.create({
    data: { path: `${marker}/knowledge`, kind: 'knowledge-category' },
  });
  knowledgeDirId = dir.id;
  cleanup.workspaceDirectoryIds.push(dir.id);

  const projectA = await prisma.project.create({ data: { title: `${marker}-project-a`, ownerUserId: ownerId } });
  projectAId = projectA.id;
  cleanup.projectIds.push(projectAId);

  const projectB = await prisma.project.create({ data: { title: `${marker}-project-b`, ownerUserId: ownerId } });
  projectBId = projectB.id;
  cleanup.projectIds.push(projectBId);
});

afterAll(async () => {
  await prisma.chatMessage.deleteMany({ where: { projectId: { in: cleanup.projectIds } } });
  await prisma.knowledgeEntry.deleteMany({ where: { id: { in: cleanup.knowledgeEntryIds } } });
  await prisma.project.deleteMany({ where: { id: { in: cleanup.projectIds } } });
  await prisma.workspaceDirectory.deleteMany({ where: { id: { in: cleanup.workspaceDirectoryIds } } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
});

afterEach(async () => {
  // Belt-and-braces: no test in this file should leave a Lock row behind.
  await prisma.lock.deleteMany({ where: { resourceType: { in: ['project_turn', 'directory'] } } });
});

// ---------------------------------------------------------------------------
// End-to-end: this sprint's own top-level success criterion.
// ---------------------------------------------------------------------------

describe('runTurn -- end-to-end via the mock adapter', () => {
  it('drives a chat message through a create_knowledge_entry tool call to a final message, persisting ChatMessage rows and the DB row', async () => {
    const versioning = makeVersioningSpy();
    const toolCallArgs = {
      directoryId: knowledgeDirId,
      kind: 'style',
      name: `${marker}-entry`,
      bodyText: 'a warm autumn color palette',
    };
    const script: MockProviderScript = [
      { kind: 'tool_calls', calls: [{ id: 'call-1', name: 'create_knowledge_entry', args: toolCallArgs }] },
      { kind: 'message', content: 'Created the knowledge entry for you.' },
    ];
    const events: TurnEvent[] = [];

    const result = await runTurn(
      { projectId: projectAId, message: 'Please save this as a knowledge entry.' },
      { provider: createMockAdapter(script), versioning, onEvent: (event) => events.push(event) }
    );

    expect(result.finalMessage).toBe('Created the knowledge entry for you.');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({ name: 'create_knowledge_entry', args: toolCallArgs });

    const createdEntryId = (result.toolCalls[0].result as any).id;
    cleanup.knowledgeEntryIds.push(createdEntryId);

    const dbEntry = await prisma.knowledgeEntry.findUnique({ where: { id: createdEntryId } });
    expect(dbEntry?.name).toBe(toolCallArgs.name);
    expect(dbEntry?.bodyText).toBe(toolCallArgs.bodyText);

    const rows = await prisma.chatMessage.findMany({ where: { projectId: projectAId }, orderBy: { id: 'asc' } });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ role: 'user', content: 'Please save this as a knowledge entry.', toolCalls: null });
    expect(rows[1].role).toBe('assistant');
    expect(rows[1].toolCalls).toMatchObject([{ name: 'create_knowledge_entry', args: toolCallArgs }]);
    expect((rows[1].toolCalls as any[])[0].result).toMatchObject({ id: createdEntryId });
    expect(rows[2]).toMatchObject({ role: 'assistant', content: 'Created the knowledge entry for you.', toolCalls: null });

    // The tool handler's own recordChange (via catalogTools.createKnowledgeEntry)
    // and turn.ts's own commitTurn both went through this one injected spy --
    // the same wiring the real WorkspaceVersioningService singleton gets in
    // production.
    expect(versioning.recordChangeCalls).toHaveLength(1);
    expect(versioning.commitSummaries).toHaveLength(1);

    const lock = await prisma.lock.findFirst({ where: { resourceType: 'project_turn', resourceKey: String(projectAId) } });
    expect(lock).toBeNull();

    expect(events.some((e) => e.type === 'tool_call_started' && e.name === 'create_knowledge_entry')).toBe(true);
    expect(events.some((e) => e.type === 'tool_call_finished' && e.name === 'create_knowledge_entry' && !e.isError)).toBe(
      true
    );
    expect(events.some((e) => e.type === 'message' && e.content === 'Created the knowledge entry for you.')).toBe(true);
    expect(events.some((e) => e.type === 'status' && e.status === 'completed')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Traceable knowledge retrieval (D9, spec §8).
// ---------------------------------------------------------------------------

describe('runTurn -- knowledge retrieval is traceable', () => {
  it('records which KnowledgeEntry rows were consulted and folds them into the system prompt', async () => {
    const seeded = await createKnowledgeEntry(
      { directoryId: knowledgeDirId, kind: 'style', name: `${marker}-searchable`, bodyText: 'zephyrwave neon palette' },
      { versioning: makeVersioningSpy() }
    );
    cleanup.knowledgeEntryIds.push(seeded.id);

    let capturedSystemPrompt = '';
    const adapter = createMockAdapter([{ kind: 'message', content: 'Sure, zephyrwave neon it is.' }], {
      onSendTurn: (input) => {
        capturedSystemPrompt = input.systemPrompt;
      },
    });

    const result = await runTurn(
      { projectId: projectAId, message: 'Tell me about the zephyrwave palette.' },
      { provider: adapter, versioning: makeVersioningSpy() }
    );

    expect(result.consultedKnowledge.some((e) => e.ownerType === 'knowledge_entry' && e.ownerId === seeded.id)).toBe(
      true
    );
    expect(capturedSystemPrompt).toContain(`knowledge_entry#${seeded.id}`);
  });
});

// ---------------------------------------------------------------------------
// Statelessness (D8): a "process restart" between two turns is invisible.
// ---------------------------------------------------------------------------

describe('runTurn -- statelessness (D8)', () => {
  it('reconstructs identical context from ChatMessage rows across separate runTurn calls, no in-memory state carried between them', async () => {
    await runTurn(
      { projectId: projectBId, message: 'First message in the conversation.' },
      { provider: createMockAdapter([{ kind: 'message', content: 'Got it.' }]), versioning: makeVersioningSpy() }
    );

    // "Process restart": a brand-new provider/versioning instance with no
    // shared in-memory state with the call above -- the only thing
    // connecting the two calls is projectBId's row in the DB.
    let capturedMessages: unknown[] = [];
    const adapter2 = createMockAdapter([{ kind: 'message', content: 'Continuing.' }], {
      onSendTurn: (input) => {
        capturedMessages = input.messages;
      },
    });

    await runTurn(
      { projectId: projectBId, message: 'Second message, continuing the conversation.' },
      { provider: adapter2, versioning: makeVersioningSpy() }
    );

    const rows = await prisma.chatMessage.findMany({ where: { projectId: projectBId }, orderBy: { id: 'asc' } });
    expect(rows).toHaveLength(4); // user1, assistant-final1, user2, assistant-final2

    const expectedHistory = rows.slice(0, 2).map(chatMessageToProviderMessage);
    expect(capturedMessages.slice(0, 2)).toEqual(expectedHistory);
    expect(capturedMessages[2]).toEqual({ role: 'user', content: 'Second message, continuing the conversation.' });
  });
});

// ---------------------------------------------------------------------------
// project_turn Lock acquire/release.
// ---------------------------------------------------------------------------

describe('runTurn -- project_turn lock', () => {
  it('acquires a Lock row before starting and releases it once the turn completes', async () => {
    let lockDuringTurn: unknown = null;
    const adapter = createMockAdapter([{ kind: 'message', content: 'Done.' }]);
    const observingAdapter = {
      async sendTurn(input: any) {
        lockDuringTurn = await prisma.lock.findFirst({
          where: { resourceType: 'project_turn', resourceKey: String(projectAId) },
        });
        return adapter.sendTurn(input);
      },
    };

    await runTurn({ projectId: projectAId, message: 'One more.' }, { provider: observingAdapter, versioning: makeVersioningSpy() });

    expect(lockDuringTurn).not.toBeNull();
    expect((lockDuringTurn as any).resourceKey).toBe(String(projectAId));

    const lockAfter = await prisma.lock.findFirst({
      where: { resourceType: 'project_turn', resourceKey: String(projectAId) },
    });
    expect(lockAfter).toBeNull();
  });

  it('releases the lock even when the turn throws', async () => {
    const throwingAdapter = {
      async sendTurn() {
        throw new Error('boom');
      },
    };

    await expect(
      runTurn(
        { projectId: projectAId, message: 'This will fail.' },
        { provider: throwingAdapter as any, versioning: makeVersioningSpy() }
      )
    ).rejects.toThrow('boom');

    const lockAfter = await prisma.lock.findFirst({
      where: { resourceType: 'project_turn', resourceKey: String(projectAId) },
    });
    expect(lockAfter).toBeNull();
  });

  it('throws TurnLockTimeoutError when the lock is held past the configured bound (Open Question 5)', async () => {
    await acquireLock('project_turn', String(projectAId), 'external-holder');
    try {
      await expect(
        runTurn(
          { projectId: projectAId, message: 'blocked' },
          {
            provider: createMockAdapter([{ kind: 'message', content: 'n/a' }]),
            versioning: makeVersioningSpy(),
            lock: { timeoutMs: 80, pollIntervalMs: 10 },
          }
        )
      ).rejects.toBeInstanceOf(TurnLockTimeoutError);
    } finally {
      await releaseLock('project_turn', String(projectAId));
    }
  });
});

// ---------------------------------------------------------------------------
// Concurrent turn-start serialization (R5).
// ---------------------------------------------------------------------------

describe('runTurn -- concurrent turn-start serialization (R5)', () => {
  it('a second turn-start on the same project queues/waits, never interleaving tool calls with the first', async () => {
    const callOrder: string[] = [];
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const toolHandlers: Record<string, WorkspaceToolHandler> = {
      create_knowledge_entry: async (args: any) => {
        callOrder.push(`${args.name}:start`);
        if (args.name === 'first') {
          await firstGate;
        }
        callOrder.push(`${args.name}:end`);
        return { id: -1, name: args.name };
      },
    };

    const scriptFirst: MockProviderScript = [
      { kind: 'tool_calls', calls: [{ id: 'a1', name: 'create_knowledge_entry', args: { name: 'first' } }] },
      { kind: 'message', content: 'first done' },
    ];
    const scriptSecond: MockProviderScript = [
      { kind: 'tool_calls', calls: [{ id: 'b1', name: 'create_knowledge_entry', args: { name: 'second' } }] },
      { kind: 'message', content: 'second done' },
    ];

    const firstPromise = runTurn(
      { projectId: projectAId, message: 'first turn' },
      { provider: createMockAdapter(scriptFirst), toolHandlers, versioning: makeVersioningSpy() }
    );

    // Give the first turn a moment to acquire the lock and start (and
    // block inside) its tool call before starting the second.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(callOrder).toEqual(['first:start']);

    const secondPromise = runTurn(
      { projectId: projectAId, message: 'second turn' },
      {
        provider: createMockAdapter(scriptSecond),
        toolHandlers,
        versioning: makeVersioningSpy(),
        lock: { timeoutMs: 2000, pollIntervalMs: 10 },
      }
    );

    // The second turn should still be waiting on the lock -- its tool
    // call must not have started yet.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(callOrder).toEqual(['first:start']);

    releaseFirst();
    await Promise.all([firstPromise, secondPromise]);

    expect(callOrder).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('a different project turn-start is not blocked by a concurrent same-project turn', async () => {
    let releaseA: () => void = () => {};
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const toolHandlers: Record<string, WorkspaceToolHandler> = {
      create_knowledge_entry: async (args: any) => {
        if (args.name === 'blocking') {
          await gateA;
        }
        return { id: -1, name: args.name };
      },
    };

    const scriptA: MockProviderScript = [
      { kind: 'tool_calls', calls: [{ id: 'a1', name: 'create_knowledge_entry', args: { name: 'blocking' } }] },
      { kind: 'message', content: 'a done' },
    ];
    const scriptB: MockProviderScript = [{ kind: 'message', content: 'b done, unblocked' }];

    const promiseA = runTurn(
      { projectId: projectAId, message: 'project A turn' },
      { provider: createMockAdapter(scriptA), toolHandlers, versioning: makeVersioningSpy() }
    );

    // projectB's turn should complete quickly, without ever waiting on
    // projectA's still-in-flight (gated) turn -- different resourceKey,
    // no contention.
    const resultB = await Promise.race([
      runTurn(
        { projectId: projectBId, message: 'project B turn' },
        { provider: createMockAdapter(scriptB), versioning: makeVersioningSpy() }
      ),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('project B turn was blocked')), 1000)),
    ]);

    expect((resultB as any).finalMessage).toBe('b done, unblocked');

    releaseA();
    await promiseA;
  });
});

// ---------------------------------------------------------------------------
// Stub ImageVisionClient call site (AC8).
// ---------------------------------------------------------------------------

describe('runTurn -- image-generation calls route through the stub ImageVisionClient (AC8)', () => {
  it('dispatches a generate_image tool call to the injected ImageVisionClient, not a real API', async () => {
    const calls: unknown[] = [];
    const stubClient: ImageVisionClient = {
      async generateImage(input) {
        calls.push(input);
        return { imagePath: `projects/${input.projectId}/outputs/test.png` };
      },
    };
    const script: MockProviderScript = [
      { kind: 'tool_calls', calls: [{ id: 'img-1', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: 'a red postcard' } }] },
      { kind: 'message', content: 'Generated the image.' },
    ];

    const result = await runTurn(
      { projectId: projectAId, message: 'Generate an image please.' },
      { provider: createMockAdapter(script), imageVisionClient: stubClient, versioning: makeVersioningSpy() }
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ prompt: 'a red postcard', projectId: projectAId });
    expect(result.toolCalls[0]).toMatchObject({ name: IMAGE_GENERATION_TOOL_NAME });
    expect((result.toolCalls[0].result as any).imagePath).toContain('outputs/test.png');
  });
});

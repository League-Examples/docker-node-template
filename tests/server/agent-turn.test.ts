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
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { prisma } from '../../server/src/services/prisma';
import {
  runTurn,
  chatMessageToProviderMessage,
  TurnLockTimeoutError,
  IMAGE_GENERATION_TOOL_NAME,
  WORKSPACE_TOOL_DEFINITIONS,
  type TurnEvent,
  type TurnVersioningService,
  type WorkspaceToolHandler,
} from '../../server/src/agent/turn';
import { createMockAdapter, type MockProviderScript } from '../../server/src/agent/providers/mock';
import { createKnowledgeEntry, addAssetToCollection, addReference, createIteration } from '../../server/src/agent-mcp/catalogTools';
import { acquireLock, releaseLock } from '../../server/src/agent-mcp/locks';
import { resolveWorkspacePath } from '../../server/src/services/workspaceDirectorySync';
import { createRealImageVisionClient } from '../../server/src/agent/realImageVisionClient';
import type { ImageVisionClient } from '../../server/src/agent/imageVisionStub';
import type { GenerateImageResult as ImagingGenerateImageResult } from '../../server/src/services/imaging';

const marker = `t005turn${Date.now()}`;

let ownerId: number;
let knowledgeDirId: number;
let assetsDirId: number;
let projectAId: number;
let projectBId: number;

const cleanup = {
  knowledgeEntryIds: [] as number[],
  referenceIds: [] as number[],
  assetIds: [] as number[],
  collectionIds: [] as number[],
  iterationIds: [] as number[],
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

  const assetsDir = await prisma.workspaceDirectory.create({
    data: { path: `${marker}/assets`, kind: 'collection' },
  });
  assetsDirId = assetsDir.id;
  cleanup.workspaceDirectoryIds.push(assetsDir.id);

  const projectA = await prisma.project.create({ data: { title: `${marker}-project-a`, ownerUserId: ownerId } });
  projectAId = projectA.id;
  cleanup.projectIds.push(projectAId);

  const projectB = await prisma.project.create({ data: { title: `${marker}-project-b`, ownerUserId: ownerId } });
  projectBId = projectB.id;
  cleanup.projectIds.push(projectBId);
});

afterAll(async () => {
  await prisma.chatMessage.deleteMany({ where: { projectId: { in: cleanup.projectIds } } });
  await prisma.reference.deleteMany({ where: { id: { in: cleanup.referenceIds } } });
  await prisma.iteration.deleteMany({ where: { id: { in: cleanup.iterationIds } } });
  await prisma.asset.deleteMany({ where: { id: { in: cleanup.assetIds } } });
  await prisma.collection.deleteMany({ where: { id: { in: cleanup.collectionIds } } });
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
// Project + active-stream context injection (Sprint 005 OOP change,
// 2026-07-15): the chat box previously "had no sense of what project it's
// in" -- every turn now folds a PROJECT CONTEXT block (title/status/
// detailsHeader, an iterations/references summary, and a plain statement of
// the active FRONT/BACK stream) into the system prompt sent to the model.
// ---------------------------------------------------------------------------

describe('runTurn -- project + active-stream context injection', () => {
  let contextProjectId: number;
  let contextAssetId: number;
  let contextCollectionId: number;
  let contextReferenceId: number;
  const contextIterationIds: number[] = [];

  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        title: `${marker}-context-project`,
        ownerUserId: ownerId,
        status: 'active',
        detailsHeader: { style: 'vintage travel poster', outputType: 'postcard', goal: 'promote the fall festival' },
      },
    });
    contextProjectId = project.id;

    const asset = await addAssetToCollection(
      {
        directoryId: assetsDirId,
        collectionName: `${marker}-context-ref-collection`,
        path: `${marker}/assets/context-ref.png`,
        hash: 'context-ref-hash',
      },
      { versioning: makeVersioningSpy() }
    );
    contextAssetId = asset.id;
    contextCollectionId = asset.collectionId;

    await prisma.assetDescription.create({
      data: {
        assetId: asset.id,
        isPhotograph: false,
        isLogo: false,
        description: 'a hand-drawn autumn leaf motif',
      },
    });

    const reference = await addReference(
      { projectId: contextProjectId, assetId: asset.id, role: 'style' },
      { versioning: makeVersioningSpy() }
    );
    contextReferenceId = reference.id;

    const frontAccepted = await createIteration(
      { projectId: contextProjectId, imagePath: 'front-1.png', promptUsed: 'front concept', role: 'front' },
      { versioning: makeVersioningSpy() }
    );
    contextIterationIds.push(frontAccepted.id);
    await prisma.iteration.update({ where: { id: frontAccepted.id }, data: { accepted: true } });

    const backDraft = await createIteration(
      { projectId: contextProjectId, imagePath: 'back-1.png', promptUsed: 'back concept', role: 'back' },
      { versioning: makeVersioningSpy() }
    );
    contextIterationIds.push(backDraft.id);
  });

  afterAll(async () => {
    await prisma.chatMessage.deleteMany({ where: { projectId: contextProjectId } });
    await prisma.reference.deleteMany({ where: { id: contextReferenceId } });
    await prisma.iteration.deleteMany({ where: { id: { in: contextIterationIds } } });
    await prisma.assetDescription.deleteMany({ where: { assetId: contextAssetId } });
    await prisma.asset.deleteMany({ where: { id: contextAssetId } });
    await prisma.collection.deleteMany({ where: { id: contextCollectionId } });
    await prisma.project.deleteMany({ where: { id: contextProjectId } });
  });

  async function captureSystemPrompt(activeFace?: 'front' | 'back'): Promise<string> {
    let capturedSystemPrompt = '';
    const adapter = createMockAdapter([{ kind: 'message', content: 'Sure thing.' }], {
      onSendTurn: (input) => {
        capturedSystemPrompt = input.systemPrompt;
      },
    });
    await runTurn(
      { projectId: contextProjectId, message: 'What have we got so far?', activeFace },
      { provider: adapter, versioning: makeVersioningSpy() }
    );
    return capturedSystemPrompt;
  }

  it('includes the project title, status, and creative-brief detailsHeader fields', async () => {
    const systemPrompt = await captureSystemPrompt('front');

    expect(systemPrompt).toContain('PROJECT CONTEXT:');
    expect(systemPrompt).toContain(`${marker}-context-project`);
    expect(systemPrompt).toContain('status: active');
    expect(systemPrompt).toContain('vintage travel poster');
    expect(systemPrompt).toContain('postcard');
    expect(systemPrompt).toContain('promote the fall festival');
  });

  it('includes an iterations summary (per-stream counts and the accepted front iteration) and the attached reference', async () => {
    const systemPrompt = await captureSystemPrompt('front');

    expect(systemPrompt).toContain('front: 1');
    expect(systemPrompt).toContain('back: 1');
    expect(systemPrompt).toContain('accepted: #1');
    expect(systemPrompt).toContain('style: a hand-drawn autumn leaf motif');
  });

  it('states the active stream as FRONT when activeFace is "front"', async () => {
    const systemPrompt = await captureSystemPrompt('front');

    expect(systemPrompt).toContain('working on the FRONT of this postcard');
    expect(systemPrompt).not.toContain('working on the BACK of this postcard');
  });

  it('states the active stream as BACK when activeFace is "back"', async () => {
    const systemPrompt = await captureSystemPrompt('back');

    expect(systemPrompt).toContain('working on the BACK of this postcard');
    expect(systemPrompt).not.toContain('working on the FRONT of this postcard');
  });

  it('defaults the active stream to FRONT when activeFace is omitted ("a new project starts on Front")', async () => {
    const systemPrompt = await captureSystemPrompt(undefined);

    expect(systemPrompt).toContain('working on the FRONT of this postcard');
  });
});

// ---------------------------------------------------------------------------
// "New project" modal description (OOP follow-up, 2026-07-16): the
// description collected by ProjectList.tsx's create-project modal is
// persisted onto Project.detailsHeader's `description` key, same as any
// other detailsHeader field -- formatDetailsHeader is key-agnostic, so it
// should surface here with no dedicated code path.
// ---------------------------------------------------------------------------

describe('runTurn -- "New project" modal description surfaces in the creative brief (OOP follow-up, 2026-07-16)', () => {
  let descriptionProjectId: number;

  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        title: `${marker}-description-project`,
        ownerUserId: ownerId,
        status: 'active',
        detailsHeader: { description: 'A postcard announcing the spring open house.' },
      },
    });
    descriptionProjectId = project.id;
  });

  afterAll(async () => {
    await prisma.chatMessage.deleteMany({ where: { projectId: descriptionProjectId } });
    await prisma.project.deleteMany({ where: { id: descriptionProjectId } });
  });

  it('includes the description in the PROJECT CONTEXT creative brief', async () => {
    let capturedSystemPrompt = '';
    const adapter = createMockAdapter([{ kind: 'message', content: 'Sure thing.' }], {
      onSendTurn: (input) => {
        capturedSystemPrompt = input.systemPrompt;
      },
    });
    await runTurn(
      { projectId: descriptionProjectId, message: 'What are we making?' },
      { provider: adapter, versioning: makeVersioningSpy() }
    );

    expect(capturedSystemPrompt).toContain('Creative brief:');
    expect(capturedSystemPrompt).toContain('description: A postcard announcing the spring open house.');
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

  // Sprint 005 OOP change, 2026-07-15: "new iterations join the
  // currently-active tab's stream" -- `RunTurnInput.activeFace` is threaded
  // straight through to every `generate_image` dispatch, never surfaced to
  // the provider/model itself (it's not part of `args`).
  it("threads RunTurnInput.activeFace through to the ImageVisionClient's generateImage call", async () => {
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

    await runTurn(
      { projectId: projectAId, message: 'Generate an image please.', activeFace: 'back' },
      { provider: createMockAdapter(script), imageVisionClient: stubClient, versioning: makeVersioningSpy() }
    );

    expect(calls[0]).toMatchObject({ activeFace: 'back' });
  });

  it('defaults activeFace to "front" when RunTurnInput omits it (older client, or "a new project starts on Front")', async () => {
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

    await runTurn(
      { projectId: projectAId, message: 'Generate an image please.' },
      { provider: createMockAdapter(script), imageVisionClient: stubClient, versioning: makeVersioningSpy() }
    );

    expect(calls[0]).toMatchObject({ activeFace: 'front' });
  });
});

// ---------------------------------------------------------------------------
// generate_image tool definition + real ImageVisionClient wiring (ticket
// 004-002, completes image-generation-service.md).
// ---------------------------------------------------------------------------

describe('WORKSPACE_TOOL_DEFINITIONS -- generate_image (AC1)', () => {
  it('advertises a generate_image tool definition matching IMAGE_GENERATION_TOOL_NAME', () => {
    const def = WORKSPACE_TOOL_DEFINITIONS.find((d) => d.name === IMAGE_GENERATION_TOOL_NAME);
    expect(def).toBeDefined();
    expect(def!.inputSchema).toMatchObject({ type: 'object', required: ['prompt'] });
    expect((def!.inputSchema as any).properties.prompt).toBeDefined();
  });
});

describe('runTurn -- generate_image routes through the real ImageVisionClient end-to-end (SUC-003 pattern, AC3)', () => {
  let testRoot: string;
  let previousWorkspaceDir: string | undefined;

  beforeAll(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'flyerbot-agent-turn-real-image-vision-test-'));
    previousWorkspaceDir = process.env.WORKSPACE_DIR;
    process.env.WORKSPACE_DIR = testRoot;
    await fs.mkdir(resolveWorkspacePath(`projects/${projectAId}`), { recursive: true });
  });

  afterAll(async () => {
    if (previousWorkspaceDir === undefined) {
      delete process.env.WORKSPACE_DIR;
    } else {
      process.env.WORKSPACE_DIR = previousWorkspaceDir;
    }
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  afterEach(async () => {
    await prisma.iteration.deleteMany({ where: { projectId: projectAId } });
  });

  function fixtureImage(bytes: string): ImagingGenerateImageResult {
    return { bytes: Buffer.from(bytes), model: 'gpt-image-2', size: '1024x1024', quality: 'high' };
  }

  it('a generate_image tool call produces one new Iteration row with a real file containing the fixture bytes', async () => {
    const generateImage = () => Promise.resolve(fixtureImage('real-client-fixture-bytes'));
    const realClient = createRealImageVisionClient({ generateImage, versioning: makeVersioningSpy() });

    const script: MockProviderScript = [
      {
        kind: 'tool_calls',
        calls: [{ id: 'img-1', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: 'a postcard mascot' } }],
      },
      { kind: 'message', content: 'Generated the image.' },
    ];

    const result = await runTurn(
      { projectId: projectAId, message: 'Please generate an image.' },
      { provider: createMockAdapter(script), imageVisionClient: realClient, versioning: makeVersioningSpy() }
    );

    const toolResult = result.toolCalls[0].result as { imagePath: string };
    expect(toolResult.imagePath).toBe(`projects/${projectAId}/iterations/iter-1.png`);

    const iterations = await prisma.iteration.findMany({ where: { projectId: projectAId } });
    expect(iterations).toHaveLength(1);
    expect(iterations[0]).toMatchObject({ seq: 1, imagePath: toolResult.imagePath, promptUsed: 'a postcard mascot' });
    // Defaults to the 'front' stream when RunTurnInput.activeFace is
    // omitted (Sprint 005 OOP change, 2026-07-15).
    expect(iterations[0].role).toBe('front');

    const written = await fs.readFile(resolveWorkspacePath(toolResult.imagePath));
    expect(written.equals(Buffer.from('real-client-fixture-bytes'))).toBe(true);
  });

  it("tags the new Iteration into RunTurnInput.activeFace's stream (Sprint 005 OOP change, 2026-07-15)", async () => {
    const generateImage = () => Promise.resolve(fixtureImage('back-stream-fixture-bytes'));
    const realClient = createRealImageVisionClient({ generateImage, versioning: makeVersioningSpy() });

    const script: MockProviderScript = [
      { kind: 'tool_calls', calls: [{ id: 'img-2', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: 'a postcard back' } }] },
      { kind: 'message', content: 'Generated the back.' },
    ];

    await runTurn(
      { projectId: projectAId, message: 'Please generate the back.', activeFace: 'back' },
      { provider: createMockAdapter(script), imageVisionClient: realClient, versioning: makeVersioningSpy() }
    );

    const iterations = await prisma.iteration.findMany({ where: { projectId: projectAId } });
    expect(iterations).toHaveLength(1);
    expect(iterations[0].role).toBe('back');
  });

  it('a simulated imaging failure surfaces as a tool-call error result and adds no new Iteration row (AC5, UC-006 E1)', async () => {
    const generateImage = () => Promise.reject(new Error('simulated OpenAI failure'));
    const realClient = createRealImageVisionClient({ generateImage, versioning: makeVersioningSpy() });

    const script: MockProviderScript = [
      {
        kind: 'tool_calls',
        calls: [{ id: 'img-err-1', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: 'this will fail' } }],
      },
      { kind: 'message', content: 'Something went wrong generating the image.' },
    ];
    const events: TurnEvent[] = [];

    const result = await runTurn(
      { projectId: projectAId, message: 'Please generate an image.' },
      {
        provider: createMockAdapter(script),
        imageVisionClient: realClient,
        versioning: makeVersioningSpy(),
        onEvent: (event) => events.push(event),
      }
    );

    expect(result.toolCalls[0]).toMatchObject({ name: IMAGE_GENERATION_TOOL_NAME });
    expect((result.toolCalls[0].result as any).error).toContain('simulated OpenAI failure');
    expect(
      events.some(
        (e) => e.type === 'tool_call_finished' && e.name === IMAGE_GENERATION_TOOL_NAME && e.isError === true
      )
    ).toBe(true);

    const iterations = await prisma.iteration.findMany({ where: { projectId: projectAId } });
    expect(iterations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Ticket 005-002: add_reference/remove_reference/set_iteration_state/
// search_catalog reachable through the same scripted-turn dispatch table
// (Sprint 003's SUC-003 pattern) that already proves out create_knowledge_entry
// above -- one scripted runTurn call per tool, per the ticket's Testing Plan.
// ---------------------------------------------------------------------------

describe('runTurn -- ticket 005-002 tools dispatch through the mock adapter', () => {
  it('dispatches an add_reference tool call, creating a Reference row', async () => {
    const asset = await addAssetToCollection(
      { directoryId: assetsDirId, collectionName: `${marker}-turn-ref-collection`, path: `${marker}/assets/turn-ref.png`, hash: 'turn-ref-hash' },
      { versioning: makeVersioningSpy() }
    );
    cleanup.assetIds.push(asset.id);
    cleanup.collectionIds.push(asset.collectionId);

    const toolCallArgs = { projectId: projectAId, assetId: asset.id, role: 'style' };
    const script: MockProviderScript = [
      { kind: 'tool_calls', calls: [{ id: 'ref-1', name: 'add_reference', args: toolCallArgs }] },
      { kind: 'message', content: 'Added the reference.' },
    ];

    const result = await runTurn(
      { projectId: projectAId, message: 'Add this asset as a style reference.' },
      { provider: createMockAdapter(script), versioning: makeVersioningSpy() }
    );

    expect(result.toolCalls[0]).toMatchObject({ name: 'add_reference', args: toolCallArgs });
    const referenceId = (result.toolCalls[0].result as any).id;
    cleanup.referenceIds.push(referenceId);

    const dbReference = await prisma.reference.findUnique({ where: { id: referenceId } });
    expect(dbReference).toMatchObject({ projectId: projectAId, assetId: asset.id, role: 'style' });
  });

  it('dispatches a remove_reference tool call, deleting the targeted Reference row', async () => {
    const asset = await addAssetToCollection(
      { directoryId: assetsDirId, collectionName: `${marker}-turn-remove-ref-collection`, path: `${marker}/assets/turn-remove-ref.png`, hash: 'turn-remove-ref-hash' },
      { versioning: makeVersioningSpy() }
    );
    cleanup.assetIds.push(asset.id);
    cleanup.collectionIds.push(asset.collectionId);

    const reference = await addReference(
      { projectId: projectAId, assetId: asset.id, role: 'composition' },
      { versioning: makeVersioningSpy() }
    );

    const script: MockProviderScript = [
      { kind: 'tool_calls', calls: [{ id: 'ref-2', name: 'remove_reference', args: { referenceId: reference.id } }] },
      { kind: 'message', content: 'Removed the reference.' },
    ];

    const result = await runTurn(
      { projectId: projectAId, message: 'Remove that reference.' },
      { provider: createMockAdapter(script), versioning: makeVersioningSpy() }
    );

    expect(result.toolCalls[0]).toMatchObject({ name: 'remove_reference', args: { referenceId: reference.id } });
    expect((result.toolCalls[0].result as any).deleted).toBe(true);

    const dbReference = await prisma.reference.findUnique({ where: { id: reference.id } });
    expect(dbReference).toBeNull();
  });

  it('dispatches a set_iteration_state tool call, updating Iteration.accepted', async () => {
    const iteration = await createIteration(
      { projectId: projectAId, imagePath: 'turn-state.png', promptUsed: 'p' },
      { versioning: makeVersioningSpy() }
    );
    cleanup.iterationIds.push(iteration.id);

    const toolCallArgs = { iterationId: iteration.id, accepted: true };
    const script: MockProviderScript = [
      { kind: 'tool_calls', calls: [{ id: 'state-1', name: 'set_iteration_state', args: toolCallArgs }] },
      { kind: 'message', content: 'Marked as accepted.' },
    ];

    const result = await runTurn(
      { projectId: projectAId, message: 'Accept this iteration.' },
      { provider: createMockAdapter(script), versioning: makeVersioningSpy() }
    );

    expect(result.toolCalls[0]).toMatchObject({ name: 'set_iteration_state', args: toolCallArgs });
    expect((result.toolCalls[0].result as any).accepted).toBe(true);

    const dbIteration = await prisma.iteration.findUnique({ where: { id: iteration.id } });
    expect(dbIteration!.accepted).toBe(true);
  });

  it('dispatches a search_catalog tool call, returning a well-formed (possibly empty) match array with zero network calls', async () => {
    const toolCallArgs = { query: `turnsearch${marker.replace(/[^a-zA-Z0-9]/g, '')}`, k: 5 };
    const script: MockProviderScript = [
      { kind: 'tool_calls', calls: [{ id: 'search-1', name: 'search_catalog', args: toolCallArgs }] },
      { kind: 'message', content: 'Here is what I found.' },
    ];

    const result = await runTurn(
      { projectId: projectAId, message: 'Search the catalog for that term.' },
      { provider: createMockAdapter(script), versioning: makeVersioningSpy() }
    );

    expect(result.toolCalls[0]).toMatchObject({ name: 'search_catalog', args: toolCallArgs });
    expect(Array.isArray(result.toolCalls[0].result)).toBe(true);
  });
});

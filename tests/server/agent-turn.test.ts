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
  chatMessageToProviderMessages,
  TurnLockTimeoutError,
  IMAGE_GENERATION_TOOL_NAME,
  WORKSPACE_TOOL_DEFINITIONS,
  type TurnEvent,
  type TurnVersioningService,
  type WorkspaceToolHandler,
} from '../../server/src/agent/turn';
import { createMockAdapter, type MockProviderScript } from '../../server/src/agent/providers/mock';
import {
  createKnowledgeEntry,
  addAssetToCollection,
  addReference,
  createIteration,
  createProject,
} from '../../server/src/agent-mcp/catalogTools';
import { acquireLock, releaseLock } from '../../server/src/agent-mcp/locks';
import { resolveWorkspacePath } from '../../server/src/services/workspaceDirectorySync';
import { createRealImageVisionClient } from '../../server/src/agent/realImageVisionClient';
import type { ImageVisionClient } from '../../server/src/agent/imageVisionStub';
import type { GenerateImageResult as ImagingGenerateImageResult } from '../../server/src/services/imaging';
import type { ChatMessageModel } from '../../server/src/generated/prisma/models/ChatMessage';

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

  // Sprint 010 ticket 001: the summary changed from counts-plus-accepted-
  // seq-only to a per-stream iteration-number listing (each seq, with the
  // accepted one and the most-recent one marked) -- see the dedicated
  // "PROJECT CONTEXT iteration listing" describe block below for fuller
  // coverage of the new rendering across several iterations per stream.
  it('includes a per-stream iteration-number listing (marking accepted + most recent) and the attached reference', async () => {
    const systemPrompt = await captureSystemPrompt('front');

    // Iteration.seq increments per-project across every stream (not
    // independently per role) -- frontAccepted was created first (seq 1),
    // backDraft second (seq 2).
    expect(systemPrompt).toContain('front: #1: "front concept" (accepted, most recent) -- 1 iteration');
    expect(systemPrompt).toContain('back: #2 (most recent) -- 1 iteration');
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

    const expectedHistory = rows.slice(0, 2).flatMap(chatMessageToProviderMessages);
    expect(capturedMessages.slice(0, 2)).toEqual(expectedHistory);
    expect(capturedMessages[2]).toEqual({ role: 'user', content: 'Second message, continuing the conversation.' });
  });
});

// ---------------------------------------------------------------------------
// Regression test (sprint 011 ticket 002, issue
// tool-call-history-prose-causes-hallucinated-calls.md): reproduces the live
// project-14 incident's failure shape -- several (4+) prior persisted
// tool-call rounds already accumulated in a project's history -- and proves
// ticket 001's structured-replay fix against it. History is seeded directly
// via this file's Prisma client (same pattern as the D8 block above),
// mirroring the exact three-row-per-turn shape a completed `runTurn` call
// itself persists: a user request row, an assistant tool-round row
// (`content: ''`, `toolCalls` populated) and an assistant final-message row.
// One seeded round carries two calls, exercising ticket 001's
// multi-call-per-round id scheme, not just the single-call case.
// ---------------------------------------------------------------------------

describe('runTurn -- structured tool-call history replay (issue: tool-call-history-prose-causes-hallucinated-calls)', () => {
  let historyProjectId: number;

  async function seedToolRound(
    userText: string,
    calls: Array<{ name: string; args: unknown; result: unknown }>,
    finalText: string
  ): Promise<void> {
    await prisma.chatMessage.create({ data: { projectId: historyProjectId, role: 'user', content: userText } });
    await prisma.chatMessage.create({
      data: { projectId: historyProjectId, role: 'assistant', content: '', toolCalls: calls as any },
    });
    await prisma.chatMessage.create({ data: { projectId: historyProjectId, role: 'assistant', content: finalText } });
  }

  beforeAll(async () => {
    const project = await prisma.project.create({
      data: { title: `${marker}-history-replay-project`, ownerUserId: ownerId },
    });
    historyProjectId = project.id;

    await seedToolRound(
      'Make a red postcard front.',
      [{ name: 'generate_image', args: { prompt: 'a red postcard front' }, result: { imagePath: 'iterations/iter-1.png' } }],
      'Generated the first draft.'
    );
    await seedToolRound(
      'Make it a bit brighter.',
      [{ name: 'generate_image', args: { prompt: 'brighter red postcard front' }, result: { imagePath: 'iterations/iter-2.png' } }],
      'Brightened the design.'
    );
    // Round 3: a multi-call round -- two generate_image calls persisted in
    // one row, exactly ticket 001's multi-call-per-row id scheme.
    await seedToolRound(
      'Add a matching back design and a border on the front.',
      [
        { name: 'generate_image', args: { prompt: 'a matching postcard back' }, result: { imagePath: 'iterations/iter-3.png' } },
        { name: 'generate_image', args: { prompt: 'add a border to the front' }, result: { imagePath: 'iterations/iter-4.png' } },
      ],
      'Added the back design and the border.'
    );
    await seedToolRound(
      'Try a blue color scheme instead.',
      [{ name: 'generate_image', args: { prompt: 'blue color scheme' }, result: { imagePath: 'iterations/iter-5.png' } }],
      'Switched to a blue color scheme.'
    );
  });

  afterAll(async () => {
    await prisma.chatMessage.deleteMany({ where: { projectId: historyProjectId } });
    await prisma.project.deleteMany({ where: { id: historyProjectId } });
  });

  it('replays 4+ accumulated tool-call rounds (one multi-call) as structured toolCalls/toolResults, strictly alternating, and dispatches a real generate_image call for the new turn', async () => {
    // Each `onSendTurn` invocation gets its own shallow copy of
    // `input.messages` -- the turn controller keeps mutating (pushing to)
    // the *same* array object across the loop's later `sendTurn` calls, so
    // capturing the bare reference would let a later push silently rewrite
    // what an earlier "captured" batch looks like once inspected after the
    // fact. Copying at call time freezes each batch as it truly was sent.
    const capturedMessageBatches: unknown[][] = [];
    const dispatchedCalls: unknown[] = [];
    const stubClient: ImageVisionClient = {
      async generateImage(input) {
        dispatchedCalls.push(input);
        return { imagePath: `projects/${input.projectId}/outputs/history-replay-test.png` };
      },
    };

    const script: MockProviderScript = [
      {
        kind: 'tool_calls',
        calls: [{ id: 'live-1', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: 'one more edit, in a green color scheme' } }],
      },
      { kind: 'message', content: 'Switched to a green color scheme.' },
    ];
    const adapter = createMockAdapter(script, {
      onSendTurn: (input) => {
        capturedMessageBatches.push([...input.messages]);
      },
    });

    await runTurn(
      { projectId: historyProjectId, message: 'Actually, make it green.' },
      { provider: adapter, imageVisionClient: stubClient, versioning: makeVersioningSpy() }
    );

    // (4) The turn dispatches the scripted real generate_image call --
    // not a narrated imitation.
    expect(dispatchedCalls).toHaveLength(1);

    // The FIRST sendTurn call is exactly what the model is shown as
    // "history" for this new request: the 4 seeded rounds' replayed
    // messages plus this turn's own new user message -- none of this
    // turn's own (not-yet-dispatched) tool round is in it yet.
    const messages = capturedMessageBatches[0] as any[];

    // (1) Every historical tool round appears as an assistant toolCalls
    // message immediately followed by a user toolResults message -- never
    // as a single message whose content contains the fabricated "Called
    // tool" prose string from the pre-fix code.
    const toolCallMessages = messages.filter((m) => m.toolCalls);
    expect(toolCallMessages).toHaveLength(4); // one per seeded round
    for (const m of messages) {
      expect(m.content ?? '').not.toContain('Called tool');
    }

    // (2) Ids pair correctly within each historical round: the
    // toolCallId on each toolResults entry matches an id in the
    // immediately preceding toolCalls entry.
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].toolCalls) {
        const toolCallsMessage = messages[i];
        const toolResultsMessage = messages[i + 1];
        expect(toolResultsMessage).toBeDefined();
        expect(toolResultsMessage.role).toBe('user');
        expect(toolResultsMessage.toolResults).toBeDefined();
        const callIds = toolCallsMessage.toolCalls.map((c: any) => c.id);
        const resultIds = toolResultsMessage.toolResults.map((r: any) => r.toolCallId);
        expect(resultIds).toEqual(callIds);
      }
    }

    // The multi-call round (round 3) reconstructed with 2 calls in one
    // message, ids unique within the round.
    const multiCallMessage = toolCallMessages.find((m) => m.toolCalls.length === 2);
    expect(multiCallMessage).toBeDefined();
    const multiCallIds = multiCallMessage!.toolCalls.map((c: any) => c.id);
    expect(new Set(multiCallIds).size).toBe(2);

    // (3) Roles strictly alternate user/assistant across the entire
    // captured messages array, including across the seeded historical
    // rounds and into this new turn's own user message -- no two
    // consecutive entries share a role, asserted programmatically over
    // the whole array (not spot-checked).
    for (let i = 1; i < messages.length; i++) {
      expect(messages[i].role).not.toBe(messages[i - 1].role);
    }
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'Actually, make it green.' });

    // (4, continued) The resulting persisted ChatMessage row for the new
    // round has a populated toolCalls field containing the real
    // dispatched call/result.
    const rows = await prisma.chatMessage.findMany({ where: { projectId: historyProjectId }, orderBy: { id: 'asc' } });
    expect(rows).toHaveLength(15); // 4 seeded rounds x 3 rows + this turn's [user, tool-round, final]
    const newToolRoundRow = rows.find(
      (r) =>
        r.role === 'assistant' &&
        r.toolCalls !== null &&
        (r.toolCalls as any[])[0]?.args?.prompt === 'one more edit, in a green color scheme'
    );
    expect(newToolRoundRow).toBeDefined();
    expect((newToolRoundRow!.toolCalls as any[])[0]).toMatchObject({
      name: IMAGE_GENERATION_TOOL_NAME,
      result: { imagePath: expect.stringContaining('history-replay-test.png') },
    });

    // (5) Direct negative-control assertion, kept explicit rather than
    // only implied by the positive structured-shape checks above: no
    // ChatMessage.content anywhere in the project's history -- seeded or
    // newly created -- contains the fabricated "Called tool" narration
    // string after the turn completes.
    for (const row of rows) {
      expect(row.content).not.toContain('Called tool');
    }
  });
});

// ---------------------------------------------------------------------------
// chatMessageToProviderMessages -- structured tool-round reconstruction
// (sprint 011 ticket 001, tool-call-history-prose-causes-hallucinated-
// calls.md). Unit-level shape assertions directly on the function, using
// plain constructed rows -- no DB/runTurn involvement needed here. The
// end-to-end regression (seeded history replayed through a mock adapter)
// is ticket 002's scope.
// ---------------------------------------------------------------------------

describe('chatMessageToProviderMessages -- structured tool-round reconstruction (011-001)', () => {
  function makeRow(overrides: Partial<ChatMessageModel>): ChatMessageModel {
    return {
      id: 1,
      projectId: 1,
      role: 'assistant',
      content: '',
      toolCalls: null,
      createdAt: new Date(),
      ...overrides,
    } as ChatMessageModel;
  }

  it('reconstructs a single-call tool-round row to exactly two messages (assistant toolCalls, user toolResults) with matching ids', () => {
    const row = makeRow({
      id: 42,
      role: 'assistant',
      content: '',
      toolCalls: [{ name: 'create_knowledge_entry', args: { name: 'palette' }, result: { id: 7 } }] as any,
    });

    const messages = chatMessageToProviderMessages(row);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      role: 'assistant',
      content: undefined,
      toolCalls: [{ id: 'hist-42-0', name: 'create_knowledge_entry', args: { name: 'palette' } }],
    });
    expect(messages[1]).toEqual({
      role: 'user',
      toolResults: [{ toolCallId: 'hist-42-0', result: { id: 7 } }],
    });
  });

  it('reconstructs a multi-call tool-round row to one assistant message carrying all calls and one user message carrying all matching results, no id reused', () => {
    const row = makeRow({
      id: 99,
      role: 'assistant',
      content: '',
      toolCalls: [
        { name: 'generate_image', args: { prompt: 'a red postcard' }, result: { imagePath: 'iter-1.png' } },
        { name: 'generate_image', args: { prompt: 'a blue postcard' }, result: { imagePath: 'iter-2.png' } },
      ] as any,
    });

    const messages = chatMessageToProviderMessages(row);

    expect(messages).toHaveLength(2);
    const assistantMessage = messages[0];
    const userMessage = messages[1];
    expect(assistantMessage.toolCalls).toHaveLength(2);
    expect(assistantMessage.toolCalls).toEqual([
      { id: 'hist-99-0', name: 'generate_image', args: { prompt: 'a red postcard' } },
      { id: 'hist-99-1', name: 'generate_image', args: { prompt: 'a blue postcard' } },
    ]);
    expect(userMessage.toolResults).toEqual([
      { toolCallId: 'hist-99-0', result: { imagePath: 'iter-1.png' } },
      { toolCallId: 'hist-99-1', result: { imagePath: 'iter-2.png' } },
    ]);
    const ids = assistantMessage.toolCalls!.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('carries a tool-round row\'s non-empty content as the leading assistant message\'s content alongside its toolCalls', () => {
    const row = makeRow({
      id: 7,
      role: 'assistant',
      content: 'Here is what I did:',
      toolCalls: [{ name: 'create_iteration', args: {}, result: { ok: true } }] as any,
    });

    const messages = chatMessageToProviderMessages(row);

    expect(messages[0]).toMatchObject({ role: 'assistant', content: 'Here is what I did:' });
    expect(messages[0].toolCalls).toHaveLength(1);
  });

  it('reconstructs two consecutive tool-round rows to a strictly alternating assistant/user/assistant/user sequence, no back-to-back assistant messages, with ids unique across both rows', () => {
    const rowOne = makeRow({
      id: 10,
      role: 'assistant',
      content: '',
      toolCalls: [{ name: 'create_iteration', args: { seq: 1 }, result: { ok: true } }] as any,
    });
    const rowTwo = makeRow({
      id: 11,
      role: 'assistant',
      content: '',
      toolCalls: [{ name: 'create_iteration', args: { seq: 2 }, result: { ok: true } }] as any,
    });

    const messages = [rowOne, rowTwo].flatMap(chatMessageToProviderMessages);

    expect(messages).toHaveLength(4);
    expect(messages.map((m) => m.role)).toEqual(['assistant', 'user', 'assistant', 'user']);

    const allToolCallIds = messages.flatMap((m) => m.toolCalls?.map((c) => c.id) ?? []);
    expect(allToolCallIds).toEqual(['hist-10-0', 'hist-11-0']);
    expect(new Set(allToolCallIds).size).toBe(allToolCallIds.length);
  });

  it('maps a plain content-only row to a single unchanged message (regression guard)', () => {
    const row = makeRow({ id: 5, role: 'user', content: 'Just a plain message.', toolCalls: null });

    const messages = chatMessageToProviderMessages(row);

    expect(messages).toEqual([{ role: 'user', content: 'Just a plain message.' }]);
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

  // Sprint 010 ticket 001: the vestigial top-level referenceImages
  // property (never forwarded by dispatchToolCall, its own description
  // already told the model not to use it) is gone; editSourceIteration
  // (a number, or the literal "last") replaces it as the model's only
  // sanctioned way to reference a prior iteration.
  it('no longer advertises a top-level referenceImages property, and advertises editSourceIteration instead', () => {
    const def = WORKSPACE_TOOL_DEFINITIONS.find((d) => d.name === IMAGE_GENERATION_TOOL_NAME);
    const properties = (def!.inputSchema as any).properties;

    expect(properties).not.toHaveProperty('referenceImages');
    expect(properties).toHaveProperty('editSourceIteration');
    expect(properties.editSourceIteration.description).toEqual(expect.any(String));
    expect(properties.editSourceIteration.description.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Sprint 010 ticket 001: PROJECT CONTEXT's iteration listing (replaces the
// former counts-plus-accepted-seq-only summary) -- lists each stream's
// iteration numbers, marking the accepted one and the most-recent (highest
// seq) one, and never renders a raw imagePath into the prompt.
// ---------------------------------------------------------------------------

describe('runTurn -- PROJECT CONTEXT iteration listing (sprint 010 ticket 001)', () => {
  let listingProjectId: number;
  const listingIterationIds: number[] = [];

  beforeAll(async () => {
    const project = await prisma.project.create({
      data: { title: `${marker}-iteration-listing-project`, ownerUserId: ownerId, status: 'active' },
    });
    listingProjectId = project.id;

    // front: #1 (not accepted), #2 (accepted, but not the highest seq),
    // #3 (highest seq -- "most recent", not accepted).
    const front1 = await createIteration(
      { projectId: listingProjectId, imagePath: `${marker}/iterations/front-1.png`, promptUsed: 'front v1', role: 'front' },
      { versioning: makeVersioningSpy() }
    );
    listingIterationIds.push(front1.id);

    const front2 = await createIteration(
      { projectId: listingProjectId, imagePath: `${marker}/iterations/front-2.png`, promptUsed: 'front v2', role: 'front' },
      { versioning: makeVersioningSpy() }
    );
    listingIterationIds.push(front2.id);
    await prisma.iteration.update({ where: { id: front2.id }, data: { accepted: true } });

    const front3 = await createIteration(
      { projectId: listingProjectId, imagePath: `${marker}/iterations/front-3.png`, promptUsed: 'front v3', role: 'front' },
      { versioning: makeVersioningSpy() }
    );
    listingIterationIds.push(front3.id);

    // back: a single, non-accepted iteration.
    const back1 = await createIteration(
      { projectId: listingProjectId, imagePath: `${marker}/iterations/back-1.png`, promptUsed: 'back v1', role: 'back' },
      { versioning: makeVersioningSpy() }
    );
    listingIterationIds.push(back1.id);
  });

  afterAll(async () => {
    await prisma.chatMessage.deleteMany({ where: { projectId: listingProjectId } });
    await prisma.iteration.deleteMany({ where: { id: { in: listingIterationIds } } });
    await prisma.project.deleteMany({ where: { id: listingProjectId } });
  });

  it('lists each seq per stream, marking the accepted one and the most-recent (highest-seq) one, with no raw imagePath in the text', async () => {
    let capturedSystemPrompt = '';
    const adapter = createMockAdapter([{ kind: 'message', content: 'Sure thing.' }], {
      onSendTurn: (input) => {
        capturedSystemPrompt = input.systemPrompt;
      },
    });

    await runTurn(
      { projectId: listingProjectId, message: 'What have we got so far?', activeFace: 'front' },
      { provider: adapter, versioning: makeVersioningSpy() }
    );

    // Iteration.seq increments per-project across every stream (not
    // independently per role) -- the three front iterations take seq 1-3,
    // so the single back iteration created afterward is seq 4.
    expect(capturedSystemPrompt).toContain(
      'front: #1: "front v1", #2: "front v2" (accepted), #3: "front v3" (most recent) -- 3 iterations'
    );
    expect(capturedSystemPrompt).toContain('back: #4 (most recent) -- 1 iteration');

    // No raw imagePath-shaped string ever reaches the rendered prompt --
    // only seq numbers, role, and accepted (sprint 010 Design Rationale).
    expect(capturedSystemPrompt).not.toContain('iterations/');
    expect(capturedSystemPrompt).not.toContain('.png');
  });

  // Sprint 012 ticket 001 (agent-iteration-number-grounding.md): ties a
  // specific seq's rendered active-stream hint directly to that seq's
  // stored promptUsed, so "iteration 2" maps to seq 2's actual recorded
  // prompt, not an invented description.
  it('ties "iteration N" to seq N: a specific seq\'s rendered active-stream hint contains that seq\'s stored promptUsed text (sprint 012 ticket 001)', async () => {
    let capturedSystemPrompt = '';
    const adapter = createMockAdapter([{ kind: 'message', content: 'Sure thing.' }], {
      onSendTurn: (input) => {
        capturedSystemPrompt = input.systemPrompt;
      },
    });

    await runTurn(
      { projectId: listingProjectId, message: 'What is in iteration 2?', activeFace: 'front' },
      { provider: adapter, versioning: makeVersioningSpy() }
    );

    // front2 (seq 2) was created with promptUsed: 'front v2' -- seq 2's
    // rendered hint must contain that exact text.
    expect(capturedSystemPrompt).toContain('#2: "front v2"');
  });
});

// ---------------------------------------------------------------------------
// Sprint 010 ticket 001: dispatch-time editSourceIteration resolution
// (image-edits-must-pass-source-image.md) -- the turn controller resolves
// the model's editSourceIteration signal to a validated, workspace-rooted
// reference-image path passed as modelParams.referenceImages, and discards
// any raw referenceImages the model supplied directly.
// ---------------------------------------------------------------------------

describe('runTurn -- editSourceIteration resolves to a validated reference-image path (sprint 010 ticket 001)', () => {
  let editProjectId: number;
  const editIterationIds: number[] = [];
  let frontSeq2Id: number; // accepted, but not the highest seq on front
  let frontSeq4Id: number; // highest seq on front -- the "last" pick
  let backSeq3Id: number; // interleaved on the other stream, higher raw seq than front's accepted one

  beforeAll(async () => {
    const project = await prisma.project.create({
      data: { title: `${marker}-edit-source-project`, ownerUserId: ownerId },
    });
    editProjectId = project.id;

    const front1 = await createIteration(
      { projectId: editProjectId, imagePath: `projects/${editProjectId}/iterations/iter-1.png`, promptUsed: 'front v1', role: 'front' },
      { versioning: makeVersioningSpy() }
    );
    editIterationIds.push(front1.id);

    const front2 = await createIteration(
      { projectId: editProjectId, imagePath: `projects/${editProjectId}/iterations/iter-2.png`, promptUsed: 'front v2', role: 'front' },
      { versioning: makeVersioningSpy() }
    );
    frontSeq2Id = front2.id;
    editIterationIds.push(front2.id);
    await prisma.iteration.update({ where: { id: front2.id }, data: { accepted: true } });

    const back3 = await createIteration(
      { projectId: editProjectId, imagePath: `projects/${editProjectId}/iterations/iter-3.png`, promptUsed: 'back v1', role: 'back' },
      { versioning: makeVersioningSpy() }
    );
    backSeq3Id = back3.id;
    editIterationIds.push(back3.id);

    const front4 = await createIteration(
      { projectId: editProjectId, imagePath: `projects/${editProjectId}/iterations/iter-4.png`, promptUsed: 'front v3', role: 'front' },
      { versioning: makeVersioningSpy() }
    );
    frontSeq4Id = front4.id;
    editIterationIds.push(front4.id);
  });

  afterAll(async () => {
    await prisma.chatMessage.deleteMany({ where: { projectId: editProjectId } });
    await prisma.iteration.deleteMany({ where: { id: { in: editIterationIds } } });
    await prisma.project.deleteMany({ where: { id: editProjectId } });
  });

  function stubImageVisionClient(calls: unknown[]): ImageVisionClient {
    return {
      async generateImage(input) {
        calls.push(input);
        return { imagePath: `projects/${input.projectId}/outputs/edit-test-${calls.length}.png` };
      },
    };
  }

  it('"last" resolves to the highest-seq iteration on the active face, even when the accepted iteration is not the highest seq', async () => {
    const calls: any[] = [];
    const script: MockProviderScript = [
      {
        kind: 'tool_calls',
        calls: [{ id: 'edit-1', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: 'make it brighter', editSourceIteration: 'last' } }],
      },
      { kind: 'message', content: 'Updated the image.' },
    ];

    await runTurn(
      { projectId: editProjectId, message: 'Make it brighter.', activeFace: 'front' },
      { provider: createMockAdapter(script), imageVisionClient: stubImageVisionClient(calls), versioning: makeVersioningSpy() }
    );

    expect(calls).toHaveLength(1);
    const iteration4 = await prisma.iteration.findUniqueOrThrow({ where: { id: frontSeq4Id } });
    // Ticket 013-002 (SUC-025): the relative Iteration.imagePath, never
    // the resolveWorkspacePath-resolved absolute value.
    expect(calls[0].modelParams.referenceImages).toEqual([iteration4.imagePath]);
  });

  it('"last" with zero iterations on the active face yields no referenceImages (SUC-020, no regression)', async () => {
    // A dedicated, separate project with iterations only on 'front' --
    // editProjectId's own fixture has a 'back' iteration (backSeq3Id),
    // so this scenario needs a project where 'back' truly has none.
    const noBackProject = await prisma.project.create({
      data: { title: `${marker}-no-back-iterations-project`, ownerUserId: ownerId },
    });
    const frontOnly = await createIteration(
      { projectId: noBackProject.id, imagePath: `projects/${noBackProject.id}/iterations/iter-1.png`, promptUsed: 'front only', role: 'front' },
      { versioning: makeVersioningSpy() }
    );
    cleanup.projectIds.push(noBackProject.id);
    cleanup.iterationIds.push(frontOnly.id);

    const calls: any[] = [];
    const script: MockProviderScript = [
      {
        kind: 'tool_calls',
        calls: [{ id: 'edit-2', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: 'start something new here', editSourceIteration: 'last' } }],
      },
      { kind: 'message', content: 'Generated a new image.' },
    ];

    await runTurn(
      { projectId: noBackProject.id, message: 'Try something new.', activeFace: 'back' },
      { provider: createMockAdapter(script), imageVisionClient: stubImageVisionClient(calls), versioning: makeVersioningSpy() }
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].modelParams?.referenceImages).toBeUndefined();
  });

  it('a numeric editSourceIteration resolves to that iteration regardless of stream/role or accepted status', async () => {
    const calls: any[] = [];
    const backIteration = await prisma.iteration.findUniqueOrThrow({ where: { id: backSeq3Id } });
    const script: MockProviderScript = [
      {
        kind: 'tool_calls',
        calls: [
          { id: 'edit-3', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: 'edit the back one', editSourceIteration: backIteration.seq } },
        ],
      },
      { kind: 'message', content: 'Updated the back image.' },
    ];

    // activeFace is 'front', but the named iteration belongs to 'back' --
    // naming an iteration overrides stream/role and accepted status alike.
    await runTurn(
      { projectId: editProjectId, message: 'Edit iteration by number.', activeFace: 'front' },
      { provider: createMockAdapter(script), imageVisionClient: stubImageVisionClient(calls), versioning: makeVersioningSpy() }
    );

    expect(calls).toHaveLength(1);
    // Ticket 013-002 (SUC-025): the relative Iteration.imagePath, never
    // the resolveWorkspacePath-resolved absolute value.
    expect(calls[0].modelParams.referenceImages).toEqual([backIteration.imagePath]);
  });

  it('a numeric editSourceIteration with no matching row throws, surfacing as isError on tool_call_finished without crashing the turn', async () => {
    const calls: any[] = [];
    const events: TurnEvent[] = [];
    const nonexistentSeq = 999999;
    const script: MockProviderScript = [
      {
        kind: 'tool_calls',
        calls: [
          { id: 'edit-4', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: 'edit a nonexistent iteration', editSourceIteration: nonexistentSeq } },
        ],
      },
      { kind: 'message', content: "That iteration doesn't exist." },
    ];

    const result = await runTurn(
      { projectId: editProjectId, message: 'Edit iteration 999999.', activeFace: 'front' },
      {
        provider: createMockAdapter(script),
        imageVisionClient: stubImageVisionClient(calls),
        versioning: makeVersioningSpy(),
        onEvent: (e) => events.push(e),
      }
    );

    expect(calls).toHaveLength(0);
    expect(result.finalMessage).toBe("That iteration doesn't exist.");
    expect((result.toolCalls[0].result as any).error).toContain(String(nonexistentSeq));
    expect(
      events.some(
        (e) => e.type === 'tool_call_finished' && e.name === IMAGE_GENERATION_TOOL_NAME && e.isError === true
      )
    ).toBe(true);
  });

  it('editSourceIteration omitted entirely behaves identically to a plain generate_image call (no referenceImages)', async () => {
    const calls: any[] = [];
    const script: MockProviderScript = [
      { kind: 'tool_calls', calls: [{ id: 'edit-5', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: 'a brand new design' } }] },
      { kind: 'message', content: 'Generated the image.' },
    ];

    await runTurn(
      { projectId: editProjectId, message: 'Make something new.', activeFace: 'front' },
      { provider: createMockAdapter(script), imageVisionClient: stubImageVisionClient(calls), versioning: makeVersioningSpy() }
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].modelParams?.referenceImages).toBeUndefined();
  });

  // Hardening (sprint 010 Design Rationale): the only sanctioned way to
  // reference a prior image is by iteration number -- any raw path the
  // model nests under modelParams.referenceImages directly is silently
  // discarded, whether or not editSourceIteration was also set.
  it('discards a model-supplied modelParams.referenceImages even when editSourceIteration is absent', async () => {
    const calls: any[] = [];
    const script: MockProviderScript = [
      {
        kind: 'tool_calls',
        calls: [
          {
            id: 'edit-6',
            name: IMAGE_GENERATION_TOOL_NAME,
            args: { prompt: 'sneaky raw path', modelParams: { referenceImages: '/etc/passwd' } },
          },
        ],
      },
      { kind: 'message', content: 'Generated the image.' },
    ];

    await runTurn(
      { projectId: editProjectId, message: 'Generate an image.', activeFace: 'front' },
      { provider: createMockAdapter(script), imageVisionClient: stubImageVisionClient(calls), versioning: makeVersioningSpy() }
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].modelParams?.referenceImages).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Sprint 010 ticket 002: full runTurn-level integration coverage proving
// ticket 001's edit-source resolution end-to-end across all three
// stakeholder-decided scenarios (SUC-018/019/020), plus the same-turn
// "last must not go stale" correctness detail and the raw-path-injection
// hardening decision -- both called out in sprint.md's Design Rationale.
// Deliberately its own describe block (own fixtures, own project rows)
// rather than reusing ticket 001's "editSourceIteration resolves..." block
// above -- self-contained coverage of every item in this ticket's
// Acceptance Criteria, matching the exact scenarios named there (a named
// "iteration 2" that is specifically non-last/non-accepted; a dedicated
// path-containment regression; a real two-round same-turn dispatch).
// ---------------------------------------------------------------------------

describe('runTurn -- edit-source resolution (sprint 010, SUC-018/019/020)', () => {
  let suc18ProjectId: number;
  const suc18IterationIds: number[] = [];
  let iterationOneId: number; // seq 1, accepted, not the highest seq
  let iterationTwoId: number; // seq 2, not accepted, not highest -- named explicitly by number
  let iterationThreeId: number; // seq 3, highest seq ("last"), not accepted

  beforeAll(async () => {
    const project = await prisma.project.create({
      data: { title: `${marker}-suc018-019-020-project`, ownerUserId: ownerId },
    });
    suc18ProjectId = project.id;

    const iter1 = await createIteration(
      { projectId: suc18ProjectId, imagePath: `projects/${suc18ProjectId}/iterations/iter-1.png`, promptUsed: 'front v1', role: 'front' },
      { versioning: makeVersioningSpy() }
    );
    iterationOneId = iter1.id;
    suc18IterationIds.push(iter1.id);
    await prisma.iteration.update({ where: { id: iter1.id }, data: { accepted: true } });

    const iter2 = await createIteration(
      { projectId: suc18ProjectId, imagePath: `projects/${suc18ProjectId}/iterations/iter-2.png`, promptUsed: 'front v2', role: 'front' },
      { versioning: makeVersioningSpy() }
    );
    iterationTwoId = iter2.id;
    suc18IterationIds.push(iter2.id);

    const iter3 = await createIteration(
      { projectId: suc18ProjectId, imagePath: `projects/${suc18ProjectId}/iterations/iter-3.png`, promptUsed: 'front v3', role: 'front' },
      { versioning: makeVersioningSpy() }
    );
    iterationThreeId = iter3.id;
    suc18IterationIds.push(iter3.id);
  });

  afterAll(async () => {
    await prisma.chatMessage.deleteMany({ where: { projectId: suc18ProjectId } });
    await prisma.iteration.deleteMany({ where: { id: { in: suc18IterationIds } } });
    await prisma.project.deleteMany({ where: { id: suc18ProjectId } });
  });

  function stubImageVisionClient(calls: unknown[]): ImageVisionClient {
    return {
      async generateImage(input) {
        calls.push(input);
        return { imagePath: `projects/${input.projectId}/outputs/edit-002-${calls.length}.png` };
      },
    };
  }

  it('SUC-018: default "last" edits the highest-seq iteration on the active face, not the accepted one', async () => {
    const calls: any[] = [];
    const script: MockProviderScript = [
      {
        kind: 'tool_calls',
        calls: [{ id: 'suc18-1', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: 'make the sky more orange', editSourceIteration: 'last' } }],
      },
      { kind: 'message', content: 'Updated the sky color.' },
    ];

    await runTurn(
      { projectId: suc18ProjectId, message: 'Make the sky more orange.', activeFace: 'front' },
      { provider: createMockAdapter(script), imageVisionClient: stubImageVisionClient(calls), versioning: makeVersioningSpy() }
    );

    expect(calls).toHaveLength(1);
    const iter1 = await prisma.iteration.findUniqueOrThrow({ where: { id: iterationOneId } });
    const iter3 = await prisma.iteration.findUniqueOrThrow({ where: { id: iterationThreeId } });
    expect(iter1.accepted).toBe(true);
    expect(iter3.seq).toBeGreaterThan(iter1.seq);
    // Ticket 013-002 (SUC-025): the relative Iteration.imagePath, never
    // the resolveWorkspacePath-resolved absolute value.
    expect(calls[0].modelParams.referenceImages).toEqual([iter3.imagePath]);
  });

  it('SUC-019: a named iteration ("use iteration two") overrides the "last" default, naming iteration 2 specifically (non-last, non-accepted)', async () => {
    const calls: any[] = [];
    const iter2 = await prisma.iteration.findUniqueOrThrow({ where: { id: iterationTwoId } });
    expect(iter2.seq).toBe(2);
    expect(iter2.accepted).toBe(false);

    const script: MockProviderScript = [
      {
        kind: 'tool_calls',
        calls: [{ id: 'suc19-1', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: 'use iteration three and make it brighter', editSourceIteration: iter2.seq } }],
      },
      { kind: 'message', content: 'Updated iteration two.' },
    ];

    await runTurn(
      { projectId: suc18ProjectId, message: 'Use iteration two and make it brighter.', activeFace: 'front' },
      { provider: createMockAdapter(script), imageVisionClient: stubImageVisionClient(calls), versioning: makeVersioningSpy() }
    );

    expect(calls).toHaveLength(1);
    // Ticket 013-002 (SUC-025): the relative Iteration.imagePath, never
    // the resolveWorkspacePath-resolved absolute value.
    expect(calls[0].modelParams.referenceImages).toEqual([iter2.imagePath]);
  });

  it('SUC-019 negative: editSourceIteration: 99 (nonexistent) surfaces as tool_call_finished isError:true, and the turn still completes', async () => {
    const calls: any[] = [];
    const events: TurnEvent[] = [];
    const script: MockProviderScript = [
      {
        kind: 'tool_calls',
        calls: [{ id: 'suc19-neg-1', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: 'use iteration 99', editSourceIteration: 99 } }],
      },
      { kind: 'message', content: "Iteration 99 doesn't exist on this project." },
    ];

    const result = await runTurn(
      { projectId: suc18ProjectId, message: 'Use iteration 99.', activeFace: 'front' },
      {
        provider: createMockAdapter(script),
        imageVisionClient: stubImageVisionClient(calls),
        versioning: makeVersioningSpy(),
        onEvent: (e) => events.push(e),
      }
    );

    // No image ever generated -- the resolver's error short-circuits
    // before ctx.imageVisionClient.generateImage is ever called.
    expect(calls).toHaveLength(0);
    expect(result.finalMessage).toBe("Iteration 99 doesn't exist on this project.");
    expect((result.toolCalls[0].result as any).error).toContain('99');
    expect(
      events.some((e) => e.type === 'tool_call_finished' && e.name === IMAGE_GENERATION_TOOL_NAME && e.isError === true)
    ).toBe(true);
  });

  it('Hardening: a model-supplied raw modelParams.referenceImages is discarded even with no editSourceIteration set', async () => {
    const calls: any[] = [];
    const script: MockProviderScript = [
      {
        kind: 'tool_calls',
        calls: [
          {
            id: 'hardening-1',
            name: IMAGE_GENERATION_TOOL_NAME,
            args: { prompt: 'sneaky raw path', modelParams: { referenceImages: '/etc/passwd' } },
          },
        ],
      },
      { kind: 'message', content: 'Generated a fresh image.' },
    ];

    await runTurn(
      { projectId: suc18ProjectId, message: 'Generate something new.', activeFace: 'front' },
      { provider: createMockAdapter(script), imageVisionClient: stubImageVisionClient(calls), versioning: makeVersioningSpy() }
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].modelParams?.referenceImages).toBeUndefined();
  });

  it('Path containment: a resolved iteration path that would escape the workspace root is rejected, not passed through silently', async () => {
    // If resolveWorkspacePath were skipped (containment removed), this
    // traversal path would resolve outside the workspace root and the
    // stub ImageVisionClient below would receive it unmodified. Asserting
    // an isError rejection here -- rather than merely checking a
    // plausible-looking path was produced -- proves the containment call
    // is actually on this code path, not just present elsewhere.
    const escapingIteration = await createIteration(
      { projectId: suc18ProjectId, imagePath: '../../../etc/escape-attempt.png', promptUsed: 'malicious source', role: 'front' },
      { versioning: makeVersioningSpy() }
    );
    suc18IterationIds.push(escapingIteration.id);

    const calls: any[] = [];
    const events: TurnEvent[] = [];
    const script: MockProviderScript = [
      {
        kind: 'tool_calls',
        calls: [
          { id: 'containment-1', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: 'edit it', editSourceIteration: escapingIteration.seq } },
        ],
      },
      { kind: 'message', content: "That didn't work." },
    ];

    const result = await runTurn(
      { projectId: suc18ProjectId, message: 'Edit that image.', activeFace: 'front' },
      {
        provider: createMockAdapter(script),
        imageVisionClient: stubImageVisionClient(calls),
        versioning: makeVersioningSpy(),
        onEvent: (e) => events.push(e),
      }
    );

    expect(calls).toHaveLength(0);
    expect((result.toolCalls[0].result as any).error).toContain('escapes workspace root');
    expect(
      events.some((e) => e.type === 'tool_call_finished' && e.name === IMAGE_GENERATION_TOOL_NAME && e.isError === true)
    ).toBe(true);
  });

  describe('SUC-020: no prior iteration on the active face falls back to plain text-to-image (no regression)', () => {
    let freshProjectId: number;

    beforeAll(async () => {
      const project = await prisma.project.create({
        data: { title: `${marker}-suc020-fresh-project`, ownerUserId: ownerId },
      });
      freshProjectId = project.id;
    });

    afterAll(async () => {
      await prisma.chatMessage.deleteMany({ where: { projectId: freshProjectId } });
      await prisma.project.deleteMany({ where: { id: freshProjectId } });
    });

    it('editSourceIteration: "last" with zero iterations on the active face yields no referenceImages -- identical to a plain generation call', async () => {
      const calls: any[] = [];
      const script: MockProviderScript = [
        {
          kind: 'tool_calls',
          calls: [{ id: 'suc20-last-1', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: 'start something new here', editSourceIteration: 'last' } }],
        },
        { kind: 'message', content: 'Generated something new.' },
      ];

      await runTurn(
        { projectId: freshProjectId, message: 'Try something new.', activeFace: 'front' },
        { provider: createMockAdapter(script), imageVisionClient: stubImageVisionClient(calls), versioning: makeVersioningSpy() }
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].modelParams?.referenceImages).toBeUndefined();
    });

    it('editSourceIteration omitted entirely (existing-style call shape) is unaffected -- no referenceImages, no regression', async () => {
      const calls: any[] = [];
      const script: MockProviderScript = [
        { kind: 'tool_calls', calls: [{ id: 'suc20-omit-1', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: 'a brand new design' } }] },
        { kind: 'message', content: 'Generated the image.' },
      ];

      await runTurn(
        { projectId: freshProjectId, message: 'Make something new.', activeFace: 'front' },
        { provider: createMockAdapter(script), imageVisionClient: stubImageVisionClient(calls), versioning: makeVersioningSpy() }
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].modelParams?.referenceImages).toBeUndefined();
    });
  });

  describe('Same-turn staleness: "last" must not go stale within a multi-round turn', () => {
    let stalenessProjectId: number;
    const stalenessIterationIds: number[] = [];

    beforeAll(async () => {
      const project = await prisma.project.create({
        data: { title: `${marker}-staleness-project`, ownerUserId: ownerId },
      });
      stalenessProjectId = project.id;
    });

    afterAll(async () => {
      await prisma.chatMessage.deleteMany({ where: { projectId: stalenessProjectId } });
      await prisma.iteration.deleteMany({ where: { id: { in: stalenessIterationIds } } });
      await prisma.project.deleteMany({ where: { id: stalenessProjectId } });
    });

    it('a second generate_image dispatch in the same turn, using "last", resolves to the iteration the first dispatch just created -- not the turn-start snapshot', async () => {
      const calls: any[] = [];
      const createdImagePaths: string[] = [];
      // Unlike stubImageVisionClient above, this stub actually persists an
      // Iteration row per call (mirroring what the real ImageVisionClient
      // does) -- required so the second round's "last" resolution has a
      // fresh DB row, created earlier in this same turn, to find.
      const persistingStubClient: ImageVisionClient = {
        async generateImage(input) {
          calls.push(input);
          const imagePath = `projects/${input.projectId}/outputs/staleness-${calls.length}.png`;
          const created = await createIteration(
            { projectId: input.projectId, imagePath, promptUsed: 'staleness fixture', role: (input.activeFace as 'front' | 'back') ?? 'front' },
            { versioning: makeVersioningSpy() }
          );
          stalenessIterationIds.push(created.id);
          createdImagePaths.push(imagePath);
          return { imagePath };
        },
      };

      const script: MockProviderScript = [
        { kind: 'tool_calls', calls: [{ id: 'stale-1', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: 'generate a first draft, from scratch' } }] },
        {
          kind: 'tool_calls',
          calls: [{ id: 'stale-2', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: 'now change the color of that', editSourceIteration: 'last' } }],
        },
        { kind: 'message', content: 'Made both changes.' },
      ];

      await runTurn(
        { projectId: stalenessProjectId, message: 'Generate one, then change the color of that.', activeFace: 'front' },
        { provider: createMockAdapter(script), imageVisionClient: persistingStubClient, versioning: makeVersioningSpy() }
      );

      expect(calls).toHaveLength(2);
      // First dispatch: no editSourceIteration -- no source image, matching
      // a plain fresh generation.
      expect(calls[0].modelParams?.referenceImages).toBeUndefined();
      // Second dispatch: "last" resolves fresh from the DB at dispatch
      // time, seeing the iteration the first dispatch created just
      // moments earlier in this same runTurn call -- not the turn-start
      // ProjectContext snapshot, which was loaded before either iteration
      // existed.
      // Ticket 013-002 (SUC-025): the relative Iteration.imagePath, never
      // the resolveWorkspacePath-resolved absolute value.
      expect(calls[1].modelParams.referenceImages).toEqual([createdImagePaths[0]]);
    });
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

  // Sprint 012 ticket 001 regression (agent-iteration-number-grounding.md):
  // planning traced that promptUsed is populated unconditionally by
  // realImageVisionClient.generateImage regardless of whether
  // editSourceIteration was set on the generate_image call -- this test
  // pins that guarantee end-to-end (through runTurn, not just a direct
  // catalogTools call) and confirms the edit-created iteration's prompt
  // renders a hint in the very next turn's PROJECT CONTEXT.
  it('an edit-created iteration (editSourceIteration set) gets a non-empty promptUsed that renders a hint in the next PROJECT CONTEXT (sprint 012 ticket 001 regression)', async () => {
    const generateImage = () => Promise.resolve(fixtureImage('edit-regression-fixture-bytes'));
    const realClient = createRealImageVisionClient({ generateImage, versioning: makeVersioningSpy() });

    // Seed iteration #1 with a fresh generation (no editSourceIteration).
    const seedScript: MockProviderScript = [
      { kind: 'tool_calls', calls: [{ id: 'seed-1', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: 'a postcard base' } }] },
      { kind: 'message', content: 'Generated the base image.' },
    ];
    await runTurn(
      { projectId: projectAId, message: 'Please generate a base image.' },
      { provider: createMockAdapter(seedScript), imageVisionClient: realClient, versioning: makeVersioningSpy() }
    );
    const seeded = await prisma.iteration.findFirstOrThrow({
      where: { projectId: projectAId },
      orderBy: { seq: 'asc' },
    });

    // A second turn edits that seeded iteration by number.
    const editPrompt = 'make the seeded postcard brighter and add a sunset';
    const editScript: MockProviderScript = [
      {
        kind: 'tool_calls',
        calls: [
          { id: 'edit-regression-1', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: editPrompt, editSourceIteration: seeded.seq } },
        ],
      },
      { kind: 'message', content: 'Updated the image.' },
    ];
    await runTurn(
      { projectId: projectAId, message: 'Make it brighter with a sunset.' },
      { provider: createMockAdapter(editScript), imageVisionClient: realClient, versioning: makeVersioningSpy() }
    );

    const edited = await prisma.iteration.findFirstOrThrow({
      where: { projectId: projectAId, seq: seeded.seq + 1 },
    });
    expect(edited.promptUsed).toBe(editPrompt);
    expect(edited.promptUsed.length).toBeGreaterThan(0);

    // The next turn's PROJECT CONTEXT (active stream: front, the default)
    // shows the edit-created iteration's hint, sourced from its promptUsed.
    let capturedSystemPrompt = '';
    const adapter = createMockAdapter([{ kind: 'message', content: 'Sure.' }], {
      onSendTurn: (input) => {
        capturedSystemPrompt = input.systemPrompt;
      },
    });
    await runTurn(
      { projectId: projectAId, message: 'What do we have so far?' },
      { provider: adapter, versioning: makeVersioningSpy() }
    );
    expect(capturedSystemPrompt).toContain(`#${edited.seq}: "${editPrompt}"`);
  });

  // Ticket 013-002 (SUC-025, iteration-modelparams-leaks-absolute-path.md):
  // a freshly-created edit-sourced Iteration.modelParams.referenceImages
  // must hold the relative Iteration.imagePath, never the
  // resolveWorkspacePath-resolved absolute value that used to be stored
  // (and that GET /api/projects*/PROJECT_DETAIL_INCLUDE then serialized
  // to every authenticated browser). Read back from the DB after the
  // turn -- not just asserted on the in-memory dispatch args -- so this
  // proves the value that actually lands in the persisted row.
  it('a freshly-created edit-sourced Iteration.modelParams.referenceImages contains the relative imagePath, never an absolute one (ticket 013-002, SUC-025)', async () => {
    const generateImage = () => Promise.resolve(fixtureImage('path-leak-regression-fixture-bytes'));
    const realClient = createRealImageVisionClient({ generateImage, versioning: makeVersioningSpy() });

    const seedScript: MockProviderScript = [
      { kind: 'tool_calls', calls: [{ id: 'leak-seed-1', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: 'a postcard base' } }] },
      { kind: 'message', content: 'Generated the base image.' },
    ];
    await runTurn(
      { projectId: projectAId, message: 'Please generate a base image.' },
      { provider: createMockAdapter(seedScript), imageVisionClient: realClient, versioning: makeVersioningSpy() }
    );
    const seeded = await prisma.iteration.findFirstOrThrow({
      where: { projectId: projectAId },
      orderBy: { seq: 'asc' },
    });

    const editScript: MockProviderScript = [
      {
        kind: 'tool_calls',
        calls: [{ id: 'leak-edit-1', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: 'brighten it', editSourceIteration: seeded.seq } }],
      },
      { kind: 'message', content: 'Brightened the image.' },
    ];
    await runTurn(
      { projectId: projectAId, message: 'Brighten it.' },
      { provider: createMockAdapter(editScript), imageVisionClient: realClient, versioning: makeVersioningSpy() }
    );

    const edited = await prisma.iteration.findFirstOrThrow({
      where: { projectId: projectAId, seq: seeded.seq + 1 },
    });

    const referenceImages = (edited.modelParams as { referenceImages?: string[] } | null)?.referenceImages;
    expect(referenceImages).toEqual([seeded.imagePath]);
    expect(referenceImages![0].startsWith('/')).toBe(false);
    expect(referenceImages![0]).not.toContain(resolveWorkspacePath('.'));
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

// ---------------------------------------------------------------------------
// Ticket 007-002: create_project ownerUserId/version injection at the turn
// controller layer (SUC-002 -- the model never needs to know or ask for
// internal IDs). catalogTools.createProject's own validation is untouched
// -- these tests dispatch through runTurn with a spy `create_project`
// handler that forwards to the real `createProject` after recording the
// args it actually received, so the injection is verified directly.
// ---------------------------------------------------------------------------

describe('runTurn -- create_project ownerUserId/version injection (ticket 007-002, SUC-002)', () => {
  let injectionProjectId: number;
  let otherOwnerId: number;

  function spyCreateProjectHandlers(receivedArgs: unknown[]): Record<string, WorkspaceToolHandler> {
    return {
      create_project: async (args: any, options: any) => {
        receivedArgs.push(args);
        return createProject(args, options);
      },
    };
  }

  beforeAll(async () => {
    const project = await prisma.project.create({
      data: { title: `${marker}-injection-project`, ownerUserId: ownerId },
    });
    injectionProjectId = project.id;
    cleanup.projectIds.push(injectionProjectId);

    const otherOwner = await prisma.user.create({
      data: { email: `${marker}-other-owner@example.com`, displayName: 'Other Owner' },
    });
    otherOwnerId = otherOwner.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: otherOwnerId } });
  });

  it('fills version and ownerUserId from the DB when the model updates the current project supplying only id + title (rename end-to-end)', async () => {
    const before = await prisma.project.findUniqueOrThrow({ where: { id: injectionProjectId } });
    const receivedArgs: unknown[] = [];
    const script: MockProviderScript = [
      {
        kind: 'tool_calls',
        calls: [{ id: 'cp-1', name: 'create_project', args: { id: injectionProjectId, title: 'New Name' } }],
      },
      { kind: 'message', content: 'Renamed the project.' },
    ];

    const result = await runTurn(
      { projectId: injectionProjectId, message: 'Rename this project to New Name.' },
      { provider: createMockAdapter(script), toolHandlers: spyCreateProjectHandlers(receivedArgs), versioning: makeVersioningSpy() }
    );

    expect(receivedArgs).toHaveLength(1);
    expect(receivedArgs[0]).toMatchObject({
      id: injectionProjectId,
      title: 'New Name',
      version: before.version,
      ownerUserId: before.ownerUserId,
    });

    expect(result.toolCalls[0].name).toBe('create_project');

    const after = await prisma.project.findUniqueOrThrow({ where: { id: injectionProjectId } });
    expect(after.title).toBe('New Name');
    expect(after.version).toBe(before.version + 1);
  });

  it('fills ownerUserId from RunTurnInput.authenticatedUserId when the model creates a genuinely new project with no id and no ownerUserId', async () => {
    const receivedArgs: unknown[] = [];
    const script: MockProviderScript = [
      {
        kind: 'tool_calls',
        calls: [{ id: 'cp-2', name: 'create_project', args: { title: `${marker}-brand-new-project` } }],
      },
      { kind: 'message', content: 'Created the new project.' },
    ];

    const result = await runTurn(
      { projectId: injectionProjectId, message: 'Start a new project.', authenticatedUserId: ownerId },
      { provider: createMockAdapter(script), toolHandlers: spyCreateProjectHandlers(receivedArgs), versioning: makeVersioningSpy() }
    );

    expect(receivedArgs[0]).toMatchObject({ title: `${marker}-brand-new-project`, ownerUserId: ownerId });
    expect(receivedArgs[0]).not.toHaveProperty('id');

    const createdId = (result.toolCalls[0].result as any).id;
    cleanup.projectIds.push(createdId);
  });

  it('passes through an explicit model-supplied ownerUserId unchanged on an update, never overriding it with the current owner', async () => {
    const receivedArgs: unknown[] = [];
    const script: MockProviderScript = [
      {
        kind: 'tool_calls',
        calls: [
          {
            id: 'cp-3',
            name: 'create_project',
            args: { id: injectionProjectId, ownerUserId: otherOwnerId },
          },
        ],
      },
      { kind: 'message', content: 'Updated the owner.' },
    ];

    await runTurn(
      { projectId: injectionProjectId, message: 'Change the owner.' },
      { provider: createMockAdapter(script), toolHandlers: spyCreateProjectHandlers(receivedArgs), versioning: makeVersioningSpy() }
    );

    expect(receivedArgs[0]).toMatchObject({ id: injectionProjectId, ownerUserId: otherOwnerId });

    // Restore the owner back for subsequent tests in this describe block.
    const restored = await prisma.project.findUniqueOrThrow({ where: { id: injectionProjectId } });
    await prisma.project.update({ where: { id: injectionProjectId }, data: { ownerUserId: ownerId, version: restored.version + 1 } });
  });

  it('a concurrent update after injection still surfaces VersionConflictError as an isError tool result (unchanged failure path)', async () => {
    const receivedArgs: unknown[] = [];
    const raceHandlers: Record<string, WorkspaceToolHandler> = {
      create_project: async (args: any, options: any) => {
        receivedArgs.push(args);
        // Simulate a concurrent update landing after this turn's injection
        // read the version, but before the handler's own update executes --
        // the injected version is now stale.
        const current = await prisma.project.findUniqueOrThrow({ where: { id: injectionProjectId } });
        await prisma.project.update({
          where: { id: injectionProjectId },
          data: { version: current.version + 1 },
        });
        return createProject(args, options);
      },
    };
    const script: MockProviderScript = [
      {
        kind: 'tool_calls',
        calls: [{ id: 'cp-4', name: 'create_project', args: { id: injectionProjectId, title: 'Raced Name' } }],
      },
      { kind: 'message', content: 'Attempted the rename.' },
    ];
    const events: TurnEvent[] = [];

    const result = await runTurn(
      { projectId: injectionProjectId, message: 'Rename again.' },
      { provider: createMockAdapter(script), toolHandlers: raceHandlers, versioning: makeVersioningSpy(), onEvent: (e) => events.push(e) }
    );

    expect(receivedArgs[0]).toMatchObject({ id: injectionProjectId, title: 'Raced Name' });
    expect((result.toolCalls[0].result as any).error).toContain('Version conflict');
    expect(
      events.some((e) => e.type === 'tool_call_finished' && e.name === 'create_project' && e.isError === true)
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ticket 007-003: system prompt guardrail against internal IDs and silent
// tool failures (issue agent-asks-user-for-internal-ids.md). Content
// assertions only -- the model's actual behavior given the updated prompt
// is a manual/product-review check (this ticket's last Acceptance
// Criterion), not something a unit test against a scripted mock adapter can
// assert.
// ---------------------------------------------------------------------------

describe('runTurn -- system prompt guardrail against internal IDs and silent tool failures (ticket 007-003)', () => {
  it('sends a system prompt instructing the model never to ask for internal identifiers and to state tool failures plainly', async () => {
    const sentPrompts: string[] = [];
    const script: MockProviderScript = [{ kind: 'message', content: 'Sure, what would you like to work on?' }];

    await runTurn(
      { projectId: projectAId, message: 'Hello.' },
      {
        provider: createMockAdapter(script, { onSendTurn: (input) => sentPrompts.push(input.systemPrompt) }),
        versioning: makeVersioningSpy(),
      }
    );

    expect(sentPrompts).toHaveLength(1);
    expect(sentPrompts[0]).toContain(
      'Never ask the user for internal identifiers -- database IDs, project IDs, version numbers, internal keys, or similar'
    );
    expect(sentPrompts[0]).toContain('If a tool call fails, state in your next message, in plain language, what failed');
  });

  // Sprint 012 ticket 001 (agent-iteration-number-grounding.md): live
  // incident, project 14, 2026-07-19 -- the agent hedged that UI numbering
  // and its internal numbering "may not line up" and then fabricated a
  // description of a referenced iteration. This asserts the new trust
  // statement is present, mirroring the assertion style just above for the
  // existing "Never ask the user for internal identifiers" guardrail.
  it('sends a system prompt stating the user\'s iteration number is exactly the UI seq/editSourceIteration value and instructing the model to say plainly when it cannot identify one', async () => {
    const sentPrompts: string[] = [];
    const script: MockProviderScript = [{ kind: 'message', content: 'Sure, what would you like to work on?' }];

    await runTurn(
      { projectId: projectAId, message: 'Hello.' },
      {
        provider: createMockAdapter(script, { onSendTurn: (input) => sentPrompts.push(input.systemPrompt) }),
        versioning: makeVersioningSpy(),
      }
    );

    expect(sentPrompts).toHaveLength(1);
    expect(sentPrompts[0]).toContain(
      'The iteration number the user says (e.g. "iteration 3") is exactly the same number shown as "Iteration 3" in the UI and the same value editSourceIteration resolves against'
    );
    expect(sentPrompts[0]).toContain(
      'If you cannot identify a referenced iteration or describe its actual content, say so plainly rather than invent a description.'
    );
  });

  it('still sends the updated system prompt on the follow-up sendTurn call after a tool call returns isError: true', async () => {
    const sentPrompts: string[] = [];
    const script: MockProviderScript = [
      { kind: 'tool_calls', calls: [{ id: 'fail-1', name: 'create_project', args: { id: -1, title: 'Nope' } }] },
      { kind: 'message', content: 'That update failed.' },
    ];

    await runTurn(
      { projectId: projectAId, message: 'Rename this project.' },
      {
        provider: createMockAdapter(script, { onSendTurn: (input) => sentPrompts.push(input.systemPrompt) }),
        versioning: makeVersioningSpy(),
      }
    );

    expect(sentPrompts).toHaveLength(2);
    for (const prompt of sentPrompts) {
      expect(prompt).toContain('Never ask the user for internal identifiers');
      expect(prompt).toContain('If a tool call fails, state in your next message, in plain language, what failed');
    }
  });

  // Sprint 013 ticket 004 (issue
  // agent-falsely-refuses-rename-parrots-history.md): live incident,
  // project 14, 2026-07-20 -- asked to rename the project, the agent
  // replied with a stale "I can't rename it without the owner user ID"
  // refusal, parroting two earlier, pre-sprint-007 refusal messages
  // already sitting in the conversation history, rather than attempting
  // the (already-working) `create_project` call. This asserts the new
  // anti-parroting sentence is present, mirroring the assertion style
  // above for the existing internal-ID and iteration-numbering guardrails.
  it('sends a system prompt instructing the model to act on its current tool capability and never re-assert a past refusal or limitation from the transcript (ticket 013-004)', async () => {
    const sentPrompts: string[] = [];
    const script: MockProviderScript = [{ kind: 'message', content: 'Sure, what would you like to work on?' }];

    await runTurn(
      { projectId: projectAId, message: 'Hello.' },
      {
        provider: createMockAdapter(script, { onSendTurn: (input) => sentPrompts.push(input.systemPrompt) }),
        versioning: makeVersioningSpy(),
      }
    );

    expect(sentPrompts).toHaveLength(1);
    expect(sentPrompts[0]).toContain(
      'Always act on your current tool capability: never re-assert a past refusal, block, or limitation from earlier in this conversation without actually attempting the corresponding tool call again this turn and reporting the real, current result.'
    );
  });

  // Regression test for the live incident itself: seeds a poisoned-history
  // fixture matching the real `ChatMessage` shape (a prior assistant
  // refusal with an EMPTY/absent `toolCalls` column -- id 92 in the
  // incident, never a real tool failure), then sends a new rename request
  // and asserts the turn dispatches a REAL, populated `create_project`
  // call rather than short-circuiting to a text-only reply. Per the
  // ticket's own testing note (and matching ticket 007-003's precedent for
  // the internal-ID guardrail): the mock adapter is scripted to call
  // `create_project` here, since a unit test cannot itself verify the real
  // model's behavior given the updated prompt -- this proves a rename
  // attempt reaches `create_project` normally even with poisoned history
  // in context, not that the live model will always comply.
  it('does not repeat a stale, poisoned-history refusal: a new rename request still dispatches a real, populated create_project call (ticket 013-004)', async () => {
    const project = await prisma.project.create({
      data: { title: `${marker}-poisoned-history-project`, ownerUserId: ownerId },
    });
    cleanup.projectIds.push(project.id);

    await prisma.chatMessage.create({
      data: { projectId: project.id, role: 'user', content: 'Please rename this to League of Mentors.' },
    });
    // The stale refusal itself: role 'assistant', text-only content, and
    // an EMPTY/absent toolCalls column -- exactly the incident's
    // ChatMessage id 92 shape. No tool was ever called for this reply.
    await prisma.chatMessage.create({
      data: {
        projectId: project.id,
        role: 'assistant',
        content: "I can't rename it without the owner user ID -- every attempt to set the title fails at that step.",
      },
    });

    const receivedArgs: unknown[] = [];
    const handlers: Record<string, WorkspaceToolHandler> = {
      create_project: async (args: any, options: any) => {
        receivedArgs.push(args);
        return createProject(args, options);
      },
    };
    const script: MockProviderScript = [
      {
        kind: 'tool_calls',
        calls: [{ id: 'ap-1', name: 'create_project', args: { id: project.id, title: 'League of Mentors' } }],
      },
      { kind: 'message', content: 'Renamed the project to League of Mentors.' },
    ];

    const result = await runTurn(
      { projectId: project.id, message: 'Please try renaming it to League of Mentors again.' },
      { provider: createMockAdapter(script), toolHandlers: handlers, versioning: makeVersioningSpy() }
    );

    // A REAL, populated create_project call was dispatched this turn --
    // not a text-only reply repeating the old refusal.
    expect(receivedArgs).toHaveLength(1);
    expect(receivedArgs[0]).toMatchObject({ id: project.id, title: 'League of Mentors' });

    const createCall = result.toolCalls.find((c) => c.name === 'create_project');
    expect(createCall).toBeDefined();
    expect((createCall!.result as any).error).toBeUndefined();
    expect((createCall!.result as any).id).toBe(project.id);
    expect((createCall!.result as any).title).toBe('League of Mentors');

    const after = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(after.title).toBe('League of Mentors');
  });
});

// ---------------------------------------------------------------------------
// Ticket 006-002: additive `stage` progress events at each phase transition.
// ---------------------------------------------------------------------------

describe('runTurn -- stage progress events (ticket 006-002)', () => {
  function stageEvents(events: TurnEvent[]): Extract<TurnEvent, { type: 'stage' }>[] {
    return events.filter((e): e is Extract<TurnEvent, { type: 'stage' }> => e.type === 'stage');
  }

  it('(a) a turn with no tool calls emits a knowledge_retrieval stage then a drafting stage, each with a Date.now()-style startedAt', async () => {
    const events: TurnEvent[] = [];
    const before = Date.now();

    await runTurn(
      { projectId: projectAId, message: 'Just chatting, no tools needed.' },
      { provider: createMockAdapter([{ kind: 'message', content: 'Sure thing.' }]), versioning: makeVersioningSpy(), onEvent: (e) => events.push(e) }
    );

    const after = Date.now();
    const stages = stageEvents(events);

    expect(stages.map((s) => s.stage)).toEqual(['knowledge_retrieval', 'drafting']);
    expect(stages[0].label).toBe('Consulting knowledge sources…');
    expect(stages[1].label).toBe('Drafting flyer content…');
    for (const s of stages) {
      expect(s.startedAt).toBeGreaterThanOrEqual(before);
      expect(s.startedAt).toBeLessThanOrEqual(after);
    }

    // Every pre-existing event still fires unchanged (AC7): status/message.
    expect(events.some((e) => e.type === 'status' && e.status === 'started')).toBe(true);
    expect(events.some((e) => e.type === 'message' && e.content === 'Sure thing.')).toBe(true);
    expect(events.some((e) => e.type === 'status' && e.status === 'completed')).toBe(true);
  });

  it('(b) a turn with one generate_image call emits a generating_image stage labeled "#1", alongside the unchanged tool_call_started/_finished events', async () => {
    const events: TurnEvent[] = [];
    const stubClient: ImageVisionClient = {
      async generateImage(input) {
        return { imagePath: `projects/${input.projectId}/outputs/one.png` };
      },
    };
    const script: MockProviderScript = [
      { kind: 'tool_calls', calls: [{ id: 'img-1', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: 'a red postcard' } }] },
      { kind: 'message', content: 'Generated the image.' },
    ];

    await runTurn(
      { projectId: projectAId, message: 'Generate an image please.' },
      { provider: createMockAdapter(script), imageVisionClient: stubClient, versioning: makeVersioningSpy(), onEvent: (e) => events.push(e) }
    );

    const stages = stageEvents(events);
    expect(stages.map((s) => s.stage)).toEqual(['knowledge_retrieval', 'drafting', 'generating_image', 'assembling']);
    expect(stages[2].label).toBe('Generating image (#1)…');

    expect(events.some((e) => e.type === 'tool_call_started' && e.name === IMAGE_GENERATION_TOOL_NAME)).toBe(true);
    expect(events.some((e) => e.type === 'tool_call_finished' && e.name === IMAGE_GENERATION_TOOL_NAME && !e.isError)).toBe(
      true
    );
  });

  it('(c) a turn with two generate_image calls in one round labels them #1 then #2, distinct and monotonically increasing', async () => {
    const events: TurnEvent[] = [];
    let n = 0;
    const stubClient: ImageVisionClient = {
      async generateImage(input) {
        n += 1;
        return { imagePath: `projects/${input.projectId}/outputs/multi-${n}.png` };
      },
    };
    const script: MockProviderScript = [
      {
        kind: 'tool_calls',
        calls: [
          { id: 'img-1', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: 'first image' } },
          { id: 'img-2', name: IMAGE_GENERATION_TOOL_NAME, args: { prompt: 'second image' } },
        ],
      },
      { kind: 'message', content: 'Generated both images.' },
    ];

    await runTurn(
      { projectId: projectAId, message: 'Generate two images please.' },
      { provider: createMockAdapter(script), imageVisionClient: stubClient, versioning: makeVersioningSpy(), onEvent: (e) => events.push(e) }
    );

    const generatingImageStages = stageEvents(events).filter((s) => s.stage === 'generating_image');
    expect(generatingImageStages.map((s) => s.label)).toEqual(['Generating image (#1)…', 'Generating image (#2)…']);
  });

  it('(d) a non-image tool call followed by a final message fires the assembling stage on the second provider.sendTurn call', async () => {
    const events: TurnEvent[] = [];
    const script: MockProviderScript = [
      { kind: 'tool_calls', calls: [{ id: 'search-1', name: 'search_catalog', args: { query: 'stage-test-query' } }] },
      { kind: 'message', content: 'Here is what I found.' },
    ];

    await runTurn(
      { projectId: projectAId, message: 'Search the catalog.' },
      { provider: createMockAdapter(script), versioning: makeVersioningSpy(), onEvent: (e) => events.push(e) }
    );

    const stages = stageEvents(events);
    expect(stages.map((s) => s.stage)).toEqual(['knowledge_retrieval', 'drafting', 'assembling']);
  });
});

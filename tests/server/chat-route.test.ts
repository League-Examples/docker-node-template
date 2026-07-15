/**
 * Coverage for the Agent Runtime's SSE chat API (ticket 005 AC6,
 * relaxed to `requireAuth`-only in ticket 006 -- see
 * `server/src/routes/chat.ts`'s module header) and its translation of
 * `turn.ts`'s `TurnEvent`s into `data:` SSE frames.
 *
 * `runTurn` itself (context reconstruction, provider loop, tool dispatch,
 * persistence, locking) is covered end-to-end by
 * `tests/server/agent-turn.test.ts` against the mock adapter -- this file
 * mocks `agent/turn.ts`'s `runTurn` export entirely, so the route's own
 * auth-gating and event-streaming logic is tested in isolation, with no
 * real turn/provider/DB-write behavior involved here.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';

const mockRunTurn = vi.hoisted(() => vi.fn());

vi.mock('../../server/src/agent/turn', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/src/agent/turn')>();
  return {
    ...actual,
    runTurn: (...args: unknown[]) => mockRunTurn(...args),
  };
});

import app from '../../server/src/app';
import { prisma } from '../../server/src/services/prisma';

const marker = `t005chat${Date.now()}`;

let adminUserId: number;
let regularUserId: number;

beforeAll(async () => {
  const admin = await prisma.user.create({
    data: {
      email: `${marker}-admin@example.com`,
      displayName: 'Chat Route Admin',
      role: 'ADMIN',
      provider: 'test',
      providerId: `${marker}-admin`,
    },
  });
  adminUserId = admin.id;

  const regular = await prisma.user.create({
    data: {
      email: `${marker}-user@example.com`,
      displayName: 'Chat Route User',
      role: 'USER',
      provider: 'test',
      providerId: `${marker}-user`,
    },
  });
  regularUserId = regular.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [adminUserId, regularUserId] } } });
});

beforeEach(() => {
  mockRunTurn.mockReset();
});

async function loginAsAdmin() {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({
    email: `${marker}-admin@example.com`,
    displayName: 'Chat Route Admin',
    role: 'ADMIN',
  });
  return agent;
}

async function loginAsUser() {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({
    email: `${marker}-user@example.com`,
    displayName: 'Chat Route User',
    role: 'USER',
  });
  return agent;
}

/** Buffers the raw SSE response body as a single string (supertest's
 * default JSON parser can't handle `text/event-stream`). */
function bufferedPost(agent: ReturnType<typeof request.agent>, url: string) {
  return agent.post(url).buffer(true).parse((response, callback) => {
    let data = '';
    response.on('data', (chunk: Buffer) => {
      data += chunk.toString('utf8');
    });
    response.on('end', () => callback(null, data));
  });
}

function parseSseEvents(body: string): unknown[] {
  return body
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)));
}

describe('POST /api/projects/:projectId/chat -- auth gate', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const res = await request(app).post('/api/projects/1/chat').send({ message: 'hi' });
    expect(res.status).toBe(401);
    expect(mockRunTurn).not.toHaveBeenCalled();
  });

  it('allows a non-admin authenticated request past the auth gate (ticket 006: requireAdmin dropped)', async () => {
    mockRunTurn.mockImplementation(async (_input: any, options: any) => {
      options.onEvent({ type: 'status', status: 'completed' });
      return {
        finalMessage: 'ok',
        messages: [],
        toolCalls: [],
        commit: { committed: true, pushed: false },
        consultedKnowledge: [],
      };
    });

    const agent = await loginAsUser();
    const res = await bufferedPost(agent, '/api/projects/1/chat').send({ message: 'hi' });
    expect(res.status).toBe(200);
    expect(mockRunTurn).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing message with 400 for an admin request', async () => {
    const agent = await loginAsAdmin();
    const res = await agent.post('/api/projects/1/chat').send({});
    expect(res.status).toBe(400);
    expect(mockRunTurn).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric project id with 400', async () => {
    const agent = await loginAsAdmin();
    const res = await agent.post('/api/projects/not-a-number/chat').send({ message: 'hi' });
    expect(res.status).toBe(400);
    expect(mockRunTurn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Sprint 005 OOP change, 2026-07-15: `activeFace` threading -- the client
// includes which stream tab is active, and this route forwards it straight
// through to `runTurn` so a `generate_image` call this turn dispatches tags
// its new Iteration into that stream (`turn.ts`'s `RunTurnInput.activeFace`).
// ---------------------------------------------------------------------------

describe('POST /api/projects/:projectId/chat -- activeFace threading', () => {
  function stubRunTurn() {
    mockRunTurn.mockImplementation(async (_input: any, options: any) => {
      options.onEvent({ type: 'status', status: 'completed' });
      return {
        finalMessage: 'ok',
        messages: [],
        toolCalls: [],
        commit: { committed: true, pushed: false },
        consultedKnowledge: [],
      };
    });
  }

  it('forwards a valid activeFace ("back") to runTurn', async () => {
    stubRunTurn();
    const agent = await loginAsAdmin();
    await bufferedPost(agent, '/api/projects/1/chat').send({ message: 'hi', activeFace: 'back' });

    expect(mockRunTurn).toHaveBeenCalledTimes(1);
    const [input] = mockRunTurn.mock.calls[0];
    expect(input).toMatchObject({ activeFace: 'back' });
  });

  it('forwards a valid activeFace ("front") to runTurn', async () => {
    stubRunTurn();
    const agent = await loginAsAdmin();
    await bufferedPost(agent, '/api/projects/1/chat').send({ message: 'hi', activeFace: 'front' });

    const [input] = mockRunTurn.mock.calls[0];
    expect(input).toMatchObject({ activeFace: 'front' });
  });

  it('treats a missing/invalid activeFace as unspecified (undefined), not a 400 -- runTurn applies its own default', async () => {
    stubRunTurn();
    const agent = await loginAsAdmin();

    await bufferedPost(agent, '/api/projects/1/chat').send({ message: 'hi' });
    expect(mockRunTurn.mock.calls[0][0].activeFace).toBeUndefined();

    mockRunTurn.mockClear();
    await bufferedPost(agent, '/api/projects/1/chat').send({ message: 'hi', activeFace: 'sideways' });
    expect(mockRunTurn.mock.calls[0][0].activeFace).toBeUndefined();
  });
});

describe('POST /api/projects/:projectId/chat -- streams a scripted turn', () => {
  it('streams the expected SSE event sequence for a successful turn', async () => {
    mockRunTurn.mockImplementation(async (input: any, options: any) => {
      options.onEvent({ type: 'status', status: 'started' });
      options.onEvent({ type: 'tool_call_started', callId: 'c1', name: 'create_knowledge_entry', args: {} });
      options.onEvent({
        type: 'tool_call_finished',
        callId: 'c1',
        name: 'create_knowledge_entry',
        args: {},
        result: { id: 1 },
        isError: false,
      });
      options.onEvent({ type: 'message', content: 'All done.' });
      options.onEvent({ type: 'status', status: 'completed' });
      return {
        finalMessage: 'All done.',
        messages: [],
        toolCalls: [],
        commit: { committed: true, pushed: false },
        consultedKnowledge: [],
      };
    });

    const agent = await loginAsAdmin();
    const res = await bufferedPost(agent, '/api/projects/42/chat').send({ message: 'Please help.' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(mockRunTurn).toHaveBeenCalledTimes(1);
    expect(mockRunTurn.mock.calls[0][0]).toEqual({ projectId: 42, message: 'Please help.' });

    // ticket 004-002 AC2: production wiring passes the real,
    // imaging.ts-backed ImageVisionClient instead of relying on turn.ts's
    // stub default.
    const passedOptions = mockRunTurn.mock.calls[0][1];
    expect(typeof passedOptions.imageVisionClient?.generateImage).toBe('function');

    const events = parseSseEvents(res.body as unknown as string);
    expect(events).toEqual([
      { type: 'status', status: 'started' },
      { type: 'tool_call_started', callId: 'c1', name: 'create_knowledge_entry', args: {} },
      { type: 'tool_call_finished', callId: 'c1', name: 'create_knowledge_entry', args: {}, result: { id: 1 }, isError: false },
      { type: 'message', content: 'All done.' },
      { type: 'status', status: 'completed' },
    ]);
  });

  it('streams an error event and ends the stream when the turn throws', async () => {
    mockRunTurn.mockImplementation(async (input: any, options: any) => {
      options.onEvent({ type: 'status', status: 'started' });
      options.onEvent({ type: 'error', message: 'turn failed: boom' });
      throw new Error('turn failed: boom');
    });

    const agent = await loginAsAdmin();
    const res = await bufferedPost(agent, '/api/projects/42/chat').send({ message: 'Please help.' });

    // Headers (200, text/event-stream) are already flushed before runTurn
    // throws -- the route swallows the rethrow and just ends the stream
    // (see routes/chat.ts's module header on why `next(err)` isn't used
    // here).
    expect(res.status).toBe(200);
    const events = parseSseEvents(res.body as unknown as string);
    expect(events).toEqual([
      { type: 'status', status: 'started' },
      { type: 'error', message: 'turn failed: boom' },
    ]);
  });
});

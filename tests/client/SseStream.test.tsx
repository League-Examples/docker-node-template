import { describe, it, expect, vi, afterEach } from 'vitest';
import { postSseStream } from '../../client/src/lib/sse';

/**
 * Coverage for `client/src/lib/sse.ts` (ticket 005-009): the `fetch()` +
 * `ReadableStream`-reader SSE consumer that `ChatPanel.tsx` builds on
 * instead of `EventSource` (which cannot target a `POST` endpoint). No
 * live network and no real `ReadableStream` global is exercised here --
 * `fetch` is stubbed to resolve a fake `body` object exposing the same
 * `getReader()`/`read()` shape a real `ReadableStream` reader has, so
 * this file proves the frame-parsing logic itself without depending on
 * jsdom's `ReadableStream` support.
 */

/** A fake `response.body`: yields each string in `chunks` as one
 * `reader.read()` call (UTF-8 encoded), then signals `done`. */
function fakeStreamBody(chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    getReader() {
      return {
        read: async () => {
          if (index >= chunks.length) {
            return { done: true, value: undefined };
          }
          const value = encoder.encode(chunks[index]);
          index += 1;
          return { done: false, value };
        },
      };
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('postSseStream', () => {
  it('POSTs the body as JSON with the expected headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: fakeStreamBody([]) });
    vi.stubGlobal('fetch', fetchMock);

    await postSseStream('/api/projects/1/chat', { message: 'hi' }, () => {});

    expect(fetchMock).toHaveBeenCalledWith('/api/projects/1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
      signal: undefined,
    });
  });

  it('parses multiple data: frames delivered in a single chunk', async () => {
    const events: unknown[] = [];
    const frame = 'data: {"type":"status","status":"started"}\n\ndata: {"type":"message","content":"hi"}\n\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: fakeStreamBody([frame]) }));

    await postSseStream('/api/x', {}, (event) => events.push(event));

    expect(events).toEqual([
      { type: 'status', status: 'started' },
      { type: 'message', content: 'hi' },
    ]);
  });

  it('parses a single frame split across multiple chunks (buffer accumulation)', async () => {
    const events: unknown[] = [];
    const chunks = ['data: {"type":"mess', 'age","content":"partial"}', '\n\n'];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: fakeStreamBody(chunks) }));

    await postSseStream('/api/x', {}, (event) => events.push(event));

    expect(events).toEqual([{ type: 'message', content: 'partial' }]);
  });

  it('invokes onEvent once per frame, in arrival order, across separate chunks', async () => {
    const events: unknown[] = [];
    const chunks = [
      'data: {"type":"tool_call_started","callId":"1","name":"generate_image","args":{}}\n\n',
      'data: {"type":"tool_call_finished","callId":"1","name":"generate_image","args":{},"result":{},"isError":false}\n\n',
      'data: {"type":"message","content":"done"}\n\n',
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: fakeStreamBody(chunks) }));

    await postSseStream('/api/x', {}, (event) => events.push(event));

    expect(events).toHaveLength(3);
    expect((events[0] as any).type).toBe('tool_call_started');
    expect((events[1] as any).type).toBe('tool_call_finished');
    expect((events[2] as any).type).toBe('message');
  });

  it('skips a malformed frame but keeps processing the rest of the stream', async () => {
    const events: unknown[] = [];
    const chunks = ['data: not-json\n\ndata: {"type":"message","content":"ok"}\n\n'];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: fakeStreamBody(chunks) }));

    await postSseStream('/api/x', {}, (event) => events.push(event));

    expect(events).toEqual([{ type: 'message', content: 'ok' }]);
  });

  it('honors a final frame with no trailing blank-line terminator', async () => {
    const events: unknown[] = [];
    const chunks = ['data: {"type":"message","content":"last"}'];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: fakeStreamBody(chunks) }));

    await postSseStream('/api/x', {}, (event) => events.push(event));

    expect(events).toEqual([{ type: 'message', content: 'last' }]);
  });

  it('throws when the response is not ok, without invoking onEvent', async () => {
    const onEvent = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await expect(postSseStream('/api/x', {}, onEvent)).rejects.toThrow('HTTP 500');
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('throws when the response has no readable body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: null }));

    await expect(postSseStream('/api/x', {}, () => {})).rejects.toThrow('Response body is not readable');
  });
});

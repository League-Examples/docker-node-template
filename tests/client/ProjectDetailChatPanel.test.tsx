import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import ChatPanel from '../../client/src/pages/ProjectDetail/ChatPanel';
import type { ChatMessageDTO } from '../../client/src/pages/ProjectDetail/types';

/**
 * Coverage for `client/src/pages/ProjectDetail/ChatPanel.tsx` (ticket
 * 005-009): SSE-streamed chat consumed via `fetch()` + a `ReadableStream`
 * reader (never `EventSource` -- the endpoint is `POST`, and `EventSource`
 * is GET-only), chat-history rehydration from `GET /api/projects/:id`'s
 * already-fetched `chatMessages` (no second fetch on mount), streamed
 * `TurnEvent` rendering (status text, tool-call status text, the final
 * message bubble), and visible error surfacing.
 */

/** A fake `response.body`: yields each string in `chunks` as one
 * `reader.read()` call, then signals `done` -- same fixture shape as
 * `SseStream.test.tsx`. */
function fakeStreamBody(chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    getReader() {
      return {
        read: async () => {
          if (index >= chunks.length) return { done: true, value: undefined };
          const value = encoder.encode(chunks[index]);
          index += 1;
          return { done: false, value };
        },
      };
    },
  };
}

function sseFrames(events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ChatPanel -- history rehydration (SUC-005)', () => {
  it('renders chatMessages from GET /api/projects/:id immediately, with no fetch of its own on mount', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const history: ChatMessageDTO[] = [
      { id: 1, projectId: 7, role: 'assistant', content: 'Welcome back!', createdAt: '2026-07-14T00:00:00Z' },
      { id: 2, projectId: 7, role: 'user', content: 'Make it warmer.', createdAt: '2026-07-14T00:01:00Z' },
    ];
    render(<ChatPanel projectId={7} initialMessages={history} />);

    expect(screen.getByText('Welcome back!')).toBeInTheDocument();
    expect(screen.getByText('Make it warmer.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a project with prior conversation is never rendered blank', () => {
    vi.stubGlobal('fetch', vi.fn());
    const history: ChatMessageDTO[] = [
      { id: 1, projectId: 7, role: 'assistant', content: 'Hi there', createdAt: '2026-07-14T00:00:00Z' },
    ];
    render(<ChatPanel projectId={7} initialMessages={history} />);
    expect(within(screen.getByTestId('chat-messages')).getByText('Hi there')).toBeInTheDocument();
  });

  it('skips empty-content bookkeeping rows (tool-call rounds persist role: assistant, content: "")', () => {
    vi.stubGlobal('fetch', vi.fn());
    const history: ChatMessageDTO[] = [
      { id: 1, projectId: 7, role: 'user', content: 'Generate an image', createdAt: '2026-07-14T00:00:00Z' },
      { id: 2, projectId: 7, role: 'assistant', content: '', toolCalls: [{ name: 'generate_image' }], createdAt: '2026-07-14T00:00:01Z' },
      { id: 3, projectId: 7, role: 'assistant', content: 'Done!', createdAt: '2026-07-14T00:00:02Z' },
    ];
    render(<ChatPanel projectId={7} initialMessages={history} />);
    const bubbles = within(screen.getByTestId('chat-messages')).getAllByText(/./);
    expect(bubbles.map((el) => el.textContent)).toEqual(['Generate an image', 'Done!']);
  });
});

describe('ChatPanel -- send + streamed TurnEvent rendering', () => {
  it('POSTs the message to /api/projects/:id/chat and renders the assistant reply from the message event', async () => {
    const frames = sseFrames([
      { type: 'status', status: 'started' },
      { type: 'message', content: 'Iteration 4 coming up.' },
      { type: 'status', status: 'completed' },
    ]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: fakeStreamBody([frames]) });
    vi.stubGlobal('fetch', fetchMock);

    render(<ChatPanel projectId={7} initialMessages={[]} />);

    fireEvent.change(screen.getByLabelText('Message Claude…'), { target: { value: 'Make it warmer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    // User bubble renders immediately (optimistic).
    expect(screen.getByText('Make it warmer')).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/7/chat',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Make it warmer', activeFace: 'front' }),
        }),
      );
    });

    await screen.findByText('Iteration 4 coming up.');
  });

  it('includes the activeFace prop in the POST body (Sprint 005 OOP change, 2026-07-15)', async () => {
    const frames = sseFrames([{ type: 'message', content: 'ok' }]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: fakeStreamBody([frames]) });
    vi.stubGlobal('fetch', fetchMock);

    render(<ChatPanel projectId={7} initialMessages={[]} activeFace="back" />);
    fireEvent.change(screen.getByLabelText('Message Claude…'), { target: { value: 'Add a QR code' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/7/chat',
        expect.objectContaining({
          body: JSON.stringify({ message: 'Add a QR code', activeFace: 'back' }),
        }),
      );
    });
    await screen.findByText('ok');
  });

  it('shows lightweight status text for tool_call_started/finished (search_catalog)', async () => {
    let resolveSecondRead: (value: { done: boolean; value?: Uint8Array }) => void;
    const encoder = new TextEncoder();
    const secondRead = new Promise<{ done: boolean; value?: Uint8Array }>((resolve) => {
      resolveSecondRead = resolve;
    });
    let callCount = 0;
    const body = {
      getReader() {
        return {
          read: async () => {
            callCount += 1;
            if (callCount === 1) {
              return {
                done: false,
                value: encoder.encode(
                  sseFrames([{ type: 'tool_call_started', callId: '1', name: 'search_catalog', args: {} }]),
                ),
              };
            }
            return secondRead;
          },
        };
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body }));

    render(<ChatPanel projectId={7} initialMessages={[]} />);
    fireEvent.change(screen.getByLabelText('Message Claude…'), { target: { value: 'Find robot photos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText('searching the library…');

    resolveSecondRead!({ done: true, value: undefined });

    // Let the stream's `finally` (sending -> false, statusText -> '') flush
    // before the test ends, so no state update lands outside act().
    await waitFor(() => expect(screen.queryByTestId('chat-status')).not.toBeInTheDocument());
  });

  it('clears the status text once the final message arrives', async () => {
    const frames = sseFrames([
      { type: 'tool_call_started', callId: '1', name: 'generate_image', args: {} },
      { type: 'tool_call_finished', callId: '1', name: 'generate_image', args: {}, result: {}, isError: false },
      { type: 'message', content: 'Here is the new iteration.' },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: fakeStreamBody([frames]) }));

    render(<ChatPanel projectId={7} initialMessages={[]} />);
    fireEvent.change(screen.getByLabelText('Message Claude…'), { target: { value: 'Draw a robot' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText('Here is the new iteration.');
    expect(screen.queryByTestId('chat-status')).not.toBeInTheDocument();
  });
});

describe('ChatPanel -- error surfacing (sprint success criteria: never silent)', () => {
  it('renders an error TurnEvent visibly rather than swallowing it', async () => {
    const frames = sseFrames([{ type: 'error', message: 'Turn for project 7 timed out waiting for a lock' }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: fakeStreamBody([frames]) }));

    render(<ChatPanel projectId={7} initialMessages={[]} />);
    fireEvent.change(screen.getByLabelText('Message Claude…'), { target: { value: 'Go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/timed out waiting for a lock/i);
  });

  it('renders a network-level failure (rejected fetch) visibly too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));

    render(<ChatPanel projectId={7} initialMessages={[]} />);
    fireEvent.change(screen.getByLabelText('Message Claude…'), { target: { value: 'Go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/failed to fetch/i);
  });
});

describe('ChatPanel -- never uses EventSource', () => {
  it('does not construct an EventSource when sending a message (POST endpoint, GET-only API)', async () => {
    const EventSourceSpy = vi.fn();
    vi.stubGlobal('EventSource', EventSourceSpy);
    const frames = sseFrames([{ type: 'message', content: 'ok' }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: fakeStreamBody([frames]) }));

    render(<ChatPanel projectId={7} initialMessages={[]} />);
    fireEvent.change(screen.getByLabelText('Message Claude…'), { target: { value: 'Go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText('ok');
    expect(EventSourceSpy).not.toHaveBeenCalled();
  });
});

describe('ChatPanel -- forwards tool_call_finished events (ticket 010 seam for LibraryDrawer)', () => {
  it('calls onToolCallFinished(name, result, isError) for every finished tool call, alongside its own status handling', async () => {
    const matches = [{ ownerType: 'asset', ownerId: 100, matchedVia: ['vector'], path: 'assets/logo-robot.png' }];
    const frames = sseFrames([
      { type: 'tool_call_finished', callId: '1', name: 'search_catalog', args: { query: 'robots' }, result: matches, isError: false },
      { type: 'message', content: 'Found some robots.' },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: fakeStreamBody([frames]) }));

    const onToolCallFinished = vi.fn();
    render(<ChatPanel projectId={7} initialMessages={[]} onToolCallFinished={onToolCallFinished} />);
    fireEvent.change(screen.getByLabelText('Message Claude…'), { target: { value: 'show me the robots' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText('Found some robots.');
    expect(onToolCallFinished).toHaveBeenCalledWith('search_catalog', matches, false);
  });

  it('is a no-op when the prop is omitted (every existing caller is unaffected)', async () => {
    const frames = sseFrames([
      { type: 'tool_call_finished', callId: '1', name: 'search_catalog', args: {}, result: [], isError: false },
      { type: 'message', content: 'ok' },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: fakeStreamBody([frames]) }));

    render(<ChatPanel projectId={7} initialMessages={[]} />);
    fireEvent.change(screen.getByLabelText('Message Claude…'), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText('ok');
  });
});

describe('ChatPanel -- auto-expanding composer (client-only OOP change, 2026-07-16)', () => {
  it('renders the composer as a textarea with the "Message Claude…" label', () => {
    vi.stubGlobal('fetch', vi.fn());
    render(<ChatPanel projectId={7} initialMessages={[]} />);

    const composer = screen.getByLabelText('Message Claude…');
    expect(composer.tagName).toBe('TEXTAREA');
  });

  it('Enter submits the message', async () => {
    const frames = sseFrames([{ type: 'message', content: 'ok' }]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: fakeStreamBody([frames]) });
    vi.stubGlobal('fetch', fetchMock);

    render(<ChatPanel projectId={7} initialMessages={[]} />);
    const composer = screen.getByLabelText('Message Claude…');
    fireEvent.change(composer, { target: { value: 'Make it warmer' } });

    const notPrevented = fireEvent.keyDown(composer, { key: 'Enter' });

    // fireEvent returns false when the event's default was prevented --
    // Enter-without-Shift must preventDefault() rather than just inserting
    // a newline, so the form doesn't also get a native submit.
    expect(notPrevented).toBe(false);
    expect(screen.getByText('Make it warmer')).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/7/chat',
        expect.objectContaining({
          body: JSON.stringify({ message: 'Make it warmer', activeFace: 'front' }),
        }),
      );
    });
    await screen.findByText('ok');
  });

  it('Shift+Enter does not submit (leaves the native newline-insertion behavior alone)', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<ChatPanel projectId={7} initialMessages={[]} />);
    const composer = screen.getByLabelText('Message Claude…') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: 'line one' } });

    const notPrevented = fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true });

    // Not prevented -- the browser is left free to insert the newline.
    expect(notPrevented).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    // Nothing was sent: the draft is still sitting in the composer, not
    // cleared and not rendered as a bubble in the message list.
    expect(composer.value).toBe('line one');
    expect(within(screen.getByTestId('chat-messages')).queryByText('line one')).not.toBeInTheDocument();
  });

  it('resets to its one-line height after sending', async () => {
    const frames = sseFrames([{ type: 'message', content: 'ok' }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: fakeStreamBody([frames]) }));

    render(<ChatPanel projectId={7} initialMessages={[]} />);
    const composer = screen.getByLabelText('Message Claude…') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: 'Line one\nLine two\nLine three' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText('ok');
    expect(composer.value).toBe('');
  });
});

describe('ChatPanel -- stage progress UI: spinner, label, elapsed-time ticker (ticket 006-003)', () => {
  it('renders a spinner and the stage label on a `stage` event', async () => {
    let resolveSecondRead: (value: { done: boolean; value?: Uint8Array }) => void;
    const encoder = new TextEncoder();
    const secondRead = new Promise<{ done: boolean; value?: Uint8Array }>((resolve) => {
      resolveSecondRead = resolve;
    });
    let callCount = 0;
    const body = {
      getReader() {
        return {
          read: async () => {
            callCount += 1;
            if (callCount === 1) {
              return {
                done: false,
                value: encoder.encode(
                  sseFrames([
                    { type: 'stage', stage: 'knowledge_retrieval', label: 'Consulting knowledge sources…', startedAt: Date.now() },
                  ]),
                ),
              };
            }
            return secondRead;
          },
        };
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body }));

    render(<ChatPanel projectId={7} initialMessages={[]} />);
    fireEvent.change(screen.getByLabelText('Message Claude…'), { target: { value: 'Go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText('Consulting knowledge sources…');
    expect(screen.getByTestId('chat-stage-spinner')).toBeInTheDocument();

    resolveSecondRead!({ done: true, value: undefined });
    await waitFor(() => expect(screen.queryByTestId('chat-stage')).not.toBeInTheDocument());
  });

  it('advances the elapsed-time display at least once per second, computed client-side, with no additional mock SSE frames', async () => {
    vi.useFakeTimers();
    try {
      let resolveSecondRead: (value: { done: boolean; value?: Uint8Array }) => void;
      const encoder = new TextEncoder();
      const secondRead = new Promise<{ done: boolean; value?: Uint8Array }>((resolve) => {
        resolveSecondRead = resolve;
      });
      let callCount = 0;
      const startedAt = Date.now();
      const body = {
        getReader() {
          return {
            read: async () => {
              callCount += 1;
              if (callCount === 1) {
                return {
                  done: false,
                  value: encoder.encode(
                    sseFrames([{ type: 'stage', stage: 'drafting', label: 'Drafting flyer content…', startedAt }]),
                  ),
                };
              }
              return secondRead;
            },
          };
        },
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body }));

      render(<ChatPanel projectId={7} initialMessages={[]} />);
      fireEvent.change(screen.getByLabelText('Message Claude…'), { target: { value: 'Go' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));

      // Let the fetch promise and first frame resolve before advancing timers.
      await vi.waitFor(() => expect(screen.getByTestId('chat-stage-elapsed')).toHaveTextContent('0s'));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(screen.getByTestId('chat-stage-elapsed')).toHaveTextContent('1s');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(screen.getByTestId('chat-stage-elapsed')).toHaveTextContent('2s');

      resolveSecondRead!({ done: true, value: undefined });
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders a generating_image stage label verbatim, without reformatting the call-index text', async () => {
    const frames = sseFrames([
      { type: 'stage', stage: 'generating_image', label: 'Generating image (#2)…', startedAt: Date.now() },
      { type: 'message', content: 'Here is the new iteration.' },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: fakeStreamBody([frames]) }));

    render(<ChatPanel projectId={7} initialMessages={[]} />);
    fireEvent.change(screen.getByLabelText('Message Claude…'), { target: { value: 'Go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText('Here is the new iteration.');
  });

  it('clears the spinner/stage line on the final `message` event', async () => {
    const frames = sseFrames([
      { type: 'stage', stage: 'drafting', label: 'Drafting flyer content…', startedAt: Date.now() },
      { type: 'message', content: 'Done.' },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: fakeStreamBody([frames]) }));

    render(<ChatPanel projectId={7} initialMessages={[]} />);
    fireEvent.change(screen.getByLabelText('Message Claude…'), { target: { value: 'Go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText('Done.');
    expect(screen.queryByTestId('chat-stage')).not.toBeInTheDocument();
  });

  it('clears the spinner/stage line on an `error` event, and the existing error path still renders (incl. a ticket-001 imaging timeout)', async () => {
    const frames = sseFrames([
      { type: 'stage', stage: 'generating_image', label: 'Generating image (#1)…', startedAt: Date.now() },
      {
        type: 'error',
        message: 'Image generation timed out after 300s waiting on OpenAI -- the upstream call never responded.',
      },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: fakeStreamBody([frames]) }));

    render(<ChatPanel projectId={7} initialMessages={[]} />);
    fireEvent.change(screen.getByLabelText('Message Claude…'), { target: { value: 'Go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/timed out after 300s waiting on OpenAI/i);
    expect(screen.queryByTestId('chat-stage')).not.toBeInTheDocument();
  });
});

describe('ChatPanel -- Markdown assistant bubbles (ticket 008-002, SUC-017)', () => {
  it('renders headings, lists, bold text, and a fenced code block in an assistant reply as formatted elements, not literal Markdown syntax', async () => {
    const markdown =
      '# Heading\n\nSome **bold** text.\n\n- list item\n\n```\ncode block\n```';
    const frames = sseFrames([{ type: 'message', content: markdown }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: fakeStreamBody([frames]) }));

    render(<ChatPanel projectId={7} initialMessages={[]} />);
    fireEvent.change(screen.getByLabelText('Message Claude…'), { target: { value: 'Go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    const messages = screen.getByTestId('chat-messages');
    await waitFor(() => expect(within(messages).getByRole('heading', { level: 1 })).toHaveTextContent('Heading'));
    expect(within(messages).getByRole('list')).toBeInTheDocument();
    expect(within(messages).getByText('list item').closest('li')).not.toBeNull();
    expect(within(messages).getByText('bold').tagName).toBe('STRONG');
    expect(within(messages).getByText('code block').closest('pre')).not.toBeNull();

    // No literal Markdown syntax characters leaked into the rendered text.
    expect(messages.textContent).not.toContain('# Heading');
    expect(messages.textContent).not.toContain('**bold**');
    expect(messages.textContent).not.toContain('```');
  });

  it('renders a plain-text assistant response identically to before, with no stray formatting artifacts', async () => {
    const frames = sseFrames([{ type: 'message', content: 'Here is the new iteration.' }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: fakeStreamBody([frames]) }));

    render(<ChatPanel projectId={7} initialMessages={[]} />);
    fireEvent.change(screen.getByLabelText('Message Claude…'), { target: { value: 'Go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText('Here is the new iteration.');
  });

  it('renders a user message containing Markdown-like syntax as literal text, not through the renderer', () => {
    vi.stubGlobal('fetch', vi.fn());
    const history: ChatMessageDTO[] = [
      { id: 1, projectId: 7, role: 'user', content: '**not bold**', createdAt: '2026-07-14T00:00:00Z' },
    ];
    render(<ChatPanel projectId={7} initialMessages={history} />);

    const bubble = screen.getByText('**not bold**');
    expect(bubble.tagName).toBe('SPAN');
    expect(bubble.querySelector('strong')).toBeNull();
  });

  it('renders raw HTML-like text in an assistant response as inert text, never as an executed tag (no rehype-raw, no dangerouslySetInnerHTML)', async () => {
    const payload = '<img src=x onerror=alert(1)>';
    const frames = sseFrames([{ type: 'message', content: payload }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: fakeStreamBody([frames]) }));

    render(<ChatPanel projectId={7} initialMessages={[]} />);
    fireEvent.change(screen.getByLabelText('Message Claude…'), { target: { value: 'Go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    const messages = screen.getByTestId('chat-messages');
    await waitFor(() => expect(messages.textContent).toContain('onerror=alert(1)'));
    expect(messages.querySelector('img')).toBeNull();
  });
});

describe('ChatPanel -- non-admin authenticated user can start and continue a turn', () => {
  it('sends a first message, then a follow-up, both via the same POST endpoint (role-agnostic client)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, body: fakeStreamBody([sseFrames([{ type: 'message', content: 'first reply' }])]) })
      .mockResolvedValueOnce({ ok: true, body: fakeStreamBody([sseFrames([{ type: 'message', content: 'second reply' }])]) });
    vi.stubGlobal('fetch', fetchMock);

    render(<ChatPanel projectId={7} initialMessages={[]} />);

    fireEvent.change(screen.getByLabelText('Message Claude…'), { target: { value: 'Start the project' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('first reply');

    fireEvent.change(screen.getByLabelText('Message Claude…'), { target: { value: 'Now make it bigger' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('second reply');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

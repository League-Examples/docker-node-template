import { useRef, useState } from 'react';
import { postSseStream } from '../../lib/sse';
import type { ChatMessageDTO } from './types';

/**
 * Bottom quarter of the right pane: the chat window (promoted from
 * `pages/mockups/MockupChatPanel.tsx`, ticket 005-009). Streams
 * `POST /api/projects/:id/chat` (Sprint 003 Agent Runtime, auth-gate
 * relaxed by ticket 006) via `postSseStream` (`lib/sse.ts`) --
 * **`EventSource` is never used here**: it is GET-only and this endpoint
 * is `POST` (confirmed during architecture review; see `lib/sse.ts`'s
 * module header).
 *
 * History rehydration (SUC-005): `initialMessages` comes straight from
 * `GET /api/projects/:id`'s `chatMessages` field (ticket 006) -- this
 * component makes no fetch of its own on mount, so a project with prior
 * conversation is never rendered blank.
 */

export type ChatBubbleFrom = 'user' | 'assistant';

export interface ChatBubble {
  id: string;
  from: ChatBubbleFrom;
  text: string;
}

interface ChatPanelProps {
  projectId: number;
  initialMessages: ChatMessageDTO[];
}

/** Turn-controller `TurnEvent` union (`server/src/agent/turn.ts`), typed
 * here rather than imported -- this is a client module, and the shape is a
 * plain JSON wire contract, not a shared package. Kept in sync by hand. */
type TurnEvent =
  | { type: 'status'; status: 'lock_wait' | 'started' | 'completed' }
  | { type: 'knowledge_consulted'; entries: unknown[] }
  | { type: 'tool_call_started'; callId: string; name: string; args: unknown }
  | { type: 'tool_call_finished'; callId: string; name: string; args: unknown; result: unknown; isError: boolean }
  | { type: 'message'; content: string }
  | { type: 'error'; message: string };

/** Lightweight status text for a subset of tool calls the stakeholder
 * called out by name (ticket 005-009 description) -- any other tool name
 * still gets a readable fallback rather than being silently dropped. */
const TOOL_STATUS_LABELS: Record<string, string> = {
  generate_image: 'generating image…',
  add_asset_to_collection: 'saving to library…',
  search_catalog: 'searching the library…',
};

function toolStatusLabel(name: string): string {
  return TOOL_STATUS_LABELS[name] ?? `${name.replace(/_/g, ' ')}…`;
}

/** Only `role: 'user'|'assistant'` rows with non-empty `content` render as
 * bubbles -- `runTurn` also persists `role: 'assistant'` bookkeeping rows
 * with `content: ''` for each tool-call round (`turn.ts`), which are not
 * conversational messages. */
function chatMessagesToBubbles(messages: ChatMessageDTO[]): ChatBubble[] {
  return messages
    .filter((message) => message.content && message.content.length > 0)
    .map((message) => ({
      id: `history-${message.id}`,
      from: message.role === 'user' ? 'user' : 'assistant',
      text: message.content,
    }));
}

export default function ChatPanel({ projectId, initialMessages }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatBubble[]>(() => chatMessagesToBubbles(initialMessages));
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState('');
  const nextLocalId = useRef(0);

  function appendBubble(from: ChatBubbleFrom, text: string) {
    nextLocalId.current += 1;
    setMessages((prev) => [...prev, { id: `local-${nextLocalId.current}`, from, text }]);
  }

  function handleTurnEvent(event: TurnEvent) {
    switch (event.type) {
      case 'status':
        if (event.status === 'lock_wait') setStatusText('Waiting for the previous turn to finish…');
        else if (event.status === 'started') setStatusText('Thinking…');
        else setStatusText('');
        break;
      case 'knowledge_consulted':
        setStatusText(
          `Consulted ${event.entries.length} knowledge ${event.entries.length === 1 ? 'entry' : 'entries'}…`,
        );
        break;
      case 'tool_call_started':
        setStatusText(toolStatusLabel(event.name));
        break;
      case 'tool_call_finished':
        setStatusText('');
        break;
      case 'message':
        setStatusText('');
        appendBubble('assistant', event.content);
        break;
      case 'error':
        // Sprint success criteria: "no unhandled agent-runtime failure
        // surfaced silently" -- always render it, never just log it.
        setStatusText('');
        setError(event.message);
        break;
    }
  }

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    setInput('');
    setError('');
    appendBubble('user', text);
    setSending(true);
    setStatusText('Sending…');

    try {
      await postSseStream<TurnEvent>(`/api/projects/${projectId}/chat`, { message: text }, handleTurnEvent);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reach the chat service');
    } finally {
      setSending(false);
      setStatusText('');
    }
  }

  return (
    <section className="flex flex-1 min-h-0 flex-col bg-white">
      <div data-testid="chat-messages" className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((message) => (
          <div key={message.id} className={message.from === 'user' ? 'text-right' : 'text-left'}>
            <span
              className={
                message.from === 'user'
                  ? 'inline-block max-w-[80%] rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white'
                  : 'inline-block max-w-[80%] rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-800'
              }
            >
              {message.text}
            </span>
          </div>
        ))}
      </div>

      {statusText && (
        <p data-testid="chat-status" className="px-4 pb-1 text-xs italic text-slate-400">
          {statusText}
        </p>
      )}
      {error && (
        <p role="alert" data-testid="chat-error" className="px-4 pb-1 text-xs font-semibold text-red-600">
          {error}
        </p>
      )}

      <form className="flex gap-2 border-t border-slate-200 p-3" onSubmit={(event) => void handleSend(event)}>
        <input
          type="text"
          aria-label="Message Claude…"
          placeholder="Message Claude…"
          value={input}
          disabled={sending}
          onChange={(event) => setInput(event.target.value)}
          className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm text-slate-800 disabled:bg-slate-50 disabled:text-slate-400"
        />
        <button
          type="submit"
          disabled={sending || input.trim().length === 0}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          Send
        </button>
      </form>
    </section>
  );
}

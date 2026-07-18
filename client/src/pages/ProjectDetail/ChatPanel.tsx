import { useEffect, useRef, useState } from 'react';
import { postSseStream } from '../../lib/sse';
import type { ChatMessageDTO } from './types';
import type { PostcardSide } from '../../lib/postcardFaceEditing';

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
 *
 * **Ticket 010 seam (SUC-015)**: the library drawer's conversational filter
 * needs to observe every `tool_call_finished` event this component already
 * parses out of the stream, without opening a second SSE connection. Rather
 * than exposing a separate hook/event-emitter, this component takes an
 * optional `onToolCallFinished` prop and calls it from the same
 * `handleTurnEvent` switch that already renders tool-call status text --
 * `ProjectDetail/index.tsx` forwards `search_catalog` results down to
 * `LibraryDrawer.tsx` from there. The stream itself is never duplicated:
 * `postSseStream` is still only ever invoked from `handleSend` below.
 *
 * **Ticket 011 (SUC-004)**: when `initialMessages` produces zero bubbles --
 * always true for a freshly-created project, since it has no chat history
 * yet -- this component renders a static, non-persisted empty-state bubble
 * matching `MockupNewProject.tsx`'s opening line (style / output type /
 * goal). This is a client-only placeholder, not a real turn: no
 * `POST /api/projects/:id/chat` fires on mount. It disappears the moment
 * `messages` gains its first real entry (the user's own first send, or a
 * real Claude opening message on a future reload).
 *
 * **`activeFace` (Sprint 005 OOP change, 2026-07-15)**: `index.tsx` passes
 * down whichever stream tab (Front/Back) is currently active; every send
 * includes it in the POST body (`{ message, activeFace }`) so
 * `routes/chat.ts`/`turn.ts` can tag any `generate_image` call this turn
 * makes into that same stream (`RunTurnInput.activeFace` -- "new
 * iterations join the currently-active tab's stream"). Required (not
 * optional) so a caller can never forget to wire it -- `ProjectDetail/
 * index.tsx` is this component's one remaining consumer now that
 * `pages/PostcardEdit.tsx` is deleted.
 *
 * **Floating layout (Sprint 005 OOP change, 2026-07-15)**: this
 * component's root `<section>` fills whatever height its parent gives it
 * (`h-full min-h-0`, not `flex-1`) -- `index.tsx` wraps it in a
 * fixed-height div pinned to the bottom of the page (see that file's
 * module header), rather than this component claiming remaining flex
 * space in a column layout the way it used to.
 *
 * **Auto-expanding composer (client-only OOP change, 2026-07-16)**: the
 * message box is a `<textarea>`, not an `<input>`, so it can grow to fit
 * multi-line drafts. `resizeComposer` (effect below, keyed on `input`)
 * resets the height to `'auto'` then re-measures `scrollHeight`, capping
 * it at `MAX_COMPOSER_LINES` worth of `line-height` -- past that cap the
 * box stops growing and scrolls internally instead. Because the effect is
 * keyed on `input`, clearing it after a send (`setInput('')`) also snaps
 * the box back to its one-line height. `Enter` submits (`preventDefault`
 * + `sendMessage()`); `Shift+Enter` is left alone so the textarea's own
 * native newline-insertion behavior applies.
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
  /** Ticket 010: invoked for every `tool_call_finished` event, alongside
   * (not instead of) this component's own status-text handling. Optional
   * so every existing test/caller that doesn't care about tool calls is
   * unaffected. */
  onToolCallFinished?: (name: string, result: unknown, isError: boolean) => void;
  /** Sprint 005 OOP change, 2026-07-15: which stream tab is active --
   * included in every `POST /api/projects/:id/chat` body so a
   * `generate_image` call this turn makes tags its new Iteration into that
   * stream. See this file's own module header. Optional, defaulting to
   * `'front'` (matching "a new project starts on Front" and the server's
   * own `activeFace ?? 'front'` fallback) so every pre-existing test/caller
   * that doesn't care about stream tagging is unaffected. */
  activeFace?: PostcardSide;
}

/** Turn-controller `TurnEvent` union (`server/src/agent/turn.ts`), typed
 * here rather than imported -- this is a client module, and the shape is a
 * plain JSON wire contract, not a shared package. Kept in sync by hand. */
type TurnEvent =
  | { type: 'status'; status: 'lock_wait' | 'started' | 'completed' }
  | { type: 'knowledge_consulted'; entries: unknown[] }
  | { type: 'stage'; stage: string; label: string; startedAt: number }
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

/** Ticket 011 (SUC-004): the same guideline-questions opening line
 * `mockupStubData.ts`'s `STUB_NEW_PROJECT_CHAT_MESSAGES` used, shown as a
 * static empty-state prompt whenever there's no chat history yet -- see
 * this component's header comment. */
const EMPTY_STATE_PROMPT =
  "Let's start your new project. What style are you going for, what kind of output do you need — a Facebook " +
  'image, a logo, or a postcard — and what are you trying to achieve?';

/** Composer auto-resize cap (client-only OOP change, 2026-07-16): the
 * textarea grows to fit its content up to this many lines, then stops
 * growing and scrolls internally -- see this file's module header. */
const MAX_COMPOSER_LINES = 10;

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

export default function ChatPanel({ projectId, initialMessages, onToolCallFinished, activeFace = 'front' }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatBubble[]>(() => chatMessagesToBubbles(initialMessages));
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState('');
  // Ticket 006-003: the active turn stage (spinner + label + elapsed-time
  // ticker), driven by `stage` TurnEvents (ticket 006-002). Independent of
  // `statusText` above -- `statusText` keeps its pre-existing
  // clear-on-every-event behavior (tool_call_started/finished included) for
  // the tests that already assert that, while `stage` only clears on
  // `message`/`error` (ticket's acceptance criteria) so a long-running stage
  // like "Generating image (#2)…" stays visible across its tool-call's
  // started/finished events, not just until the next one.
  const [stage, setStage] = useState<{ stage: string; label: string; startedAt: number } | null>(null);
  // Forces a re-render at least once per second while a stage is active, so
  // the elapsed-time display (computed as `nowTick - stage.startedAt`)
  // ticks locally without any additional SSE frames.
  const [nowTick, setNowTick] = useState(() => Date.now());
  const nextLocalId = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!stage) return;
    setNowTick(Date.now());
    const interval = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [stage]);

  const elapsedSeconds = stage ? Math.max(0, Math.floor((nowTick - stage.startedAt) / 1000)) : 0;

  // Auto-resize the composer: reset to 'auto' then re-measure scrollHeight,
  // capping at MAX_COMPOSER_LINES worth of line-height. Keyed on `input`
  // so clearing it after a send also snaps the box back to one line.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const computed = window.getComputedStyle(el);
    const lineHeight = parseFloat(computed.lineHeight) || 20;
    const verticalExtra =
      (parseFloat(computed.paddingTop) || 0) +
      (parseFloat(computed.paddingBottom) || 0) +
      (parseFloat(computed.borderTopWidth) || 0) +
      (parseFloat(computed.borderBottomWidth) || 0);
    const maxHeight = lineHeight * MAX_COMPOSER_LINES + verticalExtra;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [input]);

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
      case 'stage':
        setStage({ stage: event.stage, label: event.label, startedAt: event.startedAt });
        break;
      case 'tool_call_started':
        setStatusText(toolStatusLabel(event.name));
        break;
      case 'tool_call_finished':
        setStatusText('');
        onToolCallFinished?.(event.name, event.result, event.isError);
        break;
      case 'message':
        setStatusText('');
        setStage(null);
        appendBubble('assistant', event.content);
        break;
      case 'error':
        // Sprint success criteria: "no unhandled agent-runtime failure
        // surfaced silently" -- always render it, never just log it.
        setStatusText('');
        setStage(null);
        setError(event.message);
        break;
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;

    setInput('');
    setError('');
    appendBubble('user', text);
    setSending(true);
    setStatusText('Sending…');

    try {
      await postSseStream<TurnEvent>(`/api/projects/${projectId}/chat`, { message: text, activeFace }, handleTurnEvent);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reach the chat service');
    } finally {
      setSending(false);
      setStatusText('');
      setStage(null);
    }
  }

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    await sendMessage();
  }

  // Enter submits; Shift+Enter is left alone so the textarea's native
  // newline-insertion behavior applies (see this file's module header).
  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-white">
      <div data-testid="chat-messages" className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div data-testid="chat-empty-state" className="text-left">
            <span className="inline-block max-w-[80%] rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-800">
              {EMPTY_STATE_PROMPT}
            </span>
          </div>
        )}
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

      {stage && (
        <p data-testid="chat-stage" className="flex items-center gap-2 px-4 pb-1 text-xs italic text-slate-400">
          <span
            data-testid="chat-stage-spinner"
            aria-hidden="true"
            className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600"
          />
          <span>{stage.label}</span>
          <span data-testid="chat-stage-elapsed">{elapsedSeconds}s</span>
        </p>
      )}
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
        <textarea
          ref={textareaRef}
          aria-label="Message Claude…"
          placeholder="Message Claude…"
          value={input}
          disabled={sending}
          rows={1}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          className="flex-1 resize-none rounded border border-slate-300 px-3 py-2 text-sm text-slate-800 disabled:bg-slate-50 disabled:text-slate-400"
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

import { STUB_CHAT_MESSAGES } from './mockupStubData';
import type { ChatMessage } from './mockupStubData';

interface MockupChatPanelProps {
  /** Defaults to STUB_CHAT_MESSAGES so /mockups/main is unaffected. */
  messages?: ChatMessage[];
}

/**
 * Bottom quarter of the right pane: the chat window (spec §2). Most of the
 * application is meant to be driven by this conversation surface rather
 * than buttons (spec §11) — the mockup only needs to establish the
 * structural slot, not working chat behavior.
 */
export default function MockupChatPanel({ messages = STUB_CHAT_MESSAGES }: MockupChatPanelProps) {
  return (
    <section className="flex flex-1 min-h-0 flex-col bg-white">
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((message) => (
          <div
            key={message.id}
            className={message.from === 'user' ? 'text-right' : 'text-left'}
          >
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

      <form
        className="flex gap-2 border-t border-slate-200 p-3"
        onSubmit={(event) => event.preventDefault()}
      >
        <input
          type="text"
          placeholder="Message Claude…"
          disabled
          className="flex-1 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-400"
        />
        <button
          type="submit"
          disabled
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          Send
        </button>
      </form>
    </section>
  );
}

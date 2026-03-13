import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

// ---- Types ----

interface Channel {
  id: number;
  name: string;
  description: string | null;
  messageCount: number;
}

interface MessageAuthor {
  id: number;
  displayName: string;
  avatarUrl: string | null;
}

interface Message {
  id: number;
  content: string;
  createdAt: string;
  author: MessageAuthor;
}

// ---- Helpers ----

/** Generate a deterministic color from a string (for avatar circles). */
function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 55%, 45%)`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ---- Component ----

export default function Chat() {
  const { user } = useAuth();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  // ---- Track scroll position ----
  const handleScroll = useCallback(() => {
    const el = feedRef.current;
    if (!el) return;
    const threshold = 40;
    isAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  // ---- Auto-scroll when new messages arrive ----
  useEffect(() => {
    if (isAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // ---- Fetch channels on mount ----
  useEffect(() => {
    fetch('/api/channels')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: Channel[]) => {
        setChannels(data);
        if (data.length > 0) {
          const general = data.find((c) => c.name === 'general');
          setSelectedChannelId(general ? general.id : data[0].id);
        }
      })
      .catch(() => setError('Failed to load channels'));
  }, []);

  // ---- Fetch messages on channel change + SSE for real-time updates ----
  useEffect(() => {
    if (selectedChannelId === null) return;

    let cancelled = false;

    // Initial fetch to load existing messages
    async function fetchMessages() {
      try {
        const res = await fetch(`/api/channels/${selectedChannelId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setMessages(data.messages);
        }
      } catch {
        // Silently ignore fetch errors
      }
    }

    fetchMessages();

    // SSE for real-time updates
    const es = new EventSource(`/api/channels/${selectedChannelId}/events`);
    es.addEventListener('message', (e) => {
      if (cancelled) return;
      try {
        const msg: Message = JSON.parse(e.data);
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      } catch {
        // Ignore malformed events
      }
    });

    return () => {
      cancelled = true;
      es.close();
    };
  }, [selectedChannelId]);

  // ---- Send message ----
  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || selectedChannelId === null || sending) return;

    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/channels/${selectedChannelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const newMsg: Message = await res.json();
      setMessages((prev) => {
        // Deduplicate
        if (prev.some((m) => m.id === newMsg.id)) return prev;
        return [...prev, newMsg];
      });
      setInput('');
      isAtBottomRef.current = true;
    } catch (err: any) {
      setError(err.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleCreateChannel() {
    const name = newChannelName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (!name) return;
    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const created: Channel = await res.json();
      setChannels((prev) => [...prev, { ...created, messageCount: 0 }]);
      setSelectedChannelId(created.id);
      setNewChannelName('');
      setShowNewChannel(false);
    } catch (err: any) {
      setError(err.message || 'Failed to create channel');
    }
  }

  const selectedChannel = channels.find((c) => c.id === selectedChannelId);

  // ---- Render ----
  return (
    <div style={styles.container}>
      {/* Channel list panel */}
      <div style={styles.channelPanel}>
        <h3 style={styles.channelPanelTitle}>Channels</h3>
        {channels.length === 0 && !error && (
          <p style={styles.channelEmpty}>No channels yet</p>
        )}
        {channels.map((ch) => (
          <button
            key={ch.id}
            style={{
              ...styles.channelBtn,
              ...(ch.id === selectedChannelId ? styles.channelBtnActive : {}),
            }}
            onClick={() => setSelectedChannelId(ch.id)}
          >
            <span style={styles.channelName}># {ch.name}</span>
            <span style={styles.channelCount}>{ch.messageCount}</span>
          </button>
        ))}

        {/* New channel */}
        <div style={{ padding: '0.5rem 0.75rem', marginTop: '0.25rem' }}>
          {showNewChannel ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <input
                type="text"
                placeholder="channel-name"
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateChannel(); if (e.key === 'Escape') setShowNewChannel(false); }}
                style={{ padding: '0.35rem 0.5rem', fontSize: '0.8rem', border: '1px solid #d1d5db', borderRadius: 4, fontFamily: 'inherit' }}
                autoFocus
              />
              <div style={{ display: 'flex', gap: '0.35rem' }}>
                <button onClick={handleCreateChannel} style={{ flex: 1, padding: '0.3rem', fontSize: '0.75rem', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Create</button>
                <button onClick={() => setShowNewChannel(false)} style={{ flex: 1, padding: '0.3rem', fontSize: '0.75rem', background: '#e2e8f0', color: '#333', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowNewChannel(true)}
              style={{ width: '100%', padding: '0.35rem', fontSize: '0.8rem', background: 'transparent', color: '#64748b', border: '1px dashed #cbd5e1', borderRadius: 4, cursor: 'pointer' }}
            >
              + New Channel
            </button>
          )}
        </div>
      </div>

      {/* Main chat area */}
      <div style={styles.chatArea}>
        {/* Header */}
        <div style={styles.chatHeader}>
          <h2 style={styles.chatHeaderTitle}>
            {selectedChannel ? `# ${selectedChannel.name}` : 'Select a channel'}
          </h2>
          {selectedChannel?.description && (
            <span style={styles.chatHeaderDesc}>{selectedChannel.description}</span>
          )}
        </div>

        {/* Message feed */}
        <div style={styles.feed} ref={feedRef} onScroll={handleScroll}>
          {messages.length === 0 && (
            <p style={styles.emptyState}>No messages yet. Start the conversation!</p>
          )}
          {messages.map((msg) => {
            const initial = (msg.author.displayName || '?')[0].toUpperCase();
            const avatarColor = stringToColor(msg.author.displayName || 'unknown');
            const isCurrentUser = user && msg.author.id === user.id;
            return (
              <div key={msg.id} style={styles.message}>
                <div
                  style={{
                    ...styles.avatar,
                    backgroundColor: avatarColor,
                  }}
                >
                  {initial}
                </div>
                <div style={styles.messageBody}>
                  <div style={styles.messageMeta}>
                    <span
                      style={{
                        ...styles.messageAuthor,
                        ...(isCurrentUser ? { color: '#4f46e5' } : {}),
                      }}
                    >
                      {msg.author.displayName}
                    </span>
                    <span style={styles.messageTime}>
                      {formatTimestamp(msg.createdAt)}
                    </span>
                  </div>
                  <p style={styles.messageContent}>{msg.content}</p>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Error */}
        {error && <p style={styles.error}>{error}</p>}

        {/* Input */}
        <div style={styles.inputRow}>
          <input
            type="text"
            style={styles.input}
            placeholder={
              selectedChannel
                ? `Message #${selectedChannel.name}`
                : 'Select a channel...'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={selectedChannelId === null || sending}
          />
          <button
            style={{
              ...styles.sendBtn,
              ...(sending || !input.trim() ? styles.sendBtnDisabled : {}),
            }}
            onClick={handleSend}
            disabled={sending || !input.trim() || selectedChannelId === null}
          >
            {sending ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Styles ----

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    height: 'calc(100vh - 52px - 48px)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    border: '1px solid #e0e0e0',
    borderRadius: 8,
    overflow: 'hidden',
    margin: '-24px',
  },
  channelPanel: {
    width: 200,
    minWidth: 200,
    background: '#f8fafc',
    borderRight: '1px solid #e0e0e0',
    padding: '0.75rem 0',
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
  },
  channelPanelTitle: {
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#94a3b8',
    padding: '0 0.75rem',
    marginBottom: '0.5rem',
    marginTop: 0,
    fontWeight: 600,
  },
  channelEmpty: {
    fontSize: '0.85rem',
    color: '#94a3b8',
    padding: '0 0.75rem',
  },
  channelBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '0.4rem 0.75rem',
    border: 'none',
    background: 'transparent',
    color: '#475569',
    cursor: 'pointer',
    textAlign: 'left',
    fontSize: '0.85rem',
  },
  channelBtnActive: {
    background: '#e0e7ff',
    color: '#4f46e5',
    fontWeight: 600,
  },
  channelName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  channelCount: {
    fontSize: '0.7rem',
    color: '#94a3b8',
    marginLeft: '0.5rem',
    flexShrink: 0,
  },
  chatArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    background: '#ffffff',
    minWidth: 0,
  },
  chatHeader: {
    padding: '0.75rem 1.25rem',
    borderBottom: '1px solid #e0e0e0',
    display: 'flex',
    alignItems: 'baseline',
    gap: '0.75rem',
  },
  chatHeaderTitle: {
    fontSize: '1.1rem',
    margin: 0,
    fontWeight: 600,
  },
  chatHeaderDesc: {
    fontSize: '0.85rem',
    color: '#888',
  },
  feed: {
    flex: 1,
    overflowY: 'auto',
    padding: '1rem 1.25rem',
  },
  emptyState: {
    textAlign: 'center',
    color: '#aaa',
    marginTop: '2rem',
  },
  message: {
    display: 'flex',
    gap: '0.75rem',
    marginBottom: '1rem',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#ffffff',
    fontWeight: 700,
    fontSize: '0.85rem',
    flexShrink: 0,
  },
  messageBody: {
    minWidth: 0,
  },
  messageMeta: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '0.5rem',
  },
  messageAuthor: {
    fontWeight: 600,
    fontSize: '0.9rem',
  },
  messageTime: {
    fontSize: '0.75rem',
    color: '#999',
  },
  messageContent: {
    margin: '0.15rem 0 0',
    fontSize: '0.9rem',
    lineHeight: 1.45,
    wordBreak: 'break-word',
  },
  error: {
    color: '#dc2626',
    fontSize: '0.85rem',
    padding: '0 1.25rem',
    margin: '0.25rem 0',
  },
  inputRow: {
    display: 'flex',
    gap: '0.5rem',
    padding: '0.75rem 1.25rem',
    borderTop: '1px solid #e0e0e0',
    background: '#fafafa',
  },
  input: {
    flex: 1,
    padding: '0.6rem 0.75rem',
    fontSize: '0.9rem',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    outline: 'none',
    fontFamily: 'inherit',
  },
  sendBtn: {
    padding: '0.6rem 1.25rem',
    fontSize: '0.9rem',
    border: 'none',
    borderRadius: 8,
    background: '#4f46e5',
    color: '#ffffff',
    cursor: 'pointer',
    fontWeight: 600,
  },
  sendBtnDisabled: {
    background: '#a5b4fc',
    cursor: 'not-allowed',
  },
};

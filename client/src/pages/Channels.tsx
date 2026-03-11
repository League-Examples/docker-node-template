import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { hasAdminAccess } from '../lib/roles';

// ---- Types ----

interface Channel {
  id: number;
  name: string;
  description: string | null;
  messageCount: number;
  createdAt: string;
}

// ---- Component ----

export default function Channels() {
  const { user, loading: authLoading } = useAuth();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const isAdmin = user ? hasAdminAccess(user.role) : false;

  // ---- Fetch channels ----
  async function fetchChannels() {
    try {
      const res = await fetch('/api/channels');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Channel[] = await res.json();
      setChannels(data);
    } catch {
      setError('Failed to load channels');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchChannels();
  }, []);

  // ---- Create channel ----
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError('Channel name is required');
      return;
    }

    setCreating(true);
    setFormError(null);
    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          description: description.trim() || undefined,
        }),
      });
      if (res.status === 409) {
        setFormError('A channel with that name already exists');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const newChannel: Channel = await res.json();
      setChannels((prev) => [...prev, newChannel]);
      setName('');
      setDescription('');
    } catch (err: any) {
      setFormError(err.message || 'Failed to create channel');
    } finally {
      setCreating(false);
    }
  }

  // ---- Delete channel ----
  async function handleDelete(channel: Channel) {
    const confirmed = window.confirm(
      `Delete #${channel.name}? This will remove all messages in this channel.`
    );
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/channels/${channel.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setChannels((prev) => prev.filter((c) => c.id !== channel.id));
    } catch (err: any) {
      setError(err.message || 'Failed to delete channel');
    }
  }

  // ---- Access check ----
  if (authLoading) {
    return (
      <div style={styles.container}>
        <p style={styles.hint}>Loading...</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div style={styles.container}>
        <div style={styles.accessDenied}>
          <h2 style={{ margin: '0 0 0.5rem' }}>Access Denied</h2>
          <p style={{ margin: 0, color: '#666' }}>
            You must be an administrator to manage channels.
          </p>
        </div>
      </div>
    );
  }

  // ---- Render ----
  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Manage Channels</h1>

      {/* Create form */}
      <form style={styles.card} onSubmit={handleCreate}>
        <h3 style={{ margin: '0 0 0.75rem' }}>Create Channel</h3>
        <div style={styles.formRow}>
          <input
            type="text"
            placeholder="Channel name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={styles.input}
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ ...styles.input, flex: 2 }}
          />
          <button type="submit" style={styles.btn} disabled={creating}>
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
        {formError && <p style={styles.error}>{formError}</p>}
      </form>

      {/* Error */}
      {error && <p style={styles.error}>{error}</p>}

      {/* Channel list */}
      {loading ? (
        <p style={styles.hint}>Loading channels...</p>
      ) : channels.length === 0 ? (
        <p style={styles.hint}>No channels yet. Create one above.</p>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Description</th>
              <th style={styles.th}>Messages</th>
              <th style={styles.th}>Created</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {channels.map((ch) => (
              <tr key={ch.id}>
                <td style={styles.td}>
                  <strong># {ch.name}</strong>
                </td>
                <td style={{ ...styles.td, color: ch.description ? '#333' : '#aaa' }}>
                  {ch.description || 'No description'}
                </td>
                <td style={styles.td}>{ch.messageCount}</td>
                <td style={styles.td}>
                  {new Date(ch.createdAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </td>
                <td style={styles.td}>
                  <button
                    style={styles.deleteBtn}
                    onClick={() => handleDelete(ch)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---- Styles ----

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 900,
    margin: '40px auto',
    padding: '0 1rem',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  title: {
    fontSize: '2rem',
    marginBottom: '1.5rem',
  },
  card: {
    padding: '1.25rem',
    border: '1px solid #e0e0e0',
    borderRadius: 12,
    background: '#fafafa',
    marginBottom: '1.5rem',
  },
  formRow: {
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  input: {
    flex: 1,
    minWidth: 150,
    padding: '0.6rem 0.75rem',
    fontSize: '0.9rem',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    outline: 'none',
    fontFamily: 'inherit',
  },
  btn: {
    fontSize: '0.9rem',
    padding: '0.6rem 1.25rem',
    border: 'none',
    borderRadius: 8,
    background: '#4f46e5',
    color: '#ffffff',
    cursor: 'pointer',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  deleteBtn: {
    fontSize: '0.8rem',
    padding: '0.35rem 0.75rem',
    border: 'none',
    borderRadius: 6,
    background: '#dc2626',
    color: '#ffffff',
    cursor: 'pointer',
  },
  error: {
    color: '#dc2626',
    fontSize: '0.85rem',
    marginTop: '0.5rem',
  },
  hint: {
    color: '#888',
    fontSize: '0.85rem',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.9rem',
  },
  th: {
    textAlign: 'left',
    padding: '0.6rem 0.75rem',
    borderBottom: '2px solid #ddd',
    fontWeight: 600,
    fontSize: '0.8rem',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    color: '#666',
  },
  td: {
    padding: '0.6rem 0.75rem',
    borderBottom: '1px solid #eee',
    verticalAlign: 'middle',
  },
  accessDenied: {
    textAlign: 'center',
    padding: '3rem',
    border: '1px solid #fca5a5',
    borderRadius: 12,
    background: '#fef2f2',
    marginTop: '2rem',
  },
};

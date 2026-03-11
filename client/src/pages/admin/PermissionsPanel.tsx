import { useEffect, useState } from 'react';

interface Pattern {
  id: number;
  matchType: string;
  pattern: string;
  role: string;
  createdAt: string;
}

export default function PermissionsPanel() {
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Add form state
  const [newMatchType, setNewMatchType] = useState('exact');
  const [newPattern, setNewPattern] = useState('');
  const [newRole, setNewRole] = useState('USER');
  const [adding, setAdding] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editMatchType, setEditMatchType] = useState('');
  const [editPattern, setEditPattern] = useState('');
  const [editRole, setEditRole] = useState('');
  const [saving, setSaving] = useState(false);

  const loadPatterns = async () => {
    try {
      const res = await fetch('/api/admin/permissions/patterns');
      if (!res.ok) throw new Error('Failed to load patterns');
      const data = await res.json();
      setPatterns(data);
      setError('');
    } catch {
      setError('Failed to load patterns');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPatterns();
  }, []);

  const handleAdd = async () => {
    if (!newPattern.trim()) {
      setError('Pattern is required');
      return;
    }
    setAdding(true);
    setError('');
    try {
      const res = await fetch('/api/admin/permissions/patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchType: newMatchType, pattern: newPattern, role: newRole }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to create pattern');
        return;
      }
      setNewPattern('');
      setNewMatchType('exact');
      setNewRole('USER');
      await loadPatterns();
    } catch {
      setError('Network error');
    } finally {
      setAdding(false);
    }
  };

  const handleEdit = (p: Pattern) => {
    setEditingId(p.id);
    setEditMatchType(p.matchType);
    setEditPattern(p.pattern);
    setEditRole(p.role);
    setError('');
  };

  const handleSave = async () => {
    if (editingId === null) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/permissions/patterns/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchType: editMatchType, pattern: editPattern, role: editRole }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to update pattern');
        return;
      }
      setEditingId(null);
      await loadPatterns();
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this pattern?')) return;
    setError('');
    try {
      const res = await fetch(`/api/admin/permissions/patterns/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const data = await res.json();
        setError(data.error || 'Failed to delete pattern');
        return;
      }
      await loadPatterns();
    } catch {
      setError('Network error');
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h1>Permissions</h1>
      <p style={{ color: '#666', fontSize: 13, marginBottom: 16 }}>
        Role assignment patterns determine which role a user receives when they sign in.
        Exact matches are checked first, then regex patterns in creation order.
      </p>

      {error && (
        <div style={{
          padding: '10px 16px',
          marginBottom: 16,
          borderRadius: 4,
          background: '#fce8e6',
          color: '#c5221f',
          border: '1px solid #ea4335',
        }}>
          {error}
        </div>
      )}

      {/* Add pattern form */}
      <div style={{
        border: '1px solid #ddd',
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
      }}>
        <h3 style={{ marginTop: 0 }}>Add Pattern</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Match Type</label>
            <select
              value={newMatchType}
              onChange={(e) => setNewMatchType(e.target.value)}
              style={{ padding: '6px 8px' }}
            >
              <option value="exact">exact</option>
              <option value="regex">regex</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Pattern</label>
            <input
              type="text"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              placeholder={newMatchType === 'exact' ? 'user@example.com' : '@example\\.com$'}
              style={{ width: '100%', padding: '6px 8px', fontFamily: 'monospace', fontSize: 13, boxSizing: 'border-box' }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Role</label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              style={{ padding: '6px 8px' }}
            >
              <option value="USER">USER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </div>
          <button
            onClick={handleAdd}
            disabled={adding}
            style={{ padding: '6px 16px', cursor: adding ? 'default' : 'pointer' }}
          >
            {adding ? 'Adding...' : 'Add'}
          </button>
        </div>
      </div>

      {/* Patterns table */}
      <div style={{
        border: '1px solid #ddd',
        borderRadius: 8,
        padding: 16,
      }}>
        <h3 style={{ marginTop: 0 }}>Patterns</h3>
        {patterns.length === 0 ? (
          <p style={{ color: '#999' }}>No patterns configured.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
                <th style={{ padding: '8px 8px 8px 0' }}>Match Type</th>
                <th style={{ padding: 8 }}>Pattern</th>
                <th style={{ padding: 8 }}>Role</th>
                <th style={{ padding: 8 }}>Created</th>
                <th style={{ padding: '8px 0 8px 8px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {patterns.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                  {editingId === p.id ? (
                    <>
                      <td style={{ padding: '8px 8px 8px 0' }}>
                        <select
                          value={editMatchType}
                          onChange={(e) => setEditMatchType(e.target.value)}
                          style={{ padding: '4px 6px' }}
                        >
                          <option value="exact">exact</option>
                          <option value="regex">regex</option>
                        </select>
                      </td>
                      <td style={{ padding: 8 }}>
                        <input
                          type="text"
                          value={editPattern}
                          onChange={(e) => setEditPattern(e.target.value)}
                          style={{ width: '100%', padding: '4px 6px', fontFamily: 'monospace', fontSize: 13, boxSizing: 'border-box' }}
                        />
                      </td>
                      <td style={{ padding: 8 }}>
                        <select
                          value={editRole}
                          onChange={(e) => setEditRole(e.target.value)}
                          style={{ padding: '4px 6px' }}
                        >
                          <option value="USER">USER</option>
                          <option value="ADMIN">ADMIN</option>
                        </select>
                      </td>
                      <td style={{ padding: 8, color: '#999', fontSize: 13 }}>
                        {new Date(p.createdAt).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '8px 0 8px 8px', textAlign: 'right' }}>
                        <button
                          onClick={handleSave}
                          disabled={saving}
                          style={{ marginRight: 4, cursor: saving ? 'default' : 'pointer' }}
                        >
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          style={{ cursor: 'pointer' }}
                        >
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: '8px 8px 8px 0' }}>
                        <span style={{
                          fontSize: 11,
                          padding: '2px 6px',
                          borderRadius: 3,
                          background: p.matchType === 'exact' ? '#e3f2fd' : '#f3e5f5',
                          color: p.matchType === 'exact' ? '#1565c0' : '#7b1fa2',
                          fontWeight: 600,
                        }}>
                          {p.matchType}
                        </span>
                      </td>
                      <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 13 }}>
                        {p.pattern}
                      </td>
                      <td style={{ padding: 8 }}>
                        <span style={{
                          fontSize: 11,
                          padding: '2px 6px',
                          borderRadius: 3,
                          background: p.role === 'ADMIN' ? '#fff3e0' : '#e8f5e9',
                          color: p.role === 'ADMIN' ? '#e65100' : '#2e7d32',
                          fontWeight: 600,
                        }}>
                          {p.role}
                        </span>
                      </td>
                      <td style={{ padding: 8, color: '#999', fontSize: 13 }}>
                        {new Date(p.createdAt).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '8px 0 8px 8px', textAlign: 'right' }}>
                        <button
                          onClick={() => handleEdit(p)}
                          style={{ marginRight: 4, cursor: 'pointer' }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(p.id)}
                          style={{ cursor: 'pointer', color: '#c5221f' }}
                        >
                          Delete
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

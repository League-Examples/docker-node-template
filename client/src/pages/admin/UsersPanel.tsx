import { useState, useEffect } from 'react';

interface UserProvider {
  provider: string;
}

interface AdminUser {
  id: number;
  email: string;
  displayName: string | null;
  role: string;
  provider: string | null;
  providers: UserProvider[];
  createdAt: string;
}

const GITHUB_LOGO =
  'https://github.githubassets.com/favicons/favicon-dark.svg';
const GOOGLE_LOGO =
  'https://www.google.com/favicon.ico';

function ProviderBadge({ provider }: { provider: string }) {
  if (provider === 'github') {
    return (
      <img
        src={GITHUB_LOGO}
        alt="GitHub"
        title="GitHub"
        style={{ width: 18, height: 18, verticalAlign: 'middle' }}
      />
    );
  }
  if (provider === 'google') {
    return (
      <img
        src={GOOGLE_LOGO}
        alt="Google"
        title="Google"
        style={{ width: 18, height: 18, verticalAlign: 'middle' }}
      />
    );
  }
  return (
    <span
      title={provider}
      style={{
        fontSize: 11,
        padding: '2px 6px',
        background: '#e2e8f0',
        borderRadius: 4,
        color: '#475569',
      }}
    >
      {provider}
    </span>
  );
}

export default function UsersPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState<number | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  async function fetchUsers() {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setUsers(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  async function toggleAdmin(user: AdminUser) {
    const newRole = user.role === 'ADMIN' ? 'USER' : 'ADMIN';
    setUpdating(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = await res.json();
      setUsers((prev) =>
        prev.map((u) => (u.id === updated.id ? { ...u, role: updated.role } : u)),
      );
    } catch (err: any) {
      setError(err.message || 'Failed to update user');
    } finally {
      setUpdating(null);
    }
  }

  function getProviders(user: AdminUser): string[] {
    const set = new Set<string>();
    if (user.providers) {
      for (const p of user.providers) set.add(p.provider);
    }
    if (user.provider && !set.has(user.provider)) {
      set.add(user.provider);
    }
    return Array.from(set);
  }

  if (loading) return <p>Loading users...</p>;
  if (error) return <p style={{ color: '#dc2626' }}>{error}</p>;

  return (
    <div>
      <h2 style={{ margin: '0 0 16px', fontSize: 20 }}>Users</h2>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Name</th>
            <th style={thStyle}>Email</th>
            <th style={thStyle}>Providers</th>
            <th style={thStyle}>Admin</th>
            <th style={thStyle}>Joined</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const providers = getProviders(user);
            return (
              <tr key={user.id}>
                <td style={tdStyle}>{user.displayName || '-'}</td>
                <td style={tdStyle}>{user.email}</td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {providers.length === 0 && (
                      <span style={{ color: '#94a3b8', fontSize: 13 }}>none</span>
                    )}
                    {providers.map((p) => (
                      <ProviderBadge key={p} provider={p} />
                    ))}
                  </div>
                </td>
                <td style={tdStyle}>
                  <input
                    type="checkbox"
                    checked={user.role === 'ADMIN'}
                    disabled={updating === user.id}
                    onChange={() => toggleAdmin(user)}
                    style={{ cursor: 'pointer', width: 16, height: 16 }}
                  />
                </td>
                <td style={tdStyle}>
                  {new Date(user.createdAt).toLocaleDateString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {users.length === 0 && (
        <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: 24 }}>
          No users yet.
        </p>
      )}
    </div>
  );
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 14,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '2px solid #e2e8f0',
  fontWeight: 600,
  fontSize: 13,
  color: '#64748b',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #f1f5f9',
};

import { useEffect, useState } from 'react';

interface SessionInfo {
  sid: string;
  expire: string;
  isAdmin: boolean;
  hasUser: boolean;
  provider: string | null;
}

export default function SessionViewer() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadSessions = () => {
    setLoading(true);
    fetch('/api/admin/sessions')
      .then((r) => r.json())
      .then((data) => { setSessions(data); setLoading(false); })
      .catch(() => { setError('Failed to load sessions'); setLoading(false); });
  };

  useEffect(() => { loadSessions(); }, []);

  if (error) return <div style={{ color: 'red' }}>{error}</div>;

  const isExpiringSoon = (expire: string) => {
    const diff = new Date(expire).getTime() - Date.now();
    return diff > 0 && diff < 60 * 60 * 1000; // within 1 hour
  };

  const formatExpiry = (expire: string) => {
    const d = new Date(expire);
    return d.toLocaleString();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Sessions</h1>
        <button onClick={loadSessions} disabled={loading} style={{ padding: '4px 12px', cursor: 'pointer' }}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {sessions.length === 0 ? (
        <p style={{ color: '#666' }}>No active sessions.</p>
      ) : (
        <>
          <p style={{ color: '#666', fontSize: 13 }}>{sessions.length} active session{sessions.length !== 1 ? 's' : ''}</p>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '2px solid #ddd' }}>Session ID</th>
                <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '2px solid #ddd' }}>Admin</th>
                <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '2px solid #ddd' }}>User</th>
                <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '2px solid #ddd' }}>Expires</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr
                  key={s.sid}
                  style={{
                    borderBottom: '1px solid #eee',
                    background: isExpiringSoon(s.expire) ? '#fff8e1' : 'transparent',
                  }}
                >
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{s.sid}...</td>
                  <td style={{ padding: '6px 10px' }}>
                    {s.isAdmin && (
                      <span style={{
                        fontSize: 11,
                        padding: '1px 6px',
                        borderRadius: 3,
                        background: '#e8f0fe',
                        color: '#1a73e8',
                        fontWeight: 600,
                      }}>
                        admin
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    {s.hasUser ? (
                      <span>
                        {s.provider && (
                          <span style={{
                            fontSize: 11,
                            padding: '1px 6px',
                            borderRadius: 3,
                            background: '#e6f4ea',
                            color: '#1e7e34',
                            fontWeight: 600,
                            marginRight: 4,
                          }}>
                            {s.provider}
                          </span>
                        )}
                        Authenticated
                      </span>
                    ) : (
                      <span style={{ color: '#999' }}>Anonymous</span>
                    )}
                  </td>
                  <td style={{ padding: '6px 10px', color: isExpiringSoon(s.expire) ? '#e65100' : '#333' }}>
                    {formatExpiry(s.expire)}
                    {isExpiringSoon(s.expire) && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: '#e65100' }}>expiring soon</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

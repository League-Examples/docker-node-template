import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/channels', label: 'Channels' },
  { to: '/admin/env', label: 'Environment' },
  { to: '/admin/db', label: 'Database' },
  { to: '/admin/config', label: 'Configuration' },
  { to: '/admin/logs', label: 'Logs' },
  { to: '/admin/sessions', label: 'Sessions' },
  { to: '/admin/permissions', label: 'Permissions' },
  { to: '/admin/scheduler', label: 'Scheduled Jobs' },
  { to: '/admin/import-export', label: 'Import/Export' },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch('/api/admin/check')
      .then((res) => res.json())
      .then((data) => {
        if (!data.authenticated) navigate('/admin', { replace: true });
      })
      .catch(() => navigate('/admin', { replace: true }))
      .finally(() => setChecking(false));
  }, [navigate]);

  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    navigate('/admin', { replace: true });
  }

  if (checking) return null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav
        style={{
          width: 200,
          flexShrink: 0,
          background: '#1a1a2e',
          color: '#eee',
          padding: '16px 0',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '0 16px 16px', fontWeight: 'bold', fontSize: 18 }}>
          Admin
        </div>
        <Link
          to="/"
          style={{
            display: 'block',
            padding: '10px 16px',
            color: '#aaa',
            textDecoration: 'none',
            borderBottom: '1px solid #2a2a4e',
            marginBottom: 4,
          }}
        >
          &larr; Home
        </Link>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            style={({ isActive }) => ({
              display: 'block',
              padding: '10px 16px',
              color: isActive ? '#fff' : '#aaa',
              background: isActive ? '#16213e' : 'transparent',
              textDecoration: 'none',
            })}
          >
            {item.label}
          </NavLink>
        ))}
        <div style={{ marginTop: 'auto', padding: '16px' }}>
          <button
            onClick={handleLogout}
            style={{
              width: '100%',
              padding: '8px',
              background: 'transparent',
              color: '#aaa',
              border: '1px solid #444',
              cursor: 'pointer',
            }}
          >
            Logout
          </button>
        </div>
      </nav>
      <main style={{ flex: 1, padding: 24, minWidth: 0, overflow: 'auto' }}>
        <Outlet />
      </main>
    </div>
  );
}

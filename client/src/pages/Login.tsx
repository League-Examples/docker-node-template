import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  async function handleDevLogin() {
    setLoggingIn(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/test-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'dev@example.com',
          displayName: 'Dev User',
          role: 'ADMIN',
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const user = await res.json();
      login(user);
      navigate('/', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoggingIn(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logoRow}>
          <h1 style={styles.title}>Chat App</h1>
        </div>
        <p style={styles.subtitle}>
          Sign in to get started.
        </p>

        <div style={styles.buttons}>
          <a href="/api/auth/github" style={styles.oauthBtn}>
            Sign in with GitHub
          </a>
          <a href="/api/auth/google" style={styles.oauthBtn}>
            Sign in with Google
          </a>
        </div>

        <div style={styles.divider}>
          <span style={styles.dividerText}>or</span>
        </div>

        <button
          style={styles.devBtn}
          onClick={handleDevLogin}
          disabled={loggingIn}
        >
          {loggingIn ? 'Logging in...' : 'Dev Login (test mode)'}
        </button>

        {error && <p style={styles.error}>{error}</p>}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: '#e8eef6',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  card: {
    background: '#fff',
    borderRadius: 12,
    padding: '2.5rem 2rem',
    maxWidth: 400,
    width: '100%',
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
    textAlign: 'center' as const,
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: '0.5rem',
  },
  title: {
    fontSize: '1.4rem',
    margin: 0,
    color: '#1e293b',
  },
  subtitle: {
    color: '#64748b',
    fontSize: '0.95rem',
    marginBottom: '1.5rem',
  },
  buttons: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.75rem',
  },
  oauthBtn: {
    display: 'block',
    padding: '0.7rem 1rem',
    fontSize: '0.95rem',
    fontWeight: 600,
    border: '1px solid #d1d5db',
    borderRadius: 8,
    background: '#fff',
    color: '#333',
    textDecoration: 'none',
    cursor: 'pointer',
    textAlign: 'center' as const,
  },
  divider: {
    position: 'relative' as const,
    margin: '1.25rem 0',
    borderTop: '1px solid #e0e0e0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dividerText: {
    position: 'absolute' as const,
    background: '#fff',
    padding: '0 0.75rem',
    color: '#94a3b8',
    fontSize: '0.85rem',
  },
  devBtn: {
    width: '100%',
    padding: '0.7rem 1rem',
    fontSize: '0.95rem',
    fontWeight: 600,
    border: 'none',
    borderRadius: 8,
    background: '#4f46e5',
    color: '#fff',
    cursor: 'pointer',
  },
  error: {
    color: '#dc2626',
    fontSize: '0.85rem',
    marginTop: '0.75rem',
  },
};

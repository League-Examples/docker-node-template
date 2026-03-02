/**
 * ExampleIntegrations.tsx — Disposable demo page
 *
 * This file demonstrates all three API integrations (GitHub, Google, Pike 13)
 * plus the counter. It is designed to be deleted when no longer needed.
 *
 * To remove: delete this file and revert App.tsx to its original counter demo.
 * No other files depend on this component.
 */
import { useState, useEffect } from 'react'

// ---- Types (all inline — no shared type files) ----

interface IntegrationStatus {
  github: { configured: boolean }
  google: { configured: boolean }
  pike13: { configured: boolean }
}

interface AuthUser {
  provider: string
  id: string
  displayName: string
  email: string
  avatar: string
}

interface GithubRepo {
  name: string
  description: string | null
  url: string
  stars: number
  language: string | null
}

interface Pike13Event {
  name?: string
  start_at?: string
  end_at?: string
  [key: string]: any
}

// ---- Component ----

export default function ExampleIntegrations() {
  // Integration status
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)

  // Counter
  const [count, setCount] = useState<number | null>(null)
  const [counterLoading, setCounterLoading] = useState(false)

  // GitHub repos
  const [repos, setRepos] = useState<GithubRepo[] | null>(null)
  const [reposLoading, setReposLoading] = useState(false)
  const [reposError, setReposError] = useState<string | null>(null)

  // Pike 13
  const [events, setEvents] = useState<Pike13Event[] | null>(null)
  const [eventsLoading, setEventsLoading] = useState(false)
  const [eventsError, setEventsError] = useState<string | null>(null)

  // ---- Initial data fetch ----
  useEffect(() => {
    // Fetch integration status
    fetch('/api/integrations/status')
      .then(r => r.json())
      .then(setStatus)
      .catch(() => setStatusError('Failed to load integration status'))

    // Fetch current user (may be 401)
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(setUser)
      .catch(() => {})

    // Fetch counter
    fetch('/api/counter')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setCount(data.value) })
      .catch(() => {})
  }, [])

  // ---- Counter handlers ----
  async function handleIncrement() {
    setCounterLoading(true)
    try {
      const res = await fetch('/api/counter/increment', { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setCount(data.value)
    } catch { /* ignore */ }
    setCounterLoading(false)
  }

  async function handleDecrement() {
    setCounterLoading(true)
    try {
      const res = await fetch('/api/counter/decrement', { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setCount(data.value)
    } catch { /* ignore */ }
    setCounterLoading(false)
  }

  // ---- GitHub repos ----
  async function fetchRepos() {
    setReposLoading(true)
    setReposError(null)
    try {
      const res = await fetch('/api/github/repos')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      setRepos(await res.json())
    } catch (err: any) {
      setReposError(err.message)
    }
    setReposLoading(false)
  }

  // ---- Pike 13 events ----
  async function fetchEvents() {
    setEventsLoading(true)
    setEventsError(null)
    try {
      const res = await fetch('/api/pike13/events')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setEvents(data.event_occurrences || data.events || data || [])
    } catch (err: any) {
      setEventsError(err.message)
    }
    setEventsLoading(false)
  }

  // ---- Render ----
  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Integration Demo</h1>
      <p style={styles.subtitle}>
        This page demonstrates the template&rsquo;s API integrations.
        Delete <code>client/src/pages/ExampleIntegrations.tsx</code> and
        revert <code>App.tsx</code> to remove it.
      </p>

      {statusError && <p style={styles.error}>{statusError}</p>}

      {/* ---- Counter ---- */}
      <section style={styles.card}>
        <h2>Counter</h2>
        <p style={styles.hint}>Stored in PostgreSQL via the /api/counter endpoint</p>
        <p style={styles.counterDisplay}>{count === null ? '...' : count}</p>
        <div style={styles.buttonRow}>
          <button style={styles.btn} onClick={handleDecrement} disabled={counterLoading}>
            &minus;
          </button>
          <button style={styles.btn} onClick={handleIncrement} disabled={counterLoading}>
            +
          </button>
        </div>
      </section>

      {/* ---- GitHub ---- */}
      <section style={styles.card}>
        <h2>GitHub</h2>
        {status && !status.github.configured ? (
          <div style={styles.notConfigured}>
            <p>Not configured</p>
            <p style={styles.hint}>
              Set <code>GITHUB_CLIENT_ID</code> and <code>GITHUB_CLIENT_SECRET</code>.{' '}
              <a href="https://github.com/settings/developers" target="_blank" rel="noreferrer">
                Create an OAuth App
              </a>
            </p>
          </div>
        ) : (
          <>
            {user && user.provider === 'github' ? (
              <div>
                <div style={styles.profile}>
                  {user.avatar && <img src={user.avatar} alt="" style={styles.avatar} />}
                  <div>
                    <strong>{user.displayName}</strong>
                    <br />
                    <span style={styles.hint}>{user.email}</span>
                  </div>
                </div>
                <button style={styles.btn} onClick={fetchRepos} disabled={reposLoading}>
                  {reposLoading ? 'Loading...' : 'Show Repos'}
                </button>
                {reposError && <p style={styles.error}>{reposError}</p>}
                {repos && (
                  <ul style={styles.repoList}>
                    {repos.map(r => (
                      <li key={r.name} style={styles.repoItem}>
                        <a href={r.url} target="_blank" rel="noreferrer">{r.name}</a>
                        {r.language && <span style={styles.badge}>{r.language}</span>}
                        {r.stars > 0 && <span style={styles.badge}>{r.stars} stars</span>}
                        {r.description && <p style={styles.hint}>{r.description}</p>}
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  style={{ ...styles.btn, ...styles.btnSecondary, marginTop: '0.5rem' }}
                  onClick={() => { fetch('/api/auth/logout', { method: 'POST' }).then(() => { setUser(null); setRepos(null) }) }}
                >
                  Logout
                </button>
              </div>
            ) : (
              <a href="/api/auth/github" style={styles.btnLink}>Connect GitHub</a>
            )}
          </>
        )}
      </section>

      {/* ---- Google ---- */}
      <section style={styles.card}>
        <h2>Google</h2>
        {status && !status.google.configured ? (
          <div style={styles.notConfigured}>
            <p>Not configured</p>
            <p style={styles.hint}>
              Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code>.{' '}
              <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
                Create credentials
              </a>
            </p>
          </div>
        ) : (
          <>
            {user && user.provider === 'google' ? (
              <div>
                <div style={styles.profile}>
                  {user.avatar && <img src={user.avatar} alt="" style={styles.avatar} />}
                  <div>
                    <strong>{user.displayName}</strong>
                    <br />
                    <span style={styles.hint}>{user.email}</span>
                  </div>
                </div>
                <button
                  style={{ ...styles.btn, ...styles.btnSecondary }}
                  onClick={() => { fetch('/api/auth/logout', { method: 'POST' }).then(() => setUser(null)) }}
                >
                  Logout
                </button>
              </div>
            ) : (
              <a href="/api/auth/google" style={styles.btnLink}>Connect Google</a>
            )}
          </>
        )}
      </section>

      {/* ---- Pike 13 ---- */}
      <section style={styles.card}>
        <h2>Pike 13</h2>
        {status && !status.pike13.configured ? (
          <div style={styles.notConfigured}>
            <p>Not configured</p>
            <p style={styles.hint}>
              Set <code>PIKE13_ACCESS_TOKEN</code>.{' '}
              <a href="https://developer.pike13.com/docs/get_started" target="_blank" rel="noreferrer">
                Pike 13 API docs
              </a>
            </p>
          </div>
        ) : (
          <div>
            <button style={styles.btn} onClick={fetchEvents} disabled={eventsLoading}>
              {eventsLoading ? 'Loading...' : 'Show Events'}
            </button>
            {eventsError && <p style={styles.error}>{eventsError}</p>}
            {events && (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Event</th>
                    <th style={styles.th}>Start</th>
                    <th style={styles.th}>End</th>
                  </tr>
                </thead>
                <tbody>
                  {events.length === 0 && (
                    <tr><td colSpan={3} style={styles.td}>No events this week</td></tr>
                  )}
                  {events.map((e, i) => (
                    <tr key={i}>
                      <td style={styles.td}>{e.name || 'Unnamed'}</td>
                      <td style={styles.td}>{e.start_at ? new Date(e.start_at).toLocaleString() : '—'}</td>
                      <td style={styles.td}>{e.end_at ? new Date(e.end_at).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

// ---- Inline styles (all self-contained, no external CSS needed) ----

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 640,
    margin: '40px auto',
    padding: '0 1rem',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  title: {
    fontSize: '2rem',
    marginBottom: '0.25rem',
  },
  subtitle: {
    color: '#888',
    fontSize: '0.85rem',
    marginBottom: '2rem',
  },
  card: {
    padding: '1.5rem',
    border: '1px solid #e0e0e0',
    borderRadius: 12,
    background: '#fafafa',
    marginBottom: '1.5rem',
  },
  notConfigured: {
    padding: '1rem',
    background: '#f5f5f5',
    borderRadius: 8,
    color: '#999',
    textAlign: 'center' as const,
  },
  counterDisplay: {
    fontSize: '3rem',
    fontWeight: 'bold',
    textAlign: 'center' as const,
    margin: '0.5rem 0',
    fontVariantNumeric: 'tabular-nums',
  },
  buttonRow: {
    display: 'flex',
    gap: '0.5rem',
    justifyContent: 'center',
  },
  btn: {
    fontSize: '1rem',
    padding: '0.5em 1.5em',
    border: 'none',
    borderRadius: 8,
    background: '#4f46e5',
    color: 'white',
    cursor: 'pointer',
  },
  btnSecondary: {
    background: '#6b7280',
  },
  btnLink: {
    display: 'inline-block',
    fontSize: '1rem',
    padding: '0.5em 1.5em',
    border: 'none',
    borderRadius: 8,
    background: '#4f46e5',
    color: 'white',
    cursor: 'pointer',
    textDecoration: 'none',
  },
  profile: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    marginBottom: '1rem',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: '50%',
  },
  hint: {
    color: '#888',
    fontSize: '0.85rem',
    marginTop: '0.25rem',
  },
  error: {
    color: '#dc2626',
    marginTop: '0.5rem',
  },
  badge: {
    display: 'inline-block',
    fontSize: '0.75rem',
    padding: '0.15em 0.5em',
    background: '#e5e7eb',
    borderRadius: 4,
    marginLeft: '0.5rem',
  },
  repoList: {
    listStyle: 'none',
    padding: 0,
    marginTop: '1rem',
    textAlign: 'left' as const,
  },
  repoItem: {
    padding: '0.5rem 0',
    borderBottom: '1px solid #eee',
  },
  table: {
    width: '100%',
    marginTop: '1rem',
    borderCollapse: 'collapse' as const,
    fontSize: '0.9rem',
  },
  th: {
    textAlign: 'left' as const,
    padding: '0.5rem',
    borderBottom: '2px solid #ddd',
    fontWeight: 600,
  },
  td: {
    padding: '0.5rem',
    borderBottom: '1px solid #eee',
  },
}

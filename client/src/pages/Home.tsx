import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { hasAdminAccess } from '../lib/roles';

export default function Home() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={styles.container}>
        <p style={styles.hint}>Loading...</p>
      </div>
    );
  }

  const displayName = user?.displayName ?? 'Student';
  const isAdmin = hasAdminAccess(user?.role);

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Welcome, {displayName}</h1>
        <p style={styles.subtitle}>
          Your personalized guide through the college application journey.
        </p>
      </header>

      <div style={styles.grid}>
        <Link to="/chat" style={styles.cardLink}>
          <section style={styles.card}>
            <h2 style={styles.cardTitle}>Start Chatting</h2>
            <p style={styles.cardText}>
              Ask questions about college applications, course planning, or
              anything else on your mind. Your AI advisor is ready to help.
            </p>
          </section>
        </Link>

        <Link to="/profile" style={styles.cardLink}>
          <section style={styles.card}>
            <h2 style={styles.cardTitle}>Your Profile</h2>
            <p style={styles.cardText}>
              Review and update your academic interests, goals, and personal
              information to get better recommendations.
            </p>
          </section>
        </Link>

        <Link to="/plan" style={styles.cardLink}>
          <section style={styles.card}>
            <h2 style={styles.cardTitle}>Academic Plan</h2>
            <p style={styles.cardText}>
              View your personalized 4-year course plan and make adjustments
              as your goals evolve.
            </p>
          </section>
        </Link>

        <Link to="/questionnaire" style={styles.cardLink}>
          <section style={styles.card}>
            <h2 style={styles.cardTitle}>Interest Questionnaire</h2>
            <p style={styles.cardText}>
              Complete or revisit the questionnaire to refine your college
              and career recommendations.
            </p>
          </section>
        </Link>

        {isAdmin && (
          <Link to="/admin" style={styles.cardLink}>
            <section style={{ ...styles.card, borderColor: '#f59e0b' }}>
              <h2 style={{ ...styles.cardTitle, color: '#92400e' }}>
                Admin Panel
              </h2>
              <p style={styles.cardText}>
                Manage users, review application data, and configure system
                settings.
              </p>
            </section>
          </Link>
        )}
      </div>

      <footer style={styles.footer}>
        <Link to="/about" style={styles.footerLink}>
          About this application
        </Link>
      </footer>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 800,
    margin: '40px auto',
    padding: '0 1rem',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    marginBottom: '2rem',
  },
  title: {
    fontSize: '2rem',
    marginBottom: '0.25rem',
    color: '#1e293b',
  },
  subtitle: {
    color: '#64748b',
    fontSize: '1.05rem',
    marginTop: '0.5rem',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '1.25rem',
  },
  cardLink: {
    textDecoration: 'none',
    color: 'inherit',
  },
  card: {
    padding: '1.5rem',
    border: '1px solid #e0e0e0',
    borderRadius: 12,
    background: '#fafafa',
    transition: 'box-shadow 0.15s ease',
    cursor: 'pointer',
    height: '100%',
    boxSizing: 'border-box' as const,
  },
  cardTitle: {
    fontSize: '1.15rem',
    marginTop: 0,
    marginBottom: '0.5rem',
    color: '#4f46e5',
  },
  cardText: {
    fontSize: '0.9rem',
    color: '#6b7280',
    lineHeight: 1.5,
    margin: 0,
  },
  hint: {
    color: '#888',
    fontSize: '0.85rem',
  },
  footer: {
    marginTop: '2.5rem',
    textAlign: 'center' as const,
  },
  footerLink: {
    color: '#4f46e5',
    fontSize: '0.9rem',
    textDecoration: 'none',
  },
};

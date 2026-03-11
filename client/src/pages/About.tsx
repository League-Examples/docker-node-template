import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

const APP_NAME = 'College Application Navigator';
const FALLBACK_VERSION = '0.1.0';

export default function About() {
  const [version, setVersion] = useState<string>(FALLBACK_VERSION);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.version) {
          setVersion(data.version);
        }
      })
      .catch(() => {
        // Keep fallback version
      });
  }, []);

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>{APP_NAME}</h1>
        <p style={styles.version}>Version {version}</p>
      </header>

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>About</h2>
        <p style={styles.text}>
          The College Application Navigator is a personalized guide that walks
          students through the entire college application journey — from course
          selection in 8th grade through enrollment in 12th grade. It adapts to
          each student's profile, goals, and timeline.
        </p>
      </section>

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Features</h2>
        <ul style={styles.list}>
          <li style={styles.listItem}>
            <strong>AI-Powered Advising</strong> — Chat with an AI advisor that
            understands your academic profile and goals.
          </li>
          <li style={styles.listItem}>
            <strong>4-Year Academic Plan</strong> — Generate a personalized
            course plan based on your interests and target colleges.
          </li>
          <li style={styles.listItem}>
            <strong>Interest Questionnaire</strong> — Discover your academic
            strengths and career interests through a guided questionnaire.
          </li>
          <li style={styles.listItem}>
            <strong>Student Profile</strong> — Track your courses, GPA, test
            scores, and extracurricular activities in one place.
          </li>
        </ul>
      </section>

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Technology</h2>
        <p style={styles.text}>
          Built with React, Express, TypeScript, and PostgreSQL. AI features
          are powered by the Claude API from Anthropic.
        </p>
      </section>

      <footer style={styles.footer}>
        <Link to="/" style={styles.backLink}>
          &larr; Back to Home
        </Link>
      </footer>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 640,
    margin: '40px auto',
    padding: '0 1rem',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    marginBottom: '2rem',
    textAlign: 'center' as const,
  },
  title: {
    fontSize: '2rem',
    marginBottom: '0.25rem',
    color: '#1e293b',
  },
  version: {
    color: '#94a3b8',
    fontSize: '0.9rem',
    marginTop: '0.25rem',
  },
  card: {
    padding: '1.5rem',
    border: '1px solid #e0e0e0',
    borderRadius: 12,
    background: '#fafafa',
    marginBottom: '1.25rem',
  },
  sectionTitle: {
    fontSize: '1.15rem',
    marginTop: 0,
    marginBottom: '0.75rem',
    color: '#4f46e5',
  },
  text: {
    fontSize: '0.95rem',
    color: '#4b5563',
    lineHeight: 1.6,
    margin: 0,
  },
  list: {
    margin: 0,
    paddingLeft: '1.25rem',
  },
  listItem: {
    fontSize: '0.95rem',
    color: '#4b5563',
    lineHeight: 1.6,
    marginBottom: '0.5rem',
  },
  footer: {
    marginTop: '2rem',
    textAlign: 'center' as const,
  },
  backLink: {
    color: '#4f46e5',
    fontSize: '0.9rem',
    textDecoration: 'none',
  },
};

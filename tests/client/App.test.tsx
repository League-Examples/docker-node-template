import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import App from '../../client/src/App';

/**
 * Routing smoke test for ticket 005-007's shell/routing scaffold: confirms
 * the `/mockups/*` route block is gone (falls through to NotFound) and the
 * three new routes (`/`, `/projects/:id`, `/projects/:id/postcard`) resolve
 * inside the authenticated `AppLayout` shell. See
 * clasi/sprints/005-real-two-pane-app/architecture-update.md, "What
 * Changed".
 */

// ---- Mock AuthContext: bypass the real fetch-based provider and force an
// authenticated, non-admin user so AppLayout renders content instead of
// redirecting to /login. ----

vi.mock('../../client/src/context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: {
      id: 1,
      email: 'user@example.com',
      displayName: 'Test User',
      role: 'USER',
      avatarUrl: null,
      provider: null,
      providerId: null,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  }),
}));

function navigateTo(path: string) {
  window.history.pushState({}, '', path);
}

describe('App routing scaffold (005-007)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('no longer registers any /mockups/* route (falls through to NotFound)', () => {
    navigateTo('/mockups/main');
    render(<App />);
    expect(screen.getByText('Page Not Found')).toBeInTheDocument();
  });

  it('no longer registers the /mockups index route either', () => {
    navigateTo('/mockups');
    render(<App />);
    expect(screen.getByText('Page Not Found')).toBeInTheDocument();
  });

  it('resolves "/" inside the AppLayout shell', () => {
    navigateTo('/');
    render(<App />);
    expect(screen.getByText('Projects')).toBeInTheDocument();
    // AppLayout's top bar renders regardless of page content.
    expect(screen.getByTestId('user-menu-trigger')).toBeInTheDocument();
  });

  it('resolves "/projects/:id" inside the AppLayout shell', () => {
    navigateTo('/projects/42');
    render(<App />);
    expect(screen.getByText('Project 42')).toBeInTheDocument();
    expect(screen.getByTestId('user-menu-trigger')).toBeInTheDocument();
  });

  it('resolves "/projects/:id/postcard" inside the AppLayout shell', () => {
    navigateTo('/projects/42/postcard');
    render(<App />);
    expect(screen.getByText(/Postcard editor — project 42/)).toBeInTheDocument();
    expect(screen.getByTestId('user-menu-trigger')).toBeInTheDocument();
  });
});

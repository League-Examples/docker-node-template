import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import AppLayout from '../../client/src/components/AppLayout';

// ---- Mock useAuth ----

const mockLogout = vi.fn();

const mockUseAuth = vi.fn(() => ({
  user: {
    id: 1,
    email: 'student@example.com',
    displayName: 'Jane Student',
    role: 'USER',
    avatarUrl: null,
    provider: null,
    providerId: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
  loading: false,
  logout: mockLogout,
}));

vi.mock('../../client/src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

// ---- Helpers ----

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location-display">{location.pathname}</div>;
}

function renderLayout(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocationDisplay />
      <AppLayout />
    </MemoryRouter>,
  );
}

function makeAdminUser(overrides = {}) {
  return {
    id: 1,
    email: 'admin@example.com',
    displayName: 'Admin User',
    role: 'ADMIN',
    avatarUrl: null,
    provider: null,
    providerId: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---- Tests ----

describe('AppLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default non-admin user
    mockUseAuth.mockReturnValue({
      user: {
        id: 1,
        email: 'student@example.com',
        displayName: 'Jane Student',
        role: 'USER',
        avatarUrl: null,
        provider: null,
        providerId: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
      loading: false,
      logout: mockLogout,
    });
  });

  it('renders the primary nav as an always-visible horizontal tab bar (no hamburger)', () => {
    renderLayout();
    expect(screen.queryByRole('button', { name: 'Menu' })).not.toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(nav).toBeInTheDocument();
    // "Home" was renamed to "Projects" for the tab bar.
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('About')).toBeInTheDocument();
  });

  it('shows the Admin tab when user has admin role', () => {
    mockUseAuth.mockReturnValue({
      user: makeAdminUser(),
      loading: false,
      logout: mockLogout,
    });

    renderLayout();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('hides the Admin tab when user has non-admin role', () => {
    renderLayout();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('displays the rebranded app name in the top bar', () => {
    renderLayout();
    expect(screen.getByText('Flyerbot')).toBeInTheDocument();
  });

  it('displays user name in the top bar', () => {
    renderLayout();
    expect(screen.getByText('Jane Student')).toBeInTheDocument();
  });

  it('renders the Outlet content area (main element exists)', () => {
    renderLayout();
    // The Outlet renders inside a <main> element
    const mainEl = document.querySelector('main');
    expect(mainEl).toBeInTheDocument();
  });

  // ---- Impersonation banner tests ----

  it('does not show impersonation banner when not impersonating', () => {
    renderLayout();
    expect(screen.queryByText(/Viewing as/i)).not.toBeInTheDocument();
  });

  it('shows impersonation banner when user.impersonating is true', () => {
    mockUseAuth.mockReturnValue({
      user: makeAdminUser({
        impersonating: true,
        displayName: 'Target User',
        realAdmin: { id: '1', displayName: 'Real Admin' },
      }),
      loading: false,
      logout: mockLogout,
    });

    renderLayout();
    expect(screen.getByText(/Viewing as Target User/i)).toBeInTheDocument();
    expect(screen.getByText(/real admin: Real Admin/i)).toBeInTheDocument();
  });

  it('does not show impersonation banner when impersonating is false', () => {
    mockUseAuth.mockReturnValue({
      user: makeAdminUser({ impersonating: false }),
      loading: false,
      logout: mockLogout,
    });

    renderLayout();
    expect(screen.queryByText(/Viewing as/i)).not.toBeInTheDocument();
  });

  // ---- Dropdown tests ----

  it('shows "Log out" in dropdown when not impersonating', () => {
    renderLayout();
    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    expect(screen.getByText('Log out')).toBeInTheDocument();
    expect(screen.queryByText('Stop impersonating')).not.toBeInTheDocument();
  });

  it('shows "Stop impersonating" in dropdown instead of "Log out" when impersonating', () => {
    mockUseAuth.mockReturnValue({
      user: makeAdminUser({
        impersonating: true,
        displayName: 'Target User',
        realAdmin: { id: '1', displayName: 'Real Admin' },
      }),
      loading: false,
      logout: mockLogout,
    });

    renderLayout();
    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    expect(screen.getByText('Stop impersonating')).toBeInTheDocument();
    expect(screen.queryByText('Log out')).not.toBeInTheDocument();
  });

  it('calls stop-impersonating endpoint and reloads when "Stop impersonating" is clicked', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const mockReload = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: mockReload },
      writable: true,
    });

    mockUseAuth.mockReturnValue({
      user: makeAdminUser({
        impersonating: true,
        displayName: 'Target User',
        realAdmin: { id: '1', displayName: 'Real Admin' },
      }),
      loading: false,
      logout: mockLogout,
    });

    renderLayout();
    fireEvent.click(screen.getByTestId('user-menu-trigger'));

    const stopBtn = screen.getByText('Stop impersonating');
    fireEvent.click(stopBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/admin/stop-impersonating',
        { method: 'POST' },
      );
      expect(mockReload).toHaveBeenCalled();
    });

    vi.unstubAllGlobals();
  });

  // ---- Admin-console link in the account dropdown (SUC-012) ----

  it('shows an Admin console link in the account dropdown when user has admin role', () => {
    mockUseAuth.mockReturnValue({
      user: makeAdminUser(),
      loading: false,
      logout: mockLogout,
    });

    renderLayout();
    fireEvent.click(screen.getByTestId('user-menu-trigger'));

    const link = screen.getByRole('button', { name: /admin console/i });
    expect(link).toBeInTheDocument();
  });

  it('navigates to /admin/users when the account dropdown Admin console link is clicked', () => {
    mockUseAuth.mockReturnValue({
      user: makeAdminUser(),
      loading: false,
      logout: mockLogout,
    });

    renderLayout();
    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    fireEvent.click(screen.getByRole('button', { name: /admin console/i }));

    expect(screen.getByTestId('location-display')).toHaveTextContent('/admin/users');
  });

  it('hides the Admin console link in the account dropdown when user has non-admin role', () => {
    renderLayout();
    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    expect(screen.queryByRole('button', { name: /admin console/i })).not.toBeInTheDocument();
  });

  it('the primary-nav Admin tab works alongside the account-dropdown Admin link (no regression)', () => {
    mockUseAuth.mockReturnValue({
      user: makeAdminUser(),
      loading: false,
      logout: mockLogout,
    });

    renderLayout();
    // Admin tab is present in the always-visible primary nav...
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByText('Admin')).toBeInTheDocument();
    // ...and the account dropdown still carries its own "Admin console" link.
    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    expect(screen.getByText('Admin console')).toBeInTheDocument();
  });

  // ---- Full-bleed <main> mode for /projects/* (R2) ----

  it('renders <main> full-bleed (no padding, no overflow-auto) on /projects/:id routes', () => {
    renderLayout('/projects/42');
    const mainEl = document.querySelector('main');
    expect(mainEl).toBeInTheDocument();
    expect(mainEl?.className).not.toMatch(/\bp-6\b/);
    expect(mainEl?.className).not.toMatch(/\boverflow-auto\b/);
  });

  it('renders <main> full-bleed on /projects/:id/postcard routes', () => {
    renderLayout('/projects/42/postcard');
    const mainEl = document.querySelector('main');
    expect(mainEl?.className).not.toMatch(/\bp-6\b/);
    expect(mainEl?.className).not.toMatch(/\boverflow-auto\b/);
  });

  it('keeps the padded, scrolling <main> on non-/projects/* routes (regression)', () => {
    renderLayout('/about');
    const mainEl = document.querySelector('main');
    expect(mainEl?.className).toMatch(/\bp-6\b/);
    expect(mainEl?.className).toMatch(/\boverflow-auto\b/);
  });

  it('keeps the padded, scrolling <main> on the home route "/"', () => {
    renderLayout('/');
    const mainEl = document.querySelector('main');
    expect(mainEl?.className).toMatch(/\bp-6\b/);
    expect(mainEl?.className).toMatch(/\boverflow-auto\b/);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

function renderLayout() {
  return render(
    <MemoryRouter>
      <AppLayout />
    </MemoryRouter>,
  );
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

  it('renders sidebar with Home and Chat navigation links', () => {
    renderLayout();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Chat')).toBeInTheDocument();
  });

  it('shows Admin link when user has admin role', () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: 1,
        email: 'admin@example.com',
        displayName: 'Admin User',
        role: 'ADMIN',
        avatarUrl: null,
        provider: null,
        providerId: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
      loading: false,
      logout: mockLogout,
    });

    renderLayout();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('hides Admin link when user has non-admin role', () => {
    renderLayout();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
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
});

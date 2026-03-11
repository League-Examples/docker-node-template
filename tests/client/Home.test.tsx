import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Home from '../../client/src/pages/Home';

// ---- Mock useAuth ----

const mockUseAuth = vi.fn();

vi.mock('../../client/src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

// ---- Helpers ----

function renderHome() {
  return render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  );
}

// ---- Tests ----

describe('Home', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      logout: vi.fn(),
    });
  });

  it('renders welcome message with user display name', () => {
    renderHome();
    expect(screen.getByText('Welcome, Jane Student')).toBeInTheDocument();
  });

  it('shows admin card when user is admin', () => {
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
      logout: vi.fn(),
    });

    renderHome();
    expect(screen.getByText('Admin Panel')).toBeInTheDocument();
  });

  it('hides admin card when user is not admin', () => {
    renderHome();
    expect(screen.queryByText('Admin Panel')).not.toBeInTheDocument();
  });
});

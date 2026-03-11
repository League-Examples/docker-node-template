import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Channels from '../../client/src/pages/Channels';

// ---- Mock useAuth ----

const mockUseAuth = vi.fn();

vi.mock('../../client/src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

// ---- Mock fetch ----

beforeEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve([
        {
          id: 1,
          name: 'general',
          description: 'General chat',
          messageCount: 5,
          createdAt: '2025-01-01T00:00:00Z',
        },
      ]),
  });
});

// ---- Tests ----

describe('Channels', () => {
  it('shows "Access Denied" for non-admin users', () => {
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

    render(<Channels />);
    expect(screen.getByText('Access Denied')).toBeInTheDocument();
  });

  it('shows channel management UI for admin users', async () => {
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

    render(<Channels />);
    expect(screen.getByText('Manage Channels')).toBeInTheDocument();
    // Wait for channel list to load
    await waitFor(() => {
      expect(screen.getByText('# general')).toBeInTheDocument();
    });
  });

  it('shows create channel form for admin', () => {
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

    render(<Channels />);
    expect(screen.getByText('Create Channel')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Channel name')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Description (optional)'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });
});

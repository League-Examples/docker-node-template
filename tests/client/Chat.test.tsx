import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Chat from '../../client/src/pages/Chat';

// ---- Mock useAuth ----

vi.mock('../../client/src/context/AuthContext', () => ({
  useAuth: () => ({
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
  }),
}));

// ---- Mock scrollIntoView (not available in jsdom) ----

Element.prototype.scrollIntoView = vi.fn();

// ---- Mock fetch ----

beforeEach(() => {
  vi.restoreAllMocks();
  // Re-apply scrollIntoView mock after restoreAllMocks
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    if (url === '/api/channels') {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: 1, name: 'general', description: 'General chat', messageCount: 5 },
          ]),
      });
    }
    // Channel messages endpoint
    if (url.match(/\/api\/channels\/\d+$/)) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ messages: [] }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
});

// ---- Tests ----

describe('Chat', () => {
  it('renders channel list area with "Channels" heading', () => {
    render(<Chat />);
    expect(screen.getByText('Channels')).toBeInTheDocument();
  });

  it('renders message input', () => {
    render(<Chat />);
    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();
  });

  it('shows "Send" button', () => {
    render(<Chat />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });
});

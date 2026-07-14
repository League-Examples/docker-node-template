import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Login from '../../client/src/pages/Login';

// ---- Helpers ----

/** Build a fetch mock that returns the given provider status from /api/integrations/status */
function mockFetchStatus(status: { github?: boolean; google?: boolean }) {
  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    if (url === '/api/integrations/status') {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            github: { configured: !!status.github },
            google: { configured: !!status.google },
          }),
      });
    }
    // Default: network error for unexpected fetches
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
}

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  );
}

// ---- Tests ----

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the Google sign-in button when Google is configured', async () => {
    mockFetchStatus({ google: true });
    renderLogin();

    await waitFor(() => {
      expect(screen.getByText(/sign in with google/i)).toBeInTheDocument();
    });
  });

  it('Google button links to /api/auth/google', async () => {
    mockFetchStatus({ google: true });
    renderLogin();

    await waitFor(() => {
      expect(screen.getByText(/sign in with google/i)).toBeInTheDocument();
    });

    const googleLink = screen.getByText(/sign in with google/i).closest('a');
    expect(googleLink).toHaveAttribute('href', '/api/auth/google');
  });

  it('shows a not-configured message when Google is not configured', async () => {
    mockFetchStatus({});
    renderLogin();

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/integrations/status');
    });

    expect(screen.queryByText(/sign in with google/i)).not.toBeInTheDocument();
    expect(screen.getByText(/not configured/i)).toBeInTheDocument();
  });

  it('does not render a GitHub sign-in button', async () => {
    mockFetchStatus({ github: true, google: true });
    renderLogin();

    await waitFor(() => {
      expect(screen.getByText(/sign in with google/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/sign in with github/i)).not.toBeInTheDocument();
  });

  it('does not render a Pike 13 sign-in button', async () => {
    mockFetchStatus({ google: true });
    renderLogin();

    await waitFor(() => {
      expect(screen.getByText(/sign in with google/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/pike/i)).not.toBeInTheDocument();
  });

  it('does not render a username/password demo form', async () => {
    mockFetchStatus({ google: true });
    renderLogin();

    await waitFor(() => {
      expect(screen.getByText(/sign in with google/i)).toBeInTheDocument();
    });

    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('does not render a Register link', async () => {
    mockFetchStatus({ google: true });
    renderLogin();

    await waitFor(() => {
      expect(screen.getByText(/sign in with google/i)).toBeInTheDocument();
    });

    expect(screen.queryByRole('link', { name: /register/i })).not.toBeInTheDocument();
  });

  it('shows the not-configured message when the status fetch fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    renderLogin();

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/integrations/status');
    });

    await waitFor(() => {
      expect(screen.getByText(/not configured/i)).toBeInTheDocument();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import About from '../../client/src/pages/About';

// ---- Mock fetch ----

beforeEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ status: 'ok', version: '1.2.3' }),
  });
});

// ---- Helpers ----

function renderAbout() {
  return render(
    <MemoryRouter>
      <About />
    </MemoryRouter>,
  );
}

// ---- Tests ----

describe('About', () => {
  it('renders application name "College Application Navigator"', () => {
    renderAbout();
    expect(
      screen.getByRole('heading', { name: 'College Application Navigator' }),
    ).toBeInTheDocument();
  });

  it('renders version information from the health endpoint', async () => {
    renderAbout();
    await waitFor(() => {
      expect(screen.getByText('Version 1.2.3')).toBeInTheDocument();
    });
  });

  it('renders fallback version when fetch fails', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network error'),
    );

    renderAbout();
    // Fallback version is 0.1.0
    expect(screen.getByText('Version 0.1.0')).toBeInTheDocument();
  });
});

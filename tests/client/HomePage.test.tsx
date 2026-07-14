import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomePage from '../../client/src/pages/HomePage';

function renderHomePage() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

describe('HomePage', () => {
  it('renders the Flyerbot heading', () => {
    renderHomePage();
    expect(screen.getByRole('heading', { name: 'Flyerbot' })).toBeInTheDocument();
  });

  it('links to all four wireframe pages and the mockups index', () => {
    renderHomePage();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/mockups/main',
        '/mockups/new-project',
        '/mockups/postcard-edit',
        '/mockups/login',
        '/mockups',
      ]),
    );
  });

  it('no longer shows the counter demo', () => {
    renderHomePage();
    expect(screen.queryByText(/counters/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /bump/i })).not.toBeInTheDocument();
  });
});

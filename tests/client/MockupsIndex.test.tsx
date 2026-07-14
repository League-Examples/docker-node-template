import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MockupsIndex from '../../client/src/pages/mockups/MockupsIndex';

function renderPage() {
  return render(
    <MemoryRouter>
      <MockupsIndex />
    </MemoryRouter>,
  );
}

describe('MockupsIndex', () => {
  it('renders the mockups heading', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: /wireframe mockups/i }),
    ).toBeInTheDocument();
  });

  it('links to the two-pane main layout mockup', () => {
    renderPage();
    const link = screen.getByRole('link', { name: /two-pane main layout/i });
    expect(link).toHaveAttribute('href', '/mockups/main');
  });

  it('links to the new-project flow mockup', () => {
    renderPage();
    const link = screen.getByRole('link', { name: /new-project flow/i });
    expect(link).toHaveAttribute('href', '/mockups/new-project');
  });

  it('links to the postcard text-region edit form mockup', () => {
    renderPage();
    const link = screen.getByRole('link', { name: /postcard text-region edit form/i });
    expect(link).toHaveAttribute('href', '/mockups/postcard-edit');
  });

  it('shows not-yet-built mockups as non-navigable placeholders', () => {
    renderPage();
    expect(screen.getByText(/google-only login/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /google-only login/i }),
    ).not.toBeInTheDocument();
  });
});

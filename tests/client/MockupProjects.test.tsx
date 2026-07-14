import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MockupProjects from '../../client/src/pages/mockups/MockupProjects';

function renderPage() {
  return render(
    <MemoryRouter>
      <MockupProjects />
    </MemoryRouter>,
  );
}

describe('MockupProjects', () => {
  it('lists all stub projects as cards', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByText('Robot Riot Postcard')).toBeInTheDocument();
    expect(screen.getByText('Summer Reading Program Poster')).toBeInTheDocument();
    expect(screen.getByText('Coding Camp Facebook Post')).toBeInTheDocument();
  });

  it('postcard heroes are the front; unaccepted projects fall back to the last iteration', () => {
    renderPage();
    expect(screen.getByText('Front — Iteration 5 (accepted)')).toBeInTheDocument();
    expect(screen.getByText('Iteration 3 (last — nothing accepted)')).toBeInTheDocument();
  });
});

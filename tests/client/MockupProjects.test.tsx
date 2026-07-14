import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  it('defaults to My projects: only my unarchived projects show', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'My projects' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Spring Open House Postcard')).toBeInTheDocument();
    expect(screen.getByText('Summer Reading Program Poster')).toBeInTheDocument();
    // Someone else's project and my archived project are hidden here.
    expect(screen.queryByText('Robot Riot Postcard')).not.toBeInTheDocument();
    expect(screen.queryByText('Fall 2025 Enrollment Flyer')).not.toBeInTheDocument();
  });

  it('All projects shows everyone’s unarchived projects with owners', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'All projects' }));

    expect(screen.getByText('Robot Riot Postcard')).toBeInTheDocument();
    expect(screen.getByText('Coding Camp Facebook Post')).toBeInTheDocument();
    expect(screen.getAllByText('marketing@jointheleague.org').length).toBeGreaterThan(0);
    expect(screen.queryByText('Fall 2025 Enrollment Flyer')).not.toBeInTheDocument();
  });

  it('Archive shows archived projects only', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    expect(screen.getByText('Fall 2025 Enrollment Flyer')).toBeInTheDocument();
    expect(screen.queryByText('Spring Open House Postcard')).not.toBeInTheDocument();
  });

  it('Library view shows assets; clicking one creates a project for it', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Library' }));

    // Assets replace project cards.
    expect(screen.queryByText('Spring Open House Postcard')).not.toBeInTheDocument();
    expect(screen.getByText(/click an asset to create a project/i)).toBeInTheDocument();

    const assetLink = screen.getByRole('link', {
      name: /create a project for league robot logo/i,
    });
    expect(assetLink).toHaveAttribute('href', '/mockups/main');
  });

  it('postcard heroes are the front; unaccepted projects fall back to the last iteration', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'All projects' }));
    expect(screen.getByText('Front — Iteration 5 (accepted)')).toBeInTheDocument();
    expect(screen.getByText('Iteration 3 (last — nothing accepted)')).toBeInTheDocument();
  });
});

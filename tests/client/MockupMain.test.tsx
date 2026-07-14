import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MockupMain from '../../client/src/pages/mockups/MockupMain';

function openLibrary() {
  fireEvent.click(screen.getByRole('button', { name: /open library/i }));
}

function expectDrawerOpen(open: boolean) {
  expect(screen.getByTestId('library-overlay')).toHaveAttribute(
    'data-open',
    String(open),
  );
}

describe('MockupMain', () => {
  it('renders a top bar with a hamburger menu instead of a sidebar', () => {
    render(<MockupMain />);
    const menuButton = screen.getByRole('button', { name: /menu/i });
    expect(menuButton).toBeInTheDocument();

    fireEvent.click(menuButton);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Log out')).toBeInTheDocument();
  });

  it('starts with the asset browser drawer closed, pull tab showing', () => {
    render(<MockupMain />);
    expectDrawerOpen(false);
    expect(screen.getByRole('button', { name: /open library/i })).toBeInTheDocument();
  });

  it('slides the drawer open via the pull tab and closed again', () => {
    render(<MockupMain />);
    openLibrary();
    expectDrawerOpen(true);
    expect(screen.getByRole('button', { name: 'Assets' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Examples' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /close library/i }));
    expectDrawerOpen(false);
  });

  it('switches the visible library list when a category tab is clicked', () => {
    render(<MockupMain />);
    openLibrary();

    fireEvent.click(screen.getByRole('button', { name: 'Styles' }));
    expect(screen.getByText('Pop Art')).toBeInTheDocument();
    expect(screen.queryByText(/league robot logo/i)).not.toBeInTheDocument();
  });

  it('double-clicking an item adds it as a project reference and closes the drawer', () => {
    render(<MockupMain />);
    openLibrary();

    fireEvent.doubleClick(screen.getByText(/league robot logo/i));

    expectDrawerOpen(false);
    const chips = screen.getByTestId('project-references');
    expect(chips).toHaveTextContent(/league robot logo/i);
  });

  it('renders the project output area with iteration placeholders', () => {
    render(<MockupMain />);
    expect(screen.getByRole('heading', { name: /spring open house flyer/i })).toBeInTheDocument();
    expect(screen.getByText('Iteration 1')).toBeInTheDocument();
    expect(screen.getByText('Iteration 3')).toBeInTheDocument();
    expect(screen.getByText('current')).toBeInTheDocument();
  });

  it('renders the chat panel below the output area', () => {
    render(<MockupMain />);
    expect(screen.getByPlaceholderText(/message claude/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });
});

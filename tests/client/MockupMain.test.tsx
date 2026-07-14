import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MockupMain from '../../client/src/pages/mockups/MockupMain';

function openLibrary() {
  fireEvent.click(screen.getByRole('button', { name: 'Library' }));
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

  it('starts with the asset browser collapsed', () => {
    render(<MockupMain />);
    expect(screen.queryByTestId('library-overlay')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Library' })).toBeInTheDocument();
  });

  it('opens the library as an overlay and collapses it again', () => {
    render(<MockupMain />);
    openLibrary();

    expect(screen.getByTestId('library-overlay')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assets' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Examples' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /collapse library/i }));
    expect(screen.queryByTestId('library-overlay')).not.toBeInTheDocument();
  });

  it('switches the visible library list when a category tab is clicked', () => {
    render(<MockupMain />);
    openLibrary();

    fireEvent.click(screen.getByRole('button', { name: 'Styles' }));
    expect(screen.getByText('Pop Art')).toBeInTheDocument();
    expect(screen.queryByText(/league robot logo/i)).not.toBeInTheDocument();
  });

  it('double-clicking an item adds it as a project reference and closes the browser', () => {
    render(<MockupMain />);
    openLibrary();

    fireEvent.doubleClick(screen.getByText(/league robot logo/i));

    expect(screen.queryByTestId('library-overlay')).not.toBeInTheDocument();
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

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MockupMain from '../../client/src/pages/mockups/MockupMain';

describe('MockupMain', () => {
  it('renders the left browser pane with category tabs', () => {
    render(<MockupMain />);
    expect(screen.getByRole('button', { name: 'Assets' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Examples' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Styles' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Projects' })).toBeInTheDocument();
  });

  it('defaults to the Assets category', () => {
    render(<MockupMain />);
    expect(screen.getByRole('button', { name: 'Assets' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText(/league robot logo/i)).toBeInTheDocument();
  });

  it('switches the visible library list when a category tab is clicked', () => {
    render(<MockupMain />);
    fireEvent.click(screen.getByRole('button', { name: 'Styles' }));
    expect(screen.getByText('Pop Art')).toBeInTheDocument();
    expect(screen.queryByText(/league robot logo/i)).not.toBeInTheDocument();
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

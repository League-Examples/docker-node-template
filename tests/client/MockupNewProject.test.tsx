import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MockupNewProject from '../../client/src/pages/mockups/MockupNewProject';

describe('MockupNewProject', () => {
  it('renders the project-details header fields, empty and disabled', () => {
    render(<MockupNewProject />);

    const style = screen.getByLabelText(/^style$/i);
    expect(style).toBeInTheDocument();
    expect(style).toBeDisabled();
    expect(style).toHaveValue('');

    const goal = screen.getByLabelText(/what are you trying to achieve/i);
    expect(goal).toBeInTheDocument();
    expect(goal).toBeDisabled();
    expect(goal).toHaveValue('');

    expect(screen.getByText(/^output type$/i)).toBeInTheDocument();
    for (const option of ['Facebook image', 'Logo', 'Postcard']) {
      const radio = screen.getByLabelText(option);
      expect(radio).toBeInTheDocument();
      expect(radio).toBeDisabled();
      expect(radio).not.toBeChecked();
    }
  });

  it('renders the empty-output-area placeholder', () => {
    render(<MockupNewProject />);
    expect(screen.getByText(/no outputs yet/i)).toBeInTheDocument();
  });

  it('renders the chat panel with the opening exchange asking about style, output type, and goal', () => {
    render(<MockupNewProject />);
    const openingMessage = screen.getByText(/what style are you going for/i);
    expect(openingMessage).toBeInTheDocument();
    expect(openingMessage.textContent).toMatch(/style/i);
    expect(openingMessage.textContent).toMatch(/facebook image|logo|postcard/i);
    expect(openingMessage.textContent).toMatch(/trying to achieve/i);

    expect(screen.getByPlaceholderText(/message claude/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/message claude/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });
});

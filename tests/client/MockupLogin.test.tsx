import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MockupLogin from '../../client/src/pages/mockups/MockupLogin';

describe('MockupLogin', () => {
  it('renders the app-name heading and the Sign in with Google affordance', () => {
    render(<MockupLogin />);
    expect(
      screen.getByRole('heading', { name: /flyerbot/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/sign in with google/i)).toBeInTheDocument();
  });

  it('does not render a GitHub sign-in affordance', () => {
    render(<MockupLogin />);
    expect(screen.queryByText(/sign in with github/i)).not.toBeInTheDocument();
  });

  it('does not render a Pike13 sign-in affordance', () => {
    render(<MockupLogin />);
    expect(screen.queryByText(/pike/i)).not.toBeInTheDocument();
  });

  it('does not render a username/password demo form', () => {
    render(<MockupLogin />);
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('renders the Google affordance as a static, non-functional element', () => {
    render(<MockupLogin />);
    const googleAffordance = screen.getByText(/sign in with google/i).closest('a');
    expect(googleAffordance).toBeNull();

    const googleButton = screen.getByText(/sign in with google/i).closest('button');
    expect(googleButton).not.toBeNull();
    expect(googleButton).not.toHaveAttribute('href');
  });
});

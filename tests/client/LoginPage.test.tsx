import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Login from '../../client/src/pages/Login';

// ---- Mock AuthContext ----

const mockLoginWithCredentials = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../../client/src/context/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    loginWithCredentials: mockLoginWithCredentials,
    refresh: vi.fn(),
  }),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// ---- Helpers ----

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  );
}

// ---- Tests ----

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders form with username pre-filled as "user"', () => {
    renderLogin();
    const usernameInput = screen.getByLabelText(/username/i) as HTMLInputElement;
    expect(usernameInput.value).toBe('user');
  });

  it('renders form with password pre-filled as "pass"', () => {
    renderLogin();
    const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;
    expect(passwordInput.value).toBe('pass');
  });

  it('redirects to / on successful login', async () => {
    mockLoginWithCredentials.mockResolvedValue({ ok: true });
    const user = userEvent.setup();

    renderLogin();

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLoginWithCredentials).toHaveBeenCalledWith('user', 'pass');
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    });
  });

  it('shows error message on 401 (invalid credentials)', async () => {
    mockLoginWithCredentials.mockResolvedValue({ ok: false, error: 'Invalid credentials' });
    const user = userEvent.setup();

    renderLogin();

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials');
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not redirect when credentials are invalid', async () => {
    mockLoginWithCredentials.mockResolvedValue({ ok: false, error: 'Invalid username or password' });
    const user = userEvent.setup();

    renderLogin();

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('calls loginWithCredentials with typed credentials', async () => {
    mockLoginWithCredentials.mockResolvedValue({ ok: true });
    const user = userEvent.setup();

    renderLogin();

    const usernameInput = screen.getByLabelText(/username/i);
    const passwordInput = screen.getByLabelText(/password/i);

    await user.clear(usernameInput);
    await user.type(usernameInput, 'admin');
    await user.clear(passwordInput);
    await user.type(passwordInput, 'admin');

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLoginWithCredentials).toHaveBeenCalledWith('admin', 'admin');
    });
  });
});

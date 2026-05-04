import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Register from '../../client/src/pages/Register';

// ---- Mock AuthContext ----

const mockRegister = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../../client/src/context/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    loginWithCredentials: vi.fn(),
    register: mockRegister,
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

function renderRegister() {
  return render(
    <MemoryRouter>
      <Register />
    </MemoryRouter>,
  );
}

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  opts: {
    username?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
  } = {},
) {
  const {
    username = 'testuser',
    email = 'test@example.com',
    password = 'Secret1!',
    confirmPassword = 'Secret1!',
  } = opts;

  await user.type(screen.getByLabelText(/^username$/i), username);
  await user.type(screen.getByLabelText(/^email$/i), email);
  await user.type(screen.getByLabelText(/^password$/i), password);
  await user.type(screen.getByLabelText(/confirm password/i), confirmPassword);
}

// ---- Tests ----

describe('Register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks submit and shows inline error when passwords do not match', async () => {
    const user = userEvent.setup();
    renderRegister();

    await fillForm(user, { password: 'Secret1!', confirmPassword: 'Different2!' });
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match.');
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('renders "Pick another username." when server returns username_taken', async () => {
    mockRegister.mockResolvedValue({ ok: false, error: 'username_taken', field: 'username' });
    const user = userEvent.setup();
    renderRegister();

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Pick another username.');
    });
  });

  it('renders the email-taken message when server returns email_taken', async () => {
    mockRegister.mockResolvedValue({ ok: false, error: 'email_taken', field: 'email' });
    const user = userEvent.setup();
    renderRegister();

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'This email has been registered. Try to sign in.',
      );
    });
  });

  it('the "sign in" text in the email error is a link to /login', async () => {
    mockRegister.mockResolvedValue({ ok: false, error: 'email_taken', field: 'email' });
    const user = userEvent.setup();
    renderRegister();

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    const alert = await screen.findByRole('alert');
    const signInLink = within(alert).getByRole('link', { name: /sign in/i });
    expect(signInLink).toHaveAttribute('href', '/login');
  });

  it('renders the password rule message when server returns invalid_password', async () => {
    mockRegister.mockResolvedValue({ ok: false, error: 'invalid_password', field: 'password' });
    const user = userEvent.setup();
    renderRegister();

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Password must be at least 6 characters',
      );
    });
  });

  it('calls AuthContext.register with correct payload on submit', async () => {
    mockRegister.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderRegister();

    await fillForm(user, {
      username: 'alice',
      email: 'alice@example.com',
      password: 'Secret1!',
      confirmPassword: 'Secret1!',
    });
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith({
        username: 'alice',
        email: 'alice@example.com',
        password: 'Secret1!',
      });
    });
  });

  it('navigates to / after successful registration', async () => {
    mockRegister.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderRegister();

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });
});

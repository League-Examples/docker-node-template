import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const PASSWORD_RULE =
  'Password must be at least 6 characters and contain at least 2 of: lowercase, uppercase, digit, symbol.';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Client-side password match check
    if (password !== confirmPassword) {
      setFieldErrors({ confirmPassword: 'Passwords do not match.' });
      return;
    }

    setFieldErrors({});
    setLoading(true);
    const result = await register({ username, email, password });
    setLoading(false);

    if (result.ok) {
      navigate('/');
      return;
    }

    if (result.field === 'username') {
      setFieldErrors({ username: 'Pick another username.' });
    } else if (result.field === 'email') {
      setFieldErrors({ email: 'email_taken' });
    } else if (result.field === 'password') {
      setFieldErrors({ password: PASSWORD_RULE });
    } else {
      setFieldErrors({ _general: result.error ?? 'Registration failed. Please try again.' });
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="bg-white rounded-xl shadow-md w-full max-w-sm p-8">
        <h1 className="text-xl font-semibold text-slate-800 mb-1">Create account</h1>
        <p className="text-sm text-slate-500 mb-6">Register a new account</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="username" className="text-sm font-medium text-slate-700">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {fieldErrors.username && (
              <p role="alert" className="text-sm text-red-600">
                {fieldErrors.username}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {fieldErrors.email === 'email_taken' && (
              <p role="alert" className="text-sm text-red-600">
                This email has been registered. Try to{' '}
                <Link to="/login" className="font-medium text-indigo-600 hover:underline">
                  sign in
                </Link>
                .
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {fieldErrors.password && (
              <p role="alert" className="text-sm text-red-600">
                {fieldErrors.password}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="confirmPassword" className="text-sm font-medium text-slate-700">
              Confirm password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {fieldErrors.confirmPassword && (
              <p role="alert" className="text-sm text-red-600">
                {fieldErrors.confirmPassword}
              </p>
            )}
          </div>

          {fieldErrors._general && (
            <p role="alert" className="text-sm text-red-600">
              {fieldErrors._general}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <hr className="my-4 border-slate-200" />
        <p className="text-xs text-center text-slate-500">
          Already have an account?{' '}
          {/* To swap to a full button: replace this <Link> with a styled block link */}
          <Link to="/login" className="font-medium text-indigo-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

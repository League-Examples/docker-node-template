function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8a12 12 0 1 1 7.9-21l5.7-5.7A20 20 0 1 0 44 24c0-1.2-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8A12 12 0 0 1 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7A20 20 0 0 0 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3A12 12 0 0 1 12.7 28l-6.6 5.1A20 20 0 0 0 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.3-4 5.8l6.3 5.3c-.4.4 6.7-4.9 6.7-15.1 0-1.2-.1-2.4-.4-3.5z"/>
    </svg>
  );
}

/**
 * /mockups/login — Google-only login page wireframe (UC-001/SUC-005).
 *
 * Cross-reference: this is a static wireframe counterpart to the real
 * `client/src/pages/Login.tsx`, which already implements the Google-only
 * content goal by fetching `/api/integrations/status` via
 * `useProviderStatus` and conditionally rendering a working
 * `href="/api/auth/google"` link. This mockup keeps the same structure —
 * app-name heading, one tagline line, one Google sign-in affordance — but
 * renders the Google affordance as a static, non-functional `<button>`
 * (no `href`, no fetch call), per the mockups module's zero-fan-out /
 * no-backend-calls rule (architecture-update.md, Decision 4). If
 * `Login.tsx`'s structure changes, check whether this page should change
 * to match, and vice versa.
 */
export default function MockupLogin() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="bg-white rounded-xl shadow-md w-full max-w-sm p-8">
        <h1 className="text-xl font-semibold text-slate-800 mb-1">Flyerbot</h1>
        <p className="text-sm text-slate-500 mb-6">Sign in with your Google account.</p>

        <button
          type="button"
          disabled
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
        >
          <GoogleIcon className="w-5 h-5" />
          Sign in with Google
        </button>
      </div>
    </div>
  );
}

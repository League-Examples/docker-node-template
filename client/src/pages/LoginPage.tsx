export function LoginPage() {
  const params = new URLSearchParams(window.location.search)
  const denied = params.get('error') === 'denied'

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f5f5]">
      <div className="w-full max-w-sm p-8 bg-white rounded-xl shadow-md text-center">
        <img
          src="https://www.jointheleague.org/_astro/wordmark-h-1200.DPj-wZBK_Z2jTnVL.webp"
          alt="The LEAGUE of Amazing Programmers"
          className="mx-auto mb-6 h-10 object-contain"
        />
        <h1 className="text-xl font-bold text-slate-800 mb-1">LEAGUE Progress Report</h1>
        <p className="text-sm text-slate-500 mb-6">
          Sign in with your Pike13 account.<br />
          <span className="text-xs text-slate-400">Requires a @jointheleague.org email.</span>
        </p>
        {denied && (
          <p className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            Access denied. Only @jointheleague.org accounts can log in.
          </p>
        )}
        <a
          href="/api/auth/pike13"
          className="inline-block w-full py-2 px-4 rounded-lg font-medium text-white transition-colors"
          style={{ backgroundColor: '#f37121' }}
          onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#d95f0e')}
          onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#f37121')}
        >
          Sign in with Pike13
        </a>
      </div>
    </div>
  )
}

import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

export function PendingActivationPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    queryClient.clear()
    navigate('/login')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm p-8 bg-white rounded-xl shadow-md text-center space-y-4">
        <h1 className="text-xl font-bold text-slate-800">Account Pending Activation</h1>
        <p className="text-slate-600 text-sm">
          Your account has been created but is awaiting activation by an administrator.
          Please check back later.
        </p>
        <button
          onClick={handleLogout}
          className="text-sm text-blue-600 hover:underline"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}

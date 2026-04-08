import { useState } from 'react'
import { Link, useLocation, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useQueryClient } from '@tanstack/react-query'

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/reviews', label: 'Reviews' },
  { href: '/templates', label: 'Templates' },
  { href: '/checkin', label: 'Check-in' },
]

export function InstructorLayout() {
  const location = useLocation()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ ok: boolean; text: string } | null>(null)

  async function handleSync() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/instructor/sync/pike13', { method: 'POST' })
      if (res.ok) {
        const data = await res.json() as { studentsUpserted?: number; assignmentsCreated?: number }
        setSyncResult({ ok: true, text: `Synced — ${data.studentsUpserted ?? 0} students` })
        queryClient.invalidateQueries({ queryKey: ['dashboard'] })
        queryClient.invalidateQueries({ queryKey: ['instructor'] })
        queryClient.invalidateQueries({ queryKey: ['instructor-students'] })
        queryClient.invalidateQueries({ queryKey: ['reviews'] })
      } else {
        const err = await res.json().catch(() => ({ error: 'Sync failed' })) as { error?: string }
        setSyncResult({ ok: false, text: err.error ?? 'Sync failed' })
      }
    } catch {
      setSyncResult({ ok: false, text: 'Network error' })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="flex min-h-screen">
      <nav className="w-52 shrink-0 border-r border-slate-200 bg-white p-4 flex flex-col">
        <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-400">
          Instructor
        </p>
        <ul className="space-y-1">
          {NAV_LINKS.map(({ href, label }) => {
            const isActive = location.pathname === href || (href === '/reviews' && location.pathname.startsWith('/reviews'))
            return (
              <li key={href}>
                <Link
                  to={href}
                  className={`block rounded px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {label}
                </Link>
              </li>
            )
          })}
        </ul>

        {/* Sync button */}
        <div className="mt-6 border-t border-slate-200 pt-4">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="w-full rounded px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <span className={syncing ? 'animate-spin' : ''}>↻</span>
            {syncing ? 'Syncing…' : 'Sync Pike13'}
          </button>
          {syncResult && (
            <p className={`mt-1 px-3 text-xs ${syncResult.ok ? 'text-green-600' : 'text-red-500'}`}>
              {syncResult.text}
            </p>
          )}
        </div>

        {user?.role === 'ADMIN' && (
          <div className="mt-4 border-t border-slate-200 pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
              Admin
            </p>
            <Link
              to="/admin"
              className="block rounded px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
            >
              Admin Panel
            </Link>
          </div>
        )}
      </nav>
      <main className="flex-1 overflow-auto p-8">
        <Outlet />
      </main>
    </div>
  )
}

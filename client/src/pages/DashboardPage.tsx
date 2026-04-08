import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { MonthPicker } from '../components/MonthPicker'
import type { PendingCheckinResponse } from '../types/checkin'

interface DashboardData {
  month: string
  totalStudents: number
  pending: number
  draft: number
  sent: number
}

interface StudentRow {
  id: number
  name: string
  githubUsername: string | null
  assignedAt: string
}

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

async function fetchDashboard(month: string): Promise<DashboardData> {
  const res = await fetch(`/api/instructor/dashboard?month=${encodeURIComponent(month)}`)
  if (!res.ok) throw new Error('Failed to load dashboard')
  return res.json()
}

async function fetchStudents(): Promise<StudentRow[]> {
  const res = await fetch('/api/instructor/students')
  if (!res.ok) throw new Error('Failed to load students')
  return res.json()
}

async function fetchPendingCheckin(): Promise<PendingCheckinResponse> {
  const res = await fetch('/api/checkins/pending')
  if (!res.ok) throw new Error('Failed to load check-in status')
  return res.json()
}

interface StatCardProps {
  label: string
  value: number
  color?: string
}

function StatCard({ label, value, color = 'text-slate-800' }: StatCardProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

export function DashboardPage() {
  const [searchParams] = useSearchParams()
  const month = searchParams.get('month') ?? getCurrentMonth()
  const queryClient = useQueryClient()

  const [checkinDismissed, setCheckinDismissed] = useState(false)
  const [studentSortKey, setStudentSortKey] = useState<'name' | 'githubUsername'>('name')
  const [studentSortDir, setStudentSortDir] = useState<'asc' | 'desc'>('asc')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function handleSync() {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const res = await fetch('/api/instructor/sync/pike13', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setSyncMsg({ ok: true, text: `Sync complete — ${data.studentsUpserted ?? 0} students, ${data.assignmentsCreated ?? 0} assignments updated.` })
        queryClient.invalidateQueries({ queryKey: ['dashboard'] })
        queryClient.invalidateQueries({ queryKey: ['instructor'] })
        queryClient.invalidateQueries({ queryKey: ['instructor-students'] })
        queryClient.invalidateQueries({ queryKey: ['reviews'] })
      } else {
        const err = await res.json().catch(() => ({ error: 'Sync failed' }))
        setSyncMsg({ ok: false, text: err.error ?? 'Sync failed' })
      }
    } catch {
      setSyncMsg({ ok: false, text: 'Network error during sync' })
    } finally {
      setSyncing(false)
    }
  }

  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ['dashboard', month],
    queryFn: () => fetchDashboard(month),
  })

  const { data: studentList = [], isLoading: studentsLoading } = useQuery<StudentRow[]>({
    queryKey: ['instructor', 'students'],
    queryFn: fetchStudents,
  })

  const { data: checkinData } = useQuery<PendingCheckinResponse>({
    queryKey: ['checkins', 'pending'],
    queryFn: fetchPendingCheckin,
  })

  const sortedStudents = useMemo(() => {
    return [...studentList].sort((a, b) => {
      let cmp = 0
      if (studentSortKey === 'name') cmp = a.name.localeCompare(b.name)
      else if (studentSortKey === 'githubUsername') cmp = (a.githubUsername ?? '').localeCompare(b.githubUsername ?? '')
      return studentSortDir === 'asc' ? cmp : -cmp
    })
  }, [studentList, studentSortKey, studentSortDir])

  function handleStudentSort(key: 'name' | 'githubUsername') {
    if (key === studentSortKey) setStudentSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setStudentSortKey(key); setStudentSortDir('asc') }
  }

  const showCheckinBanner =
    !checkinDismissed &&
    checkinData !== undefined &&
    !checkinData.alreadySubmitted

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
        <div className="flex items-center gap-3">
          <MonthPicker />
          <button
            onClick={handleSync}
            disabled={syncing}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Sync Pike13'}
          </button>
        </div>
      </div>
      {syncMsg && (
        <p className={`mb-4 rounded-lg px-3 py-2 text-sm ${syncMsg.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {syncMsg.text}
        </p>
      )}

      {showCheckinBanner && (
        <div className="mb-6 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>
            Weekly TA check-in not yet submitted for {checkinData.weekOf}.{' '}
            <Link to="/checkin" className="font-medium underline">
              Submit now
            </Link>
          </span>
          <button
            onClick={() => setCheckinDismissed(true)}
            className="ml-4 text-amber-600 hover:text-amber-800"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {isLoading && <p className="text-slate-500">Loading…</p>}
      {error && <p className="text-red-600">Failed to load dashboard.</p>}

      {data && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Total Students" value={data.totalStudents} />
          <StatCard label="Pending" value={data.pending} color="text-slate-600" />
          <StatCard label="Draft" value={data.draft} color="text-amber-600" />
          <StatCard label="Sent" value={data.sent} color="text-green-600" />
        </div>
      )}

      {data && (
        <div className="mt-4">
          <Link
            to={`/reviews?month=${month}`}
            className="inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            View Reviews
          </Link>
        </div>
      )}

      {/* Student list */}
      <div className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">
          My Students
          {studentList.length > 0 && (
            <span className="ml-2 text-sm font-normal text-slate-500">
              ({studentList.length})
            </span>
          )}
        </h2>

        {studentsLoading && <p className="text-slate-500 text-sm">Loading students…</p>}

        {!studentsLoading && studentList.length === 0 && (
          <p className="text-sm text-slate-500">
            No students assigned yet. Run a Pike13 sync to import your roster.
          </p>
        )}

        {studentList.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th
                    className="cursor-pointer select-none px-4 py-2.5 text-left font-medium text-slate-600 hover:text-slate-800 whitespace-nowrap"
                    onClick={() => handleStudentSort('name')}
                  >
                    Name{' '}
                    {studentSortKey === 'name'
                      ? <span className="text-blue-600">{studentSortDir === 'asc' ? '↑' : '↓'}</span>
                      : <span className="text-slate-300">↕</span>}
                  </th>
                  <th
                    className="cursor-pointer select-none px-4 py-2.5 text-left font-medium text-slate-600 hover:text-slate-800 whitespace-nowrap"
                    onClick={() => handleStudentSort('githubUsername')}
                  >
                    GitHub{' '}
                    {studentSortKey === 'githubUsername'
                      ? <span className="text-blue-600">{studentSortDir === 'asc' ? '↑' : '↓'}</span>
                      : <span className="text-slate-300">↕</span>}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedStudents.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{s.name}</td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {s.githubUsername ? (
                        <span className="font-mono text-xs">{s.githubUsername}</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

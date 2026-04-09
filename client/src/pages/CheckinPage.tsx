import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import type { PendingCheckinResponse } from '../types/checkin'
import { Button } from '../components/ui/button'

async function fetchPendingCheckin(): Promise<PendingCheckinResponse> {
  const res = await fetch('/api/checkins')
  if (!res.ok) throw new Error('Failed to load check-in data')
  return res.json()
}

interface EntryState {
  taName: string
  wasPresent: boolean | null
}

export function CheckinPage() {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<EntryState[]>([])
  const [extraName, setExtraName] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [notifyStatus, setNotifyStatus] = useState<Record<string, boolean>>({})

  const { data, isLoading, error } = useQuery<PendingCheckinResponse>({
    queryKey: ['checkins', 'pending'],
    queryFn: fetchPendingCheckin,
  })

  useEffect(() => {
    if (data) {
      setEntries(data.entries.map((e) => ({ taName: e.taName, wasPresent: null })))
    }
  }, [data])

  function setPresence(taName: string, wasPresent: boolean) {
    setEntries((prev) =>
      prev.map((e) => (e.taName === taName ? { ...e, wasPresent } : e)),
    )
  }

  function addUnlisted() {
    const name = extraName.trim()
    if (!name || entries.some((e) => e.taName === name)) return
    setEntries((prev) => [...prev, { taName: name, wasPresent: null }])
    setExtraName('')
  }

  async function notifyAdmin(taName: string) {
    try {
      await fetch('/api/checkins/notify-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `TA ${taName} was present but has no system profile. Please create one.`,
        }),
      })
      setNotifyStatus((prev) => ({ ...prev, [taName]: true }))
    } catch {
      // silent
    }
  }

  async function handleSubmit() {
    if (!data) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/checkins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekOf: data.weekOf,
          entries: entries
            .filter((e) => e.wasPresent !== null)
            .map((e) => ({ taName: e.taName, wasPresent: e.wasPresent! })),
        }),
      })
      if (res.ok) {
        setSubmitted(true)
        navigate('/dashboard')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading) return <div className="p-8 text-slate-500">Loading…</div>
  if (error) return <div className="p-8 text-red-600">Failed to load check-in data.</div>
  if (!data) return null

  if (submitted || data.alreadySubmitted) {
    return (
      <div className="p-8 max-w-lg">
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-700">
          ✓ Check-in already submitted for week of {data.weekOf}.
        </div>
        <div className="mt-4">
          <Link to="/dashboard" className="text-sm text-blue-600 hover:underline">
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-lg">
      <div className="mb-4">
        <Link to="/dashboard" className="text-sm text-blue-600 hover:underline">
          ← Dashboard
        </Link>
      </div>

      <h1 className="text-xl font-bold text-slate-800 mb-1">Weekly TA Check-In</h1>
      <p className="text-sm text-slate-500 mb-6">Week of {data.weekOf}</p>

      {entries.length === 0 && (
        <p className="text-slate-500 mb-4">No TAs assigned this week.</p>
      )}

      {entries.map((entry) => (
        <div
          key={entry.taName}
          className="mb-3 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3"
        >
          <span className="font-medium text-slate-800">{entry.taName}</span>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1 text-sm cursor-pointer">
              <input
                type="radio"
                name={`ta-${entry.taName}`}
                checked={entry.wasPresent === true}
                onChange={() => setPresence(entry.taName, true)}
              />
              Present
            </label>
            <label className="flex items-center gap-1 text-sm cursor-pointer">
              <input
                type="radio"
                name={`ta-${entry.taName}`}
                checked={entry.wasPresent === false}
                onChange={() => setPresence(entry.taName, false)}
              />
              Absent
            </label>
            <button
              onClick={() => notifyAdmin(entry.taName)}
              disabled={notifyStatus[entry.taName]}
              className="text-xs text-blue-600 hover:underline disabled:text-slate-400"
            >
              {notifyStatus[entry.taName] ? 'Notified ✓' : 'Notify Admin'}
            </button>
          </div>
        </div>
      ))}

      <div className="mt-4 flex gap-2">
        <input
          type="text"
          placeholder="Add unlisted TA name…"
          value={extraName}
          onChange={(e) => setExtraName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addUnlisted()}
          className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <Button variant="outline" onClick={addUnlisted}>
          Add
        </Button>
      </div>

      <div className="mt-6">
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit Check-In'}
        </Button>
      </div>
    </div>
  )
}

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AdminFeedbackDto } from '../../types/admin'

async function fetchFeedback(): Promise<AdminFeedbackDto[]> {
  const res = await fetch('/api/admin/feedback')
  if (!res.ok) throw new Error('Failed to load feedback')
  return res.json()
}

type SortKey = 'studentName' | 'instructorName' | 'month' | 'rating' | 'submittedAt' | 'suggestion'
type SortDir = 'asc' | 'desc'

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <span className="ml-1 text-slate-300">↕</span>
  return <span className="ml-1 text-blue-600">{sortDir === 'asc' ? '↑' : '↓'}</span>
}

export function AdminFeedbackPanel() {
  const [sortKey, setSortKey] = useState<SortKey>('submittedAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const { data: rows = [], isLoading, error } = useQuery<AdminFeedbackDto[]>({
    queryKey: ['admin', 'feedback'],
    queryFn: fetchFeedback,
  })

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'studentName') cmp = a.studentName.localeCompare(b.studentName)
      else if (sortKey === 'instructorName') cmp = a.instructorName.localeCompare(b.instructorName)
      else if (sortKey === 'month') cmp = a.month.localeCompare(b.month)
      else if (sortKey === 'rating') cmp = a.rating - b.rating
      else if (sortKey === 'submittedAt') cmp = new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()
      else if (sortKey === 'suggestion') cmp = (a.suggestion ?? '').localeCompare(b.suggestion ?? '')
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, sortKey, sortDir])

  const thClass = 'cursor-pointer select-none px-4 py-3 text-left font-medium text-slate-600 hover:text-slate-800 whitespace-nowrap'

  return (
    <div className="max-w-5xl">
      <h1 className="mb-6 text-2xl font-bold text-slate-800">Guardian Feedback</h1>
      {isLoading && <p>Loading…</p>}
      {error && <p className="text-red-600">Failed to load feedback.</p>}
      {!isLoading && rows.length === 0 && <p>No feedback yet.</p>}
      {sorted.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className={thClass} onClick={() => handleSort('studentName')}>
                  Student <SortIcon col="studentName" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className={thClass} onClick={() => handleSort('instructorName')}>
                  Instructor <SortIcon col="instructorName" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className={thClass} onClick={() => handleSort('month')}>
                  Month <SortIcon col="month" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className={thClass} onClick={() => handleSort('rating')}>
                  Rating <SortIcon col="rating" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className={thClass} onClick={() => handleSort('suggestion')}>
                  Suggestion <SortIcon col="suggestion" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Comment</th>
                <th className={thClass} onClick={() => handleSort('submittedAt')}>
                  Submitted <SortIcon col="submittedAt" sortKey={sortKey} sortDir={sortDir} />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{r.studentName}</td>
                  <td className="px-4 py-3 text-slate-700">{r.instructorName}</td>
                  <td className="px-4 py-3 text-slate-700">{r.month}</td>
                  <td className="px-4 py-3 text-slate-700">{r.rating}</td>
                  <td className="px-4 py-3 text-slate-600">{r.suggestion ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{r.comment ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{new Date(r.submittedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

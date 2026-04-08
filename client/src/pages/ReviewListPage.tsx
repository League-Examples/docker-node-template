import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { MonthPicker } from '../components/MonthPicker'
import type { ReviewDto } from '../types/review'

interface StudentDto {
  id: number
  name: string
  githubUsername: string | null
  attendanceDates: string[]
}

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

async function fetchReviews(month: string): Promise<ReviewDto[]> {
  const res = await fetch(`/api/reviews?month=${encodeURIComponent(month)}`)
  if (!res.ok) throw new Error('Failed to load reviews')
  return res.json()
}

async function fetchStudents(month: string): Promise<StudentDto[]> {
  const res = await fetch(`/api/instructor/students?month=${encodeURIComponent(month)}`)
  if (!res.ok) throw new Error('Failed to load students')
  return res.json()
}

async function createReview(studentId: number, month: string): Promise<ReviewDto> {
  const res = await fetch('/api/reviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, month }),
  })
  if (!res.ok) throw new Error('Failed to create review')
  return res.json()
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-600',
  draft: 'bg-amber-100 text-amber-700',
  sent: 'bg-green-100 text-green-700',
}

export function ReviewListPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const month = searchParams.get('month') ?? getCurrentMonth()
  const queryClient = useQueryClient()

  const { data: reviews = [], isLoading: reviewsLoading } = useQuery<ReviewDto[]>({
    queryKey: ['reviews', month],
    queryFn: () => fetchReviews(month),
  })

  const { data: students = [], isLoading: studentsLoading } = useQuery<StudentDto[]>({
    queryKey: ['instructor-students', month],
    queryFn: () => fetchStudents(month),
  })

  const createMutation = useMutation({
    mutationFn: ({ studentId }: { studentId: number }) => createReview(studentId, month),
    onSuccess: (review) => {
      queryClient.invalidateQueries({ queryKey: ['reviews', month] })
      navigate(`/reviews/${review.id}`)
    },
  })

  const reviewedStudentIds = new Set(reviews.map((r) => r.studentId))
  const unreviewed = students.filter((s) => !reviewedStudentIds.has(s.id))

  const isLoading = reviewsLoading || studentsLoading

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Reviews</h1>
        <MonthPicker />
      </div>

      {isLoading && <p className="text-slate-500">Loading…</p>}

      {!isLoading && students.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-slate-500">
          <p className="font-medium mb-1">No students assigned yet.</p>
          <p className="text-sm">Students are synced from Pike13. Try logging out and back in to trigger a sync.</p>
        </div>
      )}

      {/* Existing reviews for this month */}
      {reviews.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">This Month</h2>
          <div className="space-y-2">
            {reviews.map((r) => {
              const studentInfo = students.find((s) => s.id === r.studentId)
              return (
                <Link
                  key={r.id}
                  to={`/reviews/${r.id}`}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50"
                >
                  <div>
                    <span className="font-medium text-slate-800">{r.studentName}</span>
                    {studentInfo && studentInfo.attendanceDates.length > 0 && (
                      <div className="mt-0.5 text-xs text-slate-400">
                        Attended: {studentInfo.attendanceDates.map((d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })).join(', ')}
                      </div>
                    )}
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[r.status] ?? ''}`}>
                    {r.status}
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Students without a review yet */}
      {unreviewed.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Start a Review
          </h2>
          <div className="space-y-2">
            {unreviewed.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-lg border border-dashed border-slate-300 bg-white px-4 py-3"
              >
                <div>
                  <span className="font-medium text-slate-700">{s.name}</span>
                  {s.githubUsername && (
                    <span className="ml-2 text-xs text-slate-400">@{s.githubUsername}</span>
                  )}
                  {s.attendanceDates.length > 0 && (
                    <div className="mt-0.5 text-xs text-slate-400">
                      Attended: {s.attendanceDates.map((d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })).join(', ')}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => createMutation.mutate({ studentId: s.id })}
                  disabled={createMutation.isPending}
                  className="rounded-md bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
                >
                  Write Review
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

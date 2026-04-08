import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { MonthPicker } from '../../components/MonthPicker'
import type { AdminNotificationDto } from '../../types/admin'

interface Pike13StatusDto {
  connected: boolean
}

interface Pike13SyncResultDto {
  studentsUpserted: number
  assignmentsCreated: number
  hoursCreated: number
}

interface AnalyticsDto {
  month: string
  totalSent: number
  needToSend: number
  totalFeedback: number
  monthFeedbackCount: number
  feedbackRate: number
  avgRating: number | null
  topSuggestions: Array<{ suggestion: string | null; count: number }>
}

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

async function fetchNotifications(): Promise<AdminNotificationDto[]> {
  const res = await fetch('/api/admin/notifications')
  if (!res.ok) throw new Error('Failed to load notifications')
  return res.json()
}

async function markRead(id: number): Promise<void> {
  const res = await fetch(`/api/admin/notifications/${id}/read`, { method: 'PATCH' })
  if (!res.ok) throw new Error('Failed to mark notification as read')
}

async function fetchPike13Status(): Promise<Pike13StatusDto> {
  const res = await fetch('/api/admin/pike13/status')
  if (!res.ok) throw new Error('Failed to load Pike13 status')
  return res.json()
}

async function triggerPike13Sync(): Promise<Pike13SyncResultDto> {
  const res = await fetch('/api/admin/sync/pike13', { method: 'POST' })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error ?? 'Sync failed')
  }
  return res.json()
}

async function fetchAnalytics(month: string): Promise<AnalyticsDto> {
  const res = await fetch(`/api/admin/analytics?month=${encodeURIComponent(month)}`)
  if (!res.ok) throw new Error('Failed to load analytics')
  return res.json()
}

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  color?: string
}

function StatCard({ label, value, sub, color = 'text-slate-800' }: StatCardProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  )
}

export function AdminDashboardPanel() {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const month = searchParams.get('month') ?? getCurrentMonth()

  const [showAllNotifications, setShowAllNotifications] = useState(false)

  const { data: notifications = [], isLoading, error } = useQuery<AdminNotificationDto[]>({
    queryKey: ['admin', 'notifications'],
    queryFn: () => fetchNotifications(),
  })

  const { data: pike13Status } = useQuery<Pike13StatusDto>({
    queryKey: ['admin', 'pike13', 'status'],
    queryFn: fetchPike13Status,
  })

  const { data: analytics } = useQuery<AnalyticsDto>({
    queryKey: ['admin', 'analytics', month],
    queryFn: () => fetchAnalytics(month),
  })

  const unreadCount = notifications.filter((n) => !n.isRead).length

  const markReadMutation = useMutation({
    mutationFn: (id: number) => markRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'notifications'] }),
  })

  const syncMutation = useMutation({
    mutationFn: triggerPike13Sync,
  })

  const visibleNotifications = showAllNotifications
    ? notifications
    : notifications.filter((n) => !n.isRead)

  return (
    <div className="max-w-4xl space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-800">Admin Dashboard</h1>
          {unreadCount > 0 && (
            <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
              {unreadCount}
            </span>
          )}
        </div>
        <MonthPicker />
      </div>

      {/* Analytics section */}
      {analytics && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-slate-700">Review Analytics — {analytics.month}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard
              label="Sent this month"
              value={analytics.totalSent}
              color="text-green-600"
            />
            <StatCard
              label="Still need to send"
              value={analytics.needToSend}
              color={analytics.needToSend > 0 ? 'text-amber-600' : 'text-slate-400'}
            />
            <StatCard
              label="Feedback received"
              value={analytics.monthFeedbackCount}
              sub={`${analytics.feedbackRate}% response rate`}
              color="text-blue-600"
            />
            <StatCard
              label="Avg rating"
              value={analytics.avgRating !== null ? `${analytics.avgRating} / 5` : '—'}
              sub={`${analytics.totalFeedback} total responses`}
              color="text-purple-600"
            />
          </div>

          {analytics.topSuggestions.length > 0 && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Top Improvement Suggestions</p>
              <ul className="space-y-2">
                {analytics.topSuggestions.map((s, i) => (
                  <li key={i} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">{s.suggestion ?? '—'}</span>
                    <span className="ml-4 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                      {s.count}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Notifications section */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-slate-700">Notifications</h2>
          {notifications.length > 0 && (
            <button
              onClick={() => setShowAllNotifications((v) => !v)}
              className="text-xs text-blue-600 hover:underline"
            >
              {showAllNotifications ? 'Show unread only' : `Show all (${notifications.length})`}
            </button>
          )}
        </div>

        {isLoading && <p className="text-slate-500">Loading…</p>}
        {error && <p className="text-red-600">Failed to load notifications.</p>}

        {!isLoading && visibleNotifications.length === 0 && (
          <p className="text-slate-500 text-sm">No unread notifications.</p>
        )}

        {visibleNotifications.length > 0 && (
          <ul className="space-y-3">
            {visibleNotifications.map((n) => (
              <li
                key={n.id}
                className={`flex items-start justify-between rounded-lg border px-4 py-3 shadow-sm ${
                  n.isRead ? 'border-slate-100 bg-slate-50' : 'border-slate-200 bg-white'
                }`}
              >
                <div>
                  <p className={`text-sm font-medium ${n.isRead ? 'text-slate-500' : 'text-slate-800'}`}>{n.fromUserName}</p>
                  <p className="mt-0.5 text-sm text-slate-600">{n.message}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {new Date(n.createdAt).toLocaleDateString()}
                  </p>
                </div>
                {!n.isRead && (
                  <button
                    onClick={() => markReadMutation.mutate(n.id)}
                    disabled={markReadMutation.isPending}
                    className="ml-4 shrink-0 rounded bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                  >
                    Mark as Read
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Pike13 section */}
      {pike13Status !== undefined && (
        <section>
          <h2 className="text-lg font-semibold text-slate-700 mb-3">Pike13</h2>

          {pike13Status.connected ? (
            <div className="space-y-3">
              <p className="font-medium text-green-600">Connected</p>
              <button
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {syncMutation.isPending ? 'Syncing…' : 'Sync Pike13'}
              </button>
              {syncMutation.isSuccess && syncMutation.data && (
                <p className="text-sm text-slate-700">
                  Synced: {syncMutation.data.studentsUpserted} students,{' '}
                  {syncMutation.data.assignmentsCreated} assignments,{' '}
                  {syncMutation.data.hoursCreated} hours
                </p>
              )}
              {syncMutation.isError && (
                <p className="text-sm text-red-600">
                  {(syncMutation.error as Error).message}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-slate-600">Not Connected</p>
              <button
                onClick={() => { window.location.href = '/api/admin/pike13/connect' }}
                className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Connect Pike13
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

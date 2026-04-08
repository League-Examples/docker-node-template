import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import type { ReviewDto } from '../types/review'
import type { TemplateDto } from '../types/template'
import { Button } from '../components/ui/button'

async function fetchReview(id: string): Promise<ReviewDto> {
  const res = await fetch(`/api/reviews/${id}`)
  if (!res.ok) throw new Error('Failed to load review')
  return res.json()
}

async function fetchTemplates(): Promise<TemplateDto[]> {
  const res = await fetch('/api/templates')
  if (!res.ok) throw new Error('Failed to load templates')
  return res.json()
}

function applyTemplate(template: TemplateDto, studentName: string, month: string): { subject: string; body: string } {
  return {
    subject: template.subject
      .replace(/\{\{studentName\}\}/g, studentName)
      .replace(/\{\{month\}\}/g, month),
    body: template.body
      .replace(/\{\{studentName\}\}/g, studentName)
      .replace(/\{\{month\}\}/g, month),
  }
}

export function ReviewEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: review, isLoading, error } = useQuery<ReviewDto>({
    queryKey: ['review', id],
    queryFn: () => fetchReview(id!),
    enabled: !!id,
  })

  const { data: templates = [] } = useQuery<TemplateDto[]>({
    queryKey: ['templates'],
    queryFn: fetchTemplates,
  })

  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [dirty, setDirty] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showTestSend, setShowTestSend] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [testSendState, setTestSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [generateState, setGenerateState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [generateError, setGenerateError] = useState('')

  useEffect(() => {
    if (review) {
      setSubject(review.subject ?? '')
      setBody(review.body ?? '')
    }
  }, [review])

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/reviews/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body }),
      })
      if (!res.ok) throw new Error('Failed to save draft')
      return res.json() as Promise<ReviewDto>
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['review', id], updated)
      setDirty(false)
    },
  })

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/reviews/${id}/send`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to mark as sent')
      return res.json() as Promise<ReviewDto>
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['review', id], updated)
    },
  })

  if (isLoading) return <div className="p-8 text-slate-500">Loading…</div>
  if (error || !review) return <div className="p-8 text-red-600">Review not found.</div>

  const isSent = review.status === 'sent'
  const month = review.month

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => navigate(`/reviews?month=${month}`)}
          className="text-sm text-blue-600 hover:underline"
        >
          ← Reviews
        </button>
        <span className="text-slate-400">/</span>
        <span className="text-sm text-slate-600">{review.studentName}</span>
      </div>

      <h1 className="text-xl font-bold text-slate-800 mb-1">{review.studentName}</h1>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm text-slate-500">{month}</span>
        {review.githubUsername && (
          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            @{review.githubUsername}
          </span>
        )}
      </div>

      {isSent && (
        <div className="mb-4 rounded bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">
          This review has been marked as sent.
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => { setSubject(e.target.value); setDirty(true) }}
            disabled={isSent}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Body</label>
          <textarea
            value={body}
            onChange={(e) => { setBody(e.target.value); setDirty(true) }}
            disabled={isSent}
            rows={10}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </div>
      </div>

      {!isSent && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save Draft'}
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowTemplates((v) => !v)}
          >
            Apply Template
          </Button>
          <Button
            variant="outline"
            disabled={!review.githubUsername || generateState === 'loading'}
            title={review.githubUsername ? 'Generate a draft using GitHub commits this month' : 'No GitHub username linked for this student'}
            onClick={async () => {
              setGenerateState('loading')
              setGenerateError('')
              try {
                const res = await fetch(`/api/reviews/${id}/generate-github-draft`, { method: 'POST' })
                if (!res.ok) {
                  const data = await res.json().catch(() => ({}))
                  throw new Error((data as { error?: string }).error ?? 'Generation failed')
                }
                const data = await res.json() as { body: string; commitCount: number; repoCount: number }
                setBody(data.body)
                setDirty(true)
                setGenerateState('idle')
              } catch (err) {
                setGenerateError((err as Error).message)
                setGenerateState('error')
              }
            }}
          >
            {generateState === 'loading' ? 'Generating…' : 'Generate from GitHub'}
          </Button>
          <Button
            variant="outline"
            onClick={() => { setShowTestSend((v) => !v); setTestSendState('idle') }}
          >
            Send Test Email
          </Button>
          <Button
            onClick={() => sendMutation.mutate()}
            disabled={sendMutation.isPending}
            className="bg-green-600 hover:bg-green-700"
          >
            {sendMutation.isPending ? 'Sending…' : 'Send to Guardian'}
          </Button>
        </div>
      )}

      {!isSent && showTestSend && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="mb-2 text-sm font-semibold text-amber-800">Send a test copy to any email address</p>
          <p className="mb-3 text-xs text-amber-700">The review status won't change — this is just a preview of what the guardian will receive.</p>
          <div className="flex gap-2">
            <input
              type="email"
              value={testEmail}
              onChange={(e) => { setTestEmail(e.target.value); setTestSendState('idle') }}
              placeholder="you@jointheleague.org"
              className="flex-1 rounded border border-amber-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <Button
              onClick={async () => {
                setTestSendState('sending')
                try {
                  const res = await fetch(`/api/reviews/${id}/send-test`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ testEmail }),
                  })
                  if (!res.ok) throw new Error()
                  setTestSendState('sent')
                } catch {
                  setTestSendState('error')
                }
              }}
              disabled={testSendState === 'sending' || !testEmail}
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              {testSendState === 'sending' ? 'Sending…' : 'Send Test'}
            </Button>
          </div>
          {testSendState === 'sent' && (
            <p className="mt-2 text-sm text-green-700">Test email sent to {testEmail}!</p>
          )}
          {testSendState === 'error' && (
            <p className="mt-2 text-sm text-red-600">Failed to send test email. Check that SendGrid is configured.</p>
          )}
        </div>
      )}

      {saveMutation.isError && (
        <p className="mt-2 text-sm text-red-600">Failed to save. Please try again.</p>
      )}
      {sendMutation.isError && (
        <p className="mt-2 text-sm text-red-600">Failed to mark as sent. Please try again.</p>
      )}
      {generateState === 'error' && (
        <p className="mt-2 text-sm text-red-600">Generate failed: {generateError}</p>
      )}

      {showTemplates && templates.length > 0 && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-md">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Choose a Template</h2>
          <ul className="space-y-1">
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => {
                    const applied = applyTemplate(t, review.studentName, month)
                    setSubject(applied.subject)
                    setBody(applied.body)
                    setDirty(true)
                    setShowTemplates(false)
                  }}
                  className="w-full text-left rounded px-2 py-1.5 text-sm hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-800">{t.name}</span>
                  <span className="ml-2 text-slate-500">{t.subject}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showTemplates && templates.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">
          No templates yet.{' '}
          <a href="/templates/new" className="text-blue-600 underline">Create one</a>
        </p>
      )}
    </div>
  )
}

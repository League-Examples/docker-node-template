import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import type { FeedbackContextDto } from '../types/feedback'

type State = 'loading' | 'not-found' | 'already-submitted' | 'form' | 'confirmed'

function StarRating({ rating, onChange }: { rating: number; onChange: (n: number) => void }) {
  const [hovered, setHovered] = useState(0)

  return (
    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', margin: '0 0 20px 0' }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= (hovered || rating)
        return (
          <span
            key={n}
            role="button"
            aria-label={`${n} star`}
            onClick={() => onChange(n)}
            onMouseEnter={() => setHovered(n)}
            onMouseLeave={() => setHovered(0)}
            style={{
              fontSize: '40px',
              cursor: 'pointer',
              color: filled ? '#f59e0b' : 'transparent',
              WebkitTextStroke: filled ? 'none' : '2px #d1d5db',
              transition: 'color 0.1s, -webkit-text-stroke 0.1s',
              lineHeight: 1,
              userSelect: 'none',
            }}
          >
            ★
          </span>
        )
      })}
    </div>
  )
}

export function FeedbackPage() {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<State>('loading')
  const [context, setContext] = useState<FeedbackContextDto | null>(null)
  const [rating, setRating] = useState<number>(0)
  const [comment, setComment] = useState('')
  const [suggestion, setSuggestion] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch(`/api/feedback/${token}`)
      .then(async (res) => {
        if (res.status === 404) { setState('not-found'); return }
        const data: FeedbackContextDto = await res.json()
        setContext(data)
        setState(data.alreadySubmitted ? 'already-submitted' : 'form')
      })
      .catch(() => setState('not-found'))
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    const body: Record<string, unknown> = { rating }
    if (comment.trim()) body.comment = comment.trim()
    if (suggestion) body.suggestion = suggestion
    const res = await fetch(`/api/feedback/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSubmitting(false)
    if (res.status === 409) { setState('already-submitted'); return }
    if (res.ok) setState('confirmed')
  }

  const card: React.CSSProperties = {
    maxWidth: '520px',
    margin: '48px auto',
    background: '#ffffff',
    borderRadius: '12px',
    boxShadow: '0 2px 16px rgba(0,0,0,0.10)',
    overflow: 'hidden',
    fontFamily: 'Inter, Arial, sans-serif',
  }

  const header: React.CSSProperties = {
    background: '#f37121',
    padding: '24px 32px',
    textAlign: 'center',
  }

  const titleBar: React.CSSProperties = {
    background: '#1e293b',
    padding: '14px 32px',
  }

  const bodyStyle: React.CSSProperties = {
    padding: '32px',
  }

  if (state === 'loading') return (
    <div style={{ textAlign: 'center', padding: '80px', fontFamily: 'Inter, Arial, sans-serif', color: '#6b7280' }}>
      Loading…
    </div>
  )

  if (state === 'not-found') return (
    <div style={{ textAlign: 'center', padding: '80px', fontFamily: 'Inter, Arial, sans-serif', color: '#6b7280' }}>
      Feedback link not found.
    </div>
  )

  if (state === 'already-submitted') return (
    <div style={card}>
      <div style={header}>
        <img src="https://www.jointheleague.org/_astro/wordmark-h-1200.DPj-wZBK_Z2jTnVL.webp"
          alt="The LEAGUE of Amazing Programmers" width="220"
          style={{ display: 'block', margin: '0 auto' }} />
      </div>
      <div style={{ padding: '40px 32px', textAlign: 'center' }}>
        <p style={{ fontSize: '18px', fontWeight: 700, color: '#1e293b', margin: '0 0 8px 0' }}>Already submitted</p>
        <p style={{ color: '#6b7280', margin: 0 }}>Feedback for this report has already been recorded. Thank you!</p>
      </div>
    </div>
  )

  if (state === 'confirmed') return (
    <div style={card}>
      <div style={header}>
        <img src="https://www.jointheleague.org/_astro/wordmark-h-1200.DPj-wZBK_Z2jTnVL.webp"
          alt="The LEAGUE of Amazing Programmers" width="220"
          style={{ display: 'block', margin: '0 auto' }} />
      </div>
      <div style={{ padding: '40px 32px', textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎉</div>
        <p style={{ fontSize: '20px', fontWeight: 700, color: '#1e293b', margin: '0 0 8px 0' }}>Thank you!</p>
        <p style={{ color: '#6b7280', margin: 0 }}>Your feedback helps us improve every student's experience.</p>
      </div>
    </div>
  )

  return (
    <div style={{ background: '#f5f5f5', minHeight: '100vh', padding: '16px' }}>
      <div style={card}>
        {/* Header */}
        <div style={header}>
          <img src="https://www.jointheleague.org/_astro/wordmark-h-1200.DPj-wZBK_Z2jTnVL.webp"
            alt="The LEAGUE of Amazing Programmers" width="220"
            style={{ display: 'block', margin: '0 auto' }} />
        </div>

        {/* Title bar */}
        <div style={titleBar}>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: '12px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Monthly Progress Report
          </p>
          <p style={{ margin: '4px 0 0 0', color: '#f37121', fontSize: '18px', fontWeight: 700 }}>
            {context?.studentName} &mdash; {context?.month}
          </p>
        </div>

        {/* Form body */}
        <div style={bodyStyle}>
          <form onSubmit={handleSubmit}>
            <p style={{ textAlign: 'center', fontWeight: 700, fontSize: '17px', color: '#1e293b', margin: '0 0 6px 0' }}>
              How are we doing?
            </p>
            <p style={{ textAlign: 'center', color: '#6b7280', fontSize: '14px', margin: '0 0 24px 0' }}>
              Rate {context?.studentName}'s experience with LEAGUE
            </p>

            <StarRating rating={rating} onChange={setRating} />

            <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>
              What could we improve? <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional)</span>
            </label>
            <select
              aria-label="Suggestion"
              value={suggestion}
              onChange={(e) => setSuggestion(e.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                padding: '10px 12px',
                fontSize: '15px',
                color: suggestion ? '#374151' : '#9ca3af',
                background: '#fff',
                outline: 'none',
                fontFamily: 'Inter, Arial, sans-serif',
                marginBottom: '16px',
                appearance: 'auto',
              }}
            >
              <option value="">Select a suggestion…</option>
              <option value="More frequent progress updates">More frequent progress updates</option>
              <option value="More advanced topics">More advanced topics</option>
              <option value="More beginner-friendly pacing">More beginner-friendly pacing</option>
              <option value="More hands-on projects">More hands-on projects</option>
              <option value="More one-on-one instructor time">More one-on-one instructor time</option>
              <option value="Offer online or hybrid classes">Offer online or hybrid classes</option>
              <option value="Offer additional class times">Offer additional class times</option>
              <option value="Better curriculum materials">Better curriculum materials</option>
              <option value="Improve communication with families">Improve communication with families</option>
              <option value="Other">Other</option>
            </select>

            <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>
              Additional comments <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional)</span>
            </label>
            <textarea
              aria-label="Comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Share anything you'd like us to know…"
              rows={5}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '15px',
                color: '#374151',
                resize: 'vertical',
                outline: 'none',
                fontFamily: 'Inter, Arial, sans-serif',
                marginBottom: '20px',
              }}
            />

            <button
              type="submit"
              disabled={submitting || rating === 0}
              style={{
                width: '100%',
                padding: '14px',
                background: rating === 0 ? '#d1d5db' : '#f37121',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '16px',
                border: 'none',
                borderRadius: '8px',
                cursor: rating === 0 ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
                letterSpacing: '0.02em',
              }}
            >
              {submitting ? 'Submitting…' : 'Submit Feedback'}
            </button>

            {rating === 0 && (
              <p style={{ textAlign: 'center', fontSize: '13px', color: '#9ca3af', margin: '10px 0 0 0' }}>
                Please select a star rating to continue
              </p>
            )}
          </form>
        </div>

        {/* Footer */}
        <div style={{ background: '#1e293b', padding: '16px 32px', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>
            &copy; {new Date().getFullYear()} The LEAGUE of Amazing Programmers &bull;{' '}
            <a href="https://www.jointheleague.org" style={{ color: '#f37121', textDecoration: 'none' }}>
              jointheleague.org
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}

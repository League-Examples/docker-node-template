import { useSearchParams, useNavigate } from 'react-router-dom'

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

/** Returns the last N calendar months as YYYY-MM strings, most recent first. */
function getMonthOptions(count = 12): string[] {
  const options: string[] = []
  const d = new Date()
  for (let i = 0; i < count; i++) {
    options.push(d.toISOString().slice(0, 7))
    d.setMonth(d.getMonth() - 1)
  }
  return options
}

function formatMonthLabel(ym: string): string {
  const [year, month] = ym.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
  })
}

interface MonthPickerProps {
  className?: string
}

export function MonthPicker({ className }: MonthPickerProps) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const selected = searchParams.get('month') ?? getCurrentMonth()
  const options = getMonthOptions(12)

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newParams = new URLSearchParams(searchParams.toString())
    newParams.set('month', e.target.value)
    navigate('?' + newParams.toString())
  }

  return (
    <select
      value={selected}
      onChange={handleChange}
      className={`rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 ${className ?? ''}`}
      aria-label="Select month"
    >
      {options.map((ym) => (
        <option key={ym} value={ym}>
          {formatMonthLabel(ym)}
        </option>
      ))}
    </select>
  )
}

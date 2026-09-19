import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { monthKey, shiftMonth } from '../lib/tracker'
import type { Month } from '../lib/tracker'

const monthNames = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat('en', { month: 'long' }).format(new Date(2024, month, 1)),
)

interface MonthPickerProps {
  month: Month
  today: Date
  onChange: (month: Month) => void
}

export function MonthPicker({ month, today, onChange }: MonthPickerProps) {
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(month.year)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const currentMonth = { year: today.getFullYear(), month: today.getMonth() }
  const isCurrent = monthKey(month) === monthKey(currentMonth)

  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLButtonElement>('.month-option[aria-pressed="true"]')?.focus()

    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }

    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
        trigger.current?.focus()
      }
    }

    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  function choose(nextMonth: Month) {
    onChange(nextMonth)
    setOpen(false)
    trigger.current?.focus()
  }

  return (
    <div className="month-navigation" ref={root}>
      {open && (
        <div className="month-popover" role="dialog" aria-label="Choose a month">
          <div className="month-popover-heading">
            <button className="icon-button" aria-label="Previous year" disabled={year === 0} onClick={() => setYear(year - 1)}>
              <ChevronLeft size={17} />
            </button>
            <span aria-live="polite">{year}</span>
            <button className="icon-button" aria-label="Next year" disabled={year === 9999} onClick={() => setYear(year + 1)}>
              <ChevronRight size={17} />
            </button>
          </div>
          <div className="month-options">
            {monthNames.map((name, index) => (
              <button
                key={name}
                className="month-option"
                aria-label={`${name} ${year}`}
                aria-pressed={month.year === year && month.month === index}
                onClick={() => choose({ year, month: index })}
              >
                {name.slice(0, 3)}
              </button>
            ))}
          </div>
          <button className="back-to-today" onClick={() => choose(currentMonth)}>
            Back to this month <ArrowRight size={13} />
          </button>
        </div>
      )}
      <div className="month-controls">
        <button
          className="month-arrow"
          aria-label="Previous month"
          disabled={month.year === 0 && month.month === 0}
          onClick={() => {
            setOpen(false)
            onChange(shiftMonth(month, -1))
          }}
        >
          <ArrowLeft size={18} strokeWidth={1.4} />
        </button>
        <button
          ref={trigger}
          className="month-trigger"
          aria-label={`Choose month, ${monthNames[month.month]} ${month.year}`}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => {
            setYear(month.year)
            setOpen(!open)
          }}
        >
          <span className="month-name">{monthNames[month.month]}</span>
          <span className="month-year">{month.year}</span>
          <ChevronDown className={open ? 'is-rotated' : ''} size={12} strokeWidth={1.5} />
        </button>
        <button
          className="month-arrow"
          aria-label="Next month"
          disabled={month.year === 9999 && month.month === 11}
          onClick={() => {
            setOpen(false)
            onChange(shiftMonth(month, 1))
          }}
        >
          <ArrowRight size={18} strokeWidth={1.4} />
        </button>
      </div>
      <div className="month-caption">
        {isCurrent ? (
          <span>A NEW DAY. ANOTHER CHANCE.</span>
        ) : (
          <button onClick={() => choose(currentMonth)}>Return to this month <span aria-hidden="true">&rarr;</span></button>
        )}
      </div>
    </div>
  )
}

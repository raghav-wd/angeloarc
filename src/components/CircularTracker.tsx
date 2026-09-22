import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, LockKeyhole, Plus } from 'lucide-react'
import type { CSSProperties, KeyboardEvent } from 'react'
import type { CursorFeedback } from './CustomCursor'
import { habitLabelProgress, sweepProgress, TEXT_SWEEP } from '../lib/radialSweep'
import {
  annularSectorPath,
  dateKey,
  daysInMonth,
  formatFullDate,
  getDaySectors,
  getHabitsForMonth,
  getMonthStats,
  habitAvailableFrom,
  isHabitAvailableOnDate,
  isFutureDate,
  polarPoint,
} from '../lib/tracker'
import type { Habit, Month, MonthHabit, TrackerState } from '../lib/tracker'

function sweepStyle(progress: number, extra?: CSSProperties): CSSProperties {
  return { ...extra, '--sweep': progress } as CSSProperties
}

interface HoveredCell {
  habit: MonthHabit
  day: number
  x: number
  y: number
  keyboard: boolean
}

interface CircularTrackerProps {
  state: TrackerState
  month: Month
  today: Date
  onToggle: (day: number, habit: MonthHabit, feedback: CursorFeedback) => boolean
}

function CellTooltip({
  cell,
  month,
  done,
  future,
  unavailable,
  availableFrom,
}: {
  cell: HoveredCell
  month: Month
  done: boolean
  future: boolean
  unavailable: boolean
  availableFrom: string
}) {
  const tooltip = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    function position(x: number, y: number) {
      const element = tooltip.current
      if (!element) return
      const width = element.offsetWidth
      const height = element.offsetHeight
      const left = x + width + 28 > window.innerWidth - 16 ? x - width - 28 : x + 28
      const top = y + height + 26 > window.innerHeight - 16 ? y - height - 26 : y + 26
      element.style.left = `${Math.max(12, Math.min(left, window.innerWidth - width - 12))}px`
      element.style.top = `${Math.max(12, Math.min(top, window.innerHeight - height - 12))}px`
    }

    position(cell.x, cell.y)
    if (cell.keyboard) return

    function move(event: PointerEvent) {
      position(event.clientX, event.clientY)
    }

    window.addEventListener('pointermove', move, { passive: true })
    return () => window.removeEventListener('pointermove', move)
  }, [cell])

  const date = new Date(`${dateKey(month, cell.day)}T12:00:00Z`)

  return createPortal(
    <div ref={tooltip} id="cell-tooltip" className="cell-tooltip" role="tooltip">
      <p className="tooltip-date">
        {new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date)}
        <span>{month.year}</span>
      </p>
      <div className="tooltip-habit">
        <span>{cell.habit.name}</span>
        {future || unavailable ? <LockKeyhole size={14} strokeWidth={1.5} /> : done ? <Check size={16} strokeWidth={1.7} /> : <Plus size={15} strokeWidth={1.4} />}
      </div>
      <p className="tooltip-action">
        {unavailable
          ? `Part of your routine from ${new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${availableFrom}T12:00:00Z`))}.`
          : future
            ? "Not yet. Let's show up for today."
            : done
              ? 'A promise kept. Click to undo.'
              : 'Click to keep this promise.'}
      </p>
    </div>,
    document.body,
  )
}

function HabitLabel({
  habit,
  index,
  center,
  y,
  active,
  sweep,
}: {
  habit: Habit
  index: number
  center: number
  y: number
  active: boolean
  sweep: number
}) {
  const text = useRef<SVGTextElement>(null)
  const [displayName, setDisplayName] = useState(habit.name)

  useLayoutEffect(() => {
    let canceled = false
    void document.fonts.ready.then(() => {
      if (canceled || !text.current) return
      const style = getComputedStyle(text.current)
      const context = document.createElement('canvas').getContext('2d')
      if (!context) throw new Error('Your browser does not support text measurement.')
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const characters = Array.from(habit.name)
      let fitted = habit.name
      if (context.measureText(fitted).width > 177) {
        while (characters.length && context.measureText(`${characters.join('')}\u2026`).width > 177) {
          characters.pop()
        }
        fitted = `${characters.join('').trimEnd()}\u2026`
      }
      setDisplayName(fitted)
    })
    return () => { canceled = true }
  }, [habit.name])

  return (
    <g className={`habit-label sweep-item ${active ? 'is-active' : ''}`} aria-hidden="true" style={sweepStyle(sweep)}>
      <text x={center - 222} y={y} dominantBaseline="central" className="habit-index">
        {String(index + 1).padStart(2, '0')}
      </text>
      <text ref={text} x={center - 21} y={y} dominantBaseline="central" textAnchor="end" className="habit-name">
        {displayName}
      </text>
      <text x={center - 21} y={y} dominantBaseline="central" textAnchor="end" className="habit-name habit-underline">
        {displayName}
      </text>
      <line x1={center - 10} x2={center - 3} y1={y} y2={y} className="habit-tick" />
    </g>
  )
}

function ConsistencyScore({
  center,
  stats,
}: {
  center: number
  stats: ReturnType<typeof getMonthStats>
}) {
  const [display, setDisplay] = useState(stats.percentage)
  const current = useRef(stats.percentage)

  useEffect(() => {
    const from = current.current
    const to = stats.percentage
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650
    let frame = 0
    const start = performance.now()
    function animate(time: number) {
      const progress = duration === 0 ? 1 : Math.min((time - start) / duration, 1)
      const value = Math.round(from + (to - from) * (1 - (1 - progress) ** 3))
      current.current = value
      setDisplay(value)
      if (progress < 1) frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [stats.percentage])

  return (
    <g
      className="consistency-score sweep-item"
      style={sweepStyle(TEXT_SWEEP.consistencyScore)}
      aria-label={`${stats.percentage}% monthly consistency, ${stats.completed} of ${stats.total} check-ins`}
    >
      <path
        className="center-spark"
        d={`M${center} ${center - 67}v14M${center - 7} ${center - 60}h14M${center - 4.5} ${center - 64.5}l9 9M${center + 4.5} ${center - 64.5}l-9 9`}
        aria-hidden="true"
      />
      <text x={center + 3} y={center + 9} className="score-value" textAnchor="middle" aria-hidden="true">
        {display}<tspan className="score-percent" dx="4" dy="-23">%</tspan>
      </text>
      <text x={center} y={center + 35} className="score-label" textAnchor="middle" aria-hidden="true">CONSISTENCY</text>
      <line x1={center - 10} x2={center + 10} y1={center + 51} y2={center + 51} className="score-divider" />
      <text x={center} y={center + 72} className="score-detail" textAnchor="middle" aria-hidden="true">
        {stats.completed} of {stats.total} check-ins
      </text>
    </g>
  )
}

export function CircularTracker({ state, month, today, onToggle }: CircularTrackerProps) {
  const [hovered, setHovered] = useState<HoveredCell | null>(null)
  const [focused, setFocused] = useState({ habit: 0, day: 1 })
  const svg = useRef<SVGSVGElement>(null)
  const unavailablePatternId = `unavailable-${useId().replaceAll(':', '')}`
  const days = daysInMonth(month)
  const sectors = useMemo(() => getDaySectors(month), [month])
  const habits = getHabitsForMonth(state, month)
  const stats = getMonthStats(state, month)
  const ringStep = 29
  const ringWidth = 25.5
  const innerRadius = 112
  const outerRadius = innerRadius + habits.length * ringStep
  const size = Math.max((outerRadius + 35) * 2, 550)
  const center = size / 2
  const isCurrentMonth = today.getFullYear() === month.year && today.getMonth() === month.month

  function activateCell(element: SVGPathElement, day: number, habit: MonthHabit, feedback?: CursorFeedback) {
    const rect = element.getBoundingClientRect()
    const accepted = onToggle(day, habit, feedback ?? {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      followPointer: false,
    })
    if (accepted) animateCell(element)
  }

  function animateCell(element: SVGPathElement) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    element.getAnimations().forEach((animation) => animation.cancel())
    element.animate(
      [
        { transform: 'scale(0.83)', opacity: 0.55 },
        { transform: 'scale(1.1)', opacity: 1, offset: 0.52 },
        { transform: 'scale(1)', opacity: 1 },
      ],
      { duration: 420, easing: 'cubic-bezier(.2,.7,.3,1)' },
    )
  }

  function keyboard(event: KeyboardEvent<SVGPathElement>, habitIndex: number, day: number) {
    let nextHabit = habitIndex
    let nextDay = day
    switch (event.key) {
      case 'ArrowRight': nextDay = day === days ? 1 : day + 1; break
      case 'ArrowLeft': nextDay = day === 1 ? days : day - 1; break
      case 'ArrowDown': nextHabit = (habitIndex + 1) % habits.length; break
      case 'ArrowUp': nextHabit = (habitIndex - 1 + habits.length) % habits.length; break
      case 'Home': nextDay = 1; break
      case 'End': nextDay = days; break
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (!event.repeat) {
          const habit = habits[habitIndex]
          if (isHabitAvailableOnDate(state, month, day, habit.id)) {
            activateCell(event.currentTarget, day, habit)
          }
        }
        return
      case 'Escape':
        setHovered(null)
        return
      default: return
    }
    event.preventDefault()
    setFocused({ habit: nextHabit, day: nextDay })
    svg.current?.querySelector<SVGPathElement>(`[data-cell="${nextHabit}-${nextDay}"]`)?.focus()
  }

  return (
    <>
      <svg
        ref={svg}
        className="circular-tracker"
        viewBox={`0 0 ${size} ${size}`}
        role="group"
        aria-label={`${new Intl.DateTimeFormat('en', { month: 'long' }).format(new Date(2024, month.month))} ${month.year} habit tracker`}
        aria-describedby="tracker-keyboard-help"
      >
        <defs>
          <pattern id={unavailablePatternId} width="8" height="6" patternUnits="userSpaceOnUse">
            <rect width="8" height="6" fill="#f1f1ef" />
            <path d="M-2 4 L0 2 L2 4 L4 2 L6 4 L8 2 L10 4" fill="none" stroke="#b9b9b6" strokeWidth="0.8" />
          </pattern>
        </defs>
        <text className="habit-list-heading sweep-item" style={sweepStyle(TEXT_SWEEP.ritualsHeading)} x={center - 223} y={center - outerRadius - 16}>
          THE DAILY RITUALS
        </text>
        <text className="habit-list-count sweep-item" style={sweepStyle(TEXT_SWEEP.ritualsHeading)} x={center - 18} y={center - outerRadius - 16} textAnchor="end">
          {String(habits.length).padStart(2, '0')}
        </text>

        {habits.map((habit, index) => (
          <HabitLabel
            key={habit.id}
            habit={habit}
            index={index}
            center={center}
            y={center - (outerRadius - index * ringStep - ringWidth / 2)}
            active={hovered?.habit.id === habit.id}
            sweep={habitLabelProgress(index, habits.length)}
          />
        ))}

        {sectors.filter((sector) => sector.endsWeek && sector.day < days).map((sector) => {
          const next = sectors[sector.day]
          const angle = (sector.endAngle + next.startAngle) / 2
          const from = polarPoint(center, center, innerRadius - 3, angle)
          const to = polarPoint(center, center, outerRadius + 10, angle)
          return (
            <line
              key={sector.day}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className="week-divider sweep-item"
              style={sweepStyle(sweepProgress(angle))}
              aria-hidden="true"
            />
          )
        })}

        {habits.map((habit, habitIndex) => {
          const outer = outerRadius - habitIndex * ringStep
          const inner = outer - ringWidth
          return (
            <g key={habit.id} role="group" aria-label={habit.name}>
              {sectors.map((sector) => {
                const done = state.completions[dateKey(month, sector.day)]?.includes(habit.id) ?? false
                const active = hovered?.habit.id === habit.id && hovered.day === sector.day
                const isToday = isCurrentMonth && sector.day === today.getDate()
                const future = isFutureDate(month, sector.day, today)
                const unavailable = !isHabitAvailableOnDate(state, month, sector.day, habit.id)
                const availableFrom = habitAvailableFrom(state, habit)
                return (
                  <path
                    key={sector.day}
                    d={annularSectorPath(center, center, inner, outer, sector.startAngle, sector.endAngle)}
                    className={`day-cell sweep-item ${done ? 'is-done' : ''} ${isToday ? 'is-today' : ''} ${unavailable ? 'is-unavailable' : ''}`}
                    style={sweepStyle(sweepProgress(sector.midAngle), unavailable ? { fill: `url(#${unavailablePatternId})` } : undefined)}
                    data-cell={`${habitIndex}-${sector.day}`}
                    data-date={dateKey(month, sector.day)}
                    role="button"
                    tabIndex={focused.habit === habitIndex && focused.day === sector.day ? 0 : -1}
                    aria-label={`${habit.name}, ${formatFullDate(month, sector.day)}${unavailable ? `, unavailable until ${availableFrom}` : ''}`}
                    aria-pressed={done}
                    aria-disabled={future || unavailable}
                    aria-describedby={active ? 'cell-tooltip' : undefined}
                    onPointerEnter={(event) => {
                      if (event.pointerType === 'touch') return
                      setHovered({ habit, day: sector.day, x: event.clientX, y: event.clientY, keyboard: false })
                    }}
                    onPointerLeave={() => setHovered(null)}
                    onFocus={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect()
                      if (event.currentTarget.matches(':focus-visible')) {
                        setHovered({ habit, day: sector.day, x: rect.right, y: rect.top, keyboard: true })
                      }
                    }}
                    onBlur={() => setHovered(null)}
                    onKeyDown={(event) => keyboard(event, habitIndex, sector.day)}
                    onClick={(event) => {
                      setFocused({ habit: habitIndex, day: sector.day })
                      event.currentTarget.focus({ preventScroll: true })
                      const nativeEvent = event.nativeEvent
                      const feedback = nativeEvent instanceof PointerEvent && nativeEvent.pointerType
                        ? { x: event.clientX, y: event.clientY, followPointer: nativeEvent.pointerType === 'mouse' }
                        : undefined
                      if (!unavailable) activateCell(event.currentTarget, sector.day, habit, feedback)
                    }}
                  />
                )
              })}
            </g>
          )
        })}

        {sectors.map((sector) => {
          const point = polarPoint(center, center, outerRadius + 20, sector.midAngle)
          const isToday = isCurrentMonth && sector.day === today.getDate()
          return (
            <g key={sector.day} className={`day-label sweep-item ${isToday ? 'is-today' : ''}`} style={sweepStyle(sweepProgress(sector.midAngle))} aria-hidden="true">
              {isToday && <circle cx={point.x} cy={point.y} r="10" />}
              <text x={point.x} y={point.y} textAnchor="middle" dominantBaseline="central">
                {String(sector.day).padStart(2, '0')}
              </text>
            </g>
          )
        })}
        <ConsistencyScore center={center} stats={stats} />
      </svg>
      <p id="tracker-keyboard-help" className="sr-only">
        Use arrow keys to move between days and habits. Press Enter or Space to mark a habit done or undone.
        Future days are locked until their local calendar date.
        Zig-zag cells predate the tracker or habit and cannot be checked off.
        Consistency is completed check-ins divided by check-ins available in the displayed month.
      </p>
      {hovered && (
        <CellTooltip
          cell={hovered}
          month={month}
          done={state.completions[dateKey(month, hovered.day)]?.includes(hovered.habit.id) ?? false}
          future={isFutureDate(month, hovered.day, today)}
          unavailable={!isHabitAvailableOnDate(state, month, hovered.day, hovered.habit.id)}
          availableFrom={habitAvailableFrom(state, hovered.habit)}
        />
      )}
    </>
  )
}

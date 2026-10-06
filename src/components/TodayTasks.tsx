import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react'
import type { CursorFeedback } from './CustomCursor'
import { checkboxMorphPath, checkboxMorphProgress } from '../lib/checkboxMorph'
import {
  getDayTasks,
  taskDateDirection,
  taskDayLabel,
  taskMonthLabel,
  taskSummary,
  taskWaveDelay,
  TODAY_TASKS_ID,
} from '../lib/dayTasks'
import type { DayTask, TaskDate, TaskDirection } from '../lib/dayTasks'
import { formatFullDate, monthKey } from '../lib/tracker'
import type { MonthHabit, TrackerState } from '../lib/tracker'
import './TodayTasks.css'

// The header arrives as the day note steps aside, then the rows follow it down.
const ENTER_HEADER_DELAY = 140
const ENTER_ROW_DELAY = 250
const ENTER_STAGGER = 45
// Kept rows draw their line once they have landed; the list stays in its
// arriving state until the last line is drawn.
const ENTER_STRIKE_DURATION = 900
// Leaving runs the other way: summary first, rows bottom to top, header last.
const LEAVE_STAGGER = 26
const LEAVE_DURATION = 230
// A row takes on its new day as its nudge reaches the lowest point.
const WAVE_DURATION = 480
const WAVE_SWAP = 110

const CHECK_POP: Keyframe[] = [
  { transform: 'scale(1)' },
  { transform: 'scale(0.78)', offset: 0.26 },
  { transform: 'scale(1.14)', offset: 0.6 },
  { transform: 'scale(1)' },
]
const UNCHECK_POP: Keyframe[] = [
  { transform: 'scale(1)' },
  { transform: 'scale(0.86)', offset: 0.4 },
  { transform: 'scale(1)' },
]

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function timing(enter: number, leave: number): CSSProperties {
  return { '--enter-delay': `${enter}ms`, '--leave-delay': `${leave}ms` } as CSSProperties
}

/** Text that rolls away in the direction of travel as a new value rolls in. */
function RollingText({
  value,
  rollKey,
  direction,
  className = '',
}: {
  value: string
  rollKey: string
  direction: TaskDirection
  className?: string
}) {
  const [last, setLast] = useState({ rollKey, value, id: 0 })
  const [outgoing, setOutgoing] = useState<{ value: string; id: number } | null>(null)
  if (last.rollKey !== rollKey) {
    setOutgoing({ value: last.value, id: last.id })
    setLast({ rollKey, value, id: last.id + 1 })
  } else if (last.value !== value) {
    setLast({ ...last, value })
  }

  return (
    <span className={`today-tasks-roll ${className}`} data-direction={direction < 0 ? 'back' : 'forward'}>
      {outgoing && (
        <span
          key={`out-${outgoing.id}`}
          className="today-tasks-roll-out"
          aria-hidden="true"
          onAnimationEnd={() => setOutgoing(null)}
        >
          {outgoing.value}
        </span>
      )}
      <span key={`in-${last.id}`} className={last.id > 0 ? 'today-tasks-roll-in' : undefined}>{value}</span>
    </span>
  )
}

/** A box whose four sides fold into a tick, and unfold again. */
function TaskCheck({ checked }: { checked: boolean }) {
  const icon = useRef<SVGSVGElement>(null)
  const path = useRef<SVGPathElement>(null)
  const progress = useRef(checked ? 1 : 0)
  // React draws only the first outline; every later one comes from the morph.
  const [initialPath] = useState(() => checkboxMorphPath(checked ? 1 : 0))

  useEffect(() => {
    const element = path.current
    const target = checked ? 1 : 0
    if (!element || progress.current === target) return
    if (prefersReducedMotion()) {
      progress.current = target
      element.setAttribute('d', checkboxMorphPath(target))
      return
    }
    icon.current?.animate(checked ? CHECK_POP : UNCHECK_POP, {
      duration: checked ? 460 : 320,
      easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)',
    })
    const from = progress.current
    let frame = 0
    let start: number | undefined
    function step(time: number) {
      start ??= time
      progress.current = checkboxMorphProgress(time - start, from, target)
      element?.setAttribute('d', checkboxMorphPath(progress.current))
      if (progress.current !== target) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [checked])

  return (
    <svg ref={icon} className="today-task-check" viewBox="0 0 20 20" aria-hidden="true">
      <path ref={path} d={initialPath} />
    </svg>
  )
}

interface ShownTask {
  wave: number
  done: boolean
  available: boolean
  locked: boolean
}

function TaskRow({
  task,
  locked,
  index,
  count,
  wave,
  direction,
  onToggle,
}: {
  task: DayTask
  locked: boolean
  index: number
  count: number
  wave: number
  direction: TaskDirection
  onToggle: (habit: MonthHabit, feedback: CursorFeedback) => void
}) {
  const row = useRef<HTMLButtonElement>(null)
  const nudge = useRef<Animation | null>(null)
  const lastWave = useRef(wave)
  const waveDelay = taskWaveDelay(index, count, direction)
  const [shown, setShown] = useState<ShownTask>(() => ({ wave, done: task.done, available: task.available, locked }))
  // A click on this row shows at once; a new day only reaches it with the wave.
  if (shown.wave === wave && (shown.done !== task.done || shown.available !== task.available || shown.locked !== locked)) {
    setShown({ wave, done: task.done, available: task.available, locked })
  }

  useEffect(() => {
    if (shown.wave === wave) return
    const timer = setTimeout(
      () => setShown({ wave, done: task.done, available: task.available, locked }),
      prefersReducedMotion() ? 0 : waveDelay + WAVE_SWAP,
    )
    return () => clearTimeout(timer)
  }, [locked, shown.wave, task.available, task.done, wave, waveDelay])

  useLayoutEffect(() => {
    if (lastWave.current === wave) return
    lastWave.current = wave
    const element = row.current
    if (!element || prefersReducedMotion()) return
    nudge.current?.cancel()
    // Later days lift the rows up the page; earlier ones let them sink.
    const lift = direction < 0 ? 5 : -5
    nudge.current = element.animate([
      { transform: 'translateY(0)', opacity: 1 },
      { transform: `translateY(${lift}px)`, opacity: 0.3, offset: 0.32 },
      { transform: 'translateY(0)', opacity: 1 },
    ], { duration: WAVE_DURATION, delay: waveDelay, easing: 'cubic-bezier(0.33, 0, 0.2, 1)' })
  }, [direction, wave, waveDelay])

  useEffect(() => () => nudge.current?.cancel(), [])

  function activate(event: MouseEvent<HTMLButtonElement>) {
    const nativeEvent = event.nativeEvent
    if (nativeEvent instanceof PointerEvent && nativeEvent.pointerType) {
      onToggle(task.habit, { x: event.clientX, y: event.clientY, followPointer: nativeEvent.pointerType === 'mouse' })
      return
    }
    const box = event.currentTarget.querySelector('.today-task-check')?.getBoundingClientRect()
      ?? event.currentTarget.getBoundingClientRect()
    onToggle(task.habit, { x: box.x + box.width / 2, y: box.y + box.height / 2, followPointer: false })
  }

  const status = !task.available ? 'not part of your routine yet' : locked ? 'locked until the day comes' : ''

  return (
    <button
      ref={row}
      type="button"
      role="checkbox"
      className={[
        'today-task',
        shown.done ? 'is-done' : '',
        shown.locked ? 'is-locked' : '',
        shown.available ? '' : 'is-unavailable',
      ].join(' ')}
      aria-checked={task.done}
      aria-disabled={locked || !task.available || undefined}
      onClick={activate}
    >
      <TaskCheck checked={shown.done} />
      <span className="today-task-label">
        <span className="today-task-name">{task.habit.name}</span>
        {status && <span className="sr-only">, {status}</span>}
      </span>
    </button>
  )
}

interface TodayTasksProps {
  state: TrackerState
  date: TaskDate
  today: Date
  leaving: boolean
  onToggle: (date: TaskDate, habit: MonthHabit, feedback: CursorFeedback) => void
  /** Asks to put the list away; `restoreFocus` when the keyboard was inside it. */
  onDismiss: (restoreFocus: boolean) => void
  onLeft: () => void
}

export function TodayTasks({ state, date, today, leaving, onToggle, onDismiss, onLeft }: TodayTasksProps) {
  const root = useRef<HTMLElement>(null)
  const day = getDayTasks(state, date, today)
  const count = day.tasks.length
  const [arriving, setArriving] = useState(true)
  const [travel, setTravel] = useState({ key: day.key, date, wave: 0, direction: 0 as TaskDirection })
  if (travel.key !== day.key) {
    setTravel({ key: day.key, date, wave: travel.wave + 1, direction: taskDateDirection(travel.date, date) })
  }
  // The tally rolls up as promises are kept and down as they are undone.
  const [tally, setTally] = useState({ key: day.key, completed: day.completed, direction: 1 as TaskDirection })
  if (tally.key !== day.key || tally.completed !== day.completed) {
    setTally({
      key: day.key,
      completed: day.completed,
      direction: tally.key !== day.key
        ? taskDateDirection(travel.date, date) || 1
        : day.completed > tally.completed ? 1 : -1,
    })
  }
  const dismiss = useEffectEvent(onDismiss)
  const finishLeaving = useEffectEvent(onLeft)
  const fullDate = formatFullDate(date.month, date.day)
  const progress = day.total === 0 ? 0 : day.completed / day.total

  useEffect(() => {
    const first = root.current?.querySelector<HTMLElement>('.today-task:not([aria-disabled="true"])')
    ;(first ?? root.current)?.focus({ preventScroll: true })
    const rows = root.current?.querySelectorAll('.today-task').length ?? 0
    const timer = setTimeout(
      () => setArriving(false),
      prefersReducedMotion() ? 0 : ENTER_ROW_DELAY + rows * ENTER_STAGGER + ENTER_STRIKE_DURATION,
    )
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (leaving) return

    function outside(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Element)) return
      // Dates on the wheel move the list instead of closing it.
      if (root.current?.contains(target) || target.closest('[data-task-day-picker]')) return
      dismiss(false)
    }

    function escape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const focused = document.activeElement
      dismiss(!focused || focused === document.body || Boolean(root.current?.contains(focused)))
    }

    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [leaving])

  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(
      () => finishLeaving(),
      prefersReducedMotion() ? 0 : LEAVE_DURATION + (count + 1) * LEAVE_STAGGER,
    )
    return () => clearTimeout(timer)
  }, [count, leaving])

  // Layouts without room for the day note have no room for its list either.
  useEffect(() => {
    const element = root.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      if (element.getClientRects().length === 0) dismiss(false)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  function moveFocus(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const rows = Array.from(root.current?.querySelectorAll<HTMLElement>('.today-task') ?? [])
    const index = rows.findIndex((row) => row === document.activeElement)
    if (index < 0) return
    event.preventDefault()
    rows[(index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].focus()
  }

  return (
    <section
      ref={root}
      id={TODAY_TASKS_ID}
      className={[
        'today-tasks',
        arriving && travel.wave === 0 ? 'is-arriving' : '',
        leaving ? 'is-leaving' : '',
      ].join(' ')}
      aria-label={`Tasks for ${fullDate}`}
      tabIndex={-1}
      inert={leaving}
      onKeyDown={moveFocus}
    >
      <header className="today-tasks-header" aria-hidden="true">
        <p className="today-tasks-eyebrow" style={timing(ENTER_HEADER_DELAY, (count + 1) * LEAVE_STAGGER)}>
          <i />
          <RollingText value={taskDayLabel(date, today)} rollKey={day.key} direction={travel.direction} />
        </p>
        <p className="today-tasks-date" style={timing(ENTER_HEADER_DELAY + 50, (count + 1) * LEAVE_STAGGER)}>
          <RollingText
            className="today-tasks-day"
            value={String(date.day).padStart(2, '0')}
            rollKey={day.key}
            direction={travel.direction}
          />
          <RollingText
            className="today-tasks-month"
            value={taskMonthLabel(date)}
            rollKey={monthKey(date.month)}
            direction={travel.direction}
          />
        </p>
      </header>
      {count > 0 && (
        <ul className="today-tasks-list">
          {day.tasks.map((task, index) => (
            <li
              key={task.habit.id}
              style={timing(ENTER_ROW_DELAY + index * ENTER_STAGGER, (count - index) * LEAVE_STAGGER)}
            >
              <TaskRow
                task={task}
                locked={day.future}
                index={index}
                count={count}
                wave={travel.wave}
                direction={travel.direction}
                onToggle={(habit, feedback) => onToggle(date, habit, feedback)}
              />
            </li>
          ))}
        </ul>
      )}
      <p className="today-tasks-summary" style={timing(ENTER_ROW_DELAY + count * ENTER_STAGGER + 40, 0)}>
        <span className="today-tasks-progress" aria-hidden="true">
          <i style={{ transform: `scaleX(${progress})` }} />
        </span>
        <RollingText value={taskSummary(day)} rollKey={taskSummary(day)} direction={tally.direction} />
      </p>
    </section>
  )
}

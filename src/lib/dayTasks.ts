import { dateKey, getHabitsForMonth, habitAvailableFrom, localDateKey } from './tracker.ts'
import type { Month, MonthHabit, TrackerState } from './tracker.ts'

export const TASK_WAVE_STAGGER = 45
export const TODAY_TASKS_ID = 'today-tasks'

export interface TaskDate {
  month: Month
  day: number
}

export interface DayTask {
  habit: MonthHabit
  done: boolean
  /** False on days before the habit, or the whole tracker, began. */
  available: boolean
}

export interface DayTasks {
  key: string
  isToday: boolean
  future: boolean
  tasks: DayTask[]
  /** Promises kept, out of those that could be kept that day. */
  completed: number
  total: number
}

export type TaskDirection = -1 | 0 | 1

const weekdayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' })
const monthFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })

function validNow(now: Date): Date {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('The current date must be a valid Date.')
  }
  return now
}

export function taskDateFor(now: Date): TaskDate {
  validNow(now)
  return { month: { year: now.getFullYear(), month: now.getMonth() }, day: now.getDate() }
}

export function taskDateKey(date: TaskDate): string {
  return dateKey(date.month, date.day)
}

/** Every habit planned for the date's month, checked against that one day. */
export function getDayTasks(state: TrackerState, date: TaskDate, now: Date = new Date()): DayTasks {
  const key = taskDateKey(date)
  const today = localDateKey(validNow(now))
  const completed = new Set(state.completions[key] ?? [])
  const tasks = getHabitsForMonth(state, date.month).map((habit) => {
    const available = key >= habitAvailableFrom(state, habit)
    return { habit, done: available && completed.has(habit.id), available }
  })
  const open = tasks.filter((task) => task.available)
  return {
    key,
    isToday: key === today,
    future: key > today,
    tasks,
    completed: open.filter((task) => task.done).length,
    total: open.length,
  }
}

/** 1 when moving forward in time, -1 when going back, 0 for the same day. */
export function taskDateDirection(from: TaskDate, to: TaskDate): TaskDirection {
  const fromKey = taskDateKey(from)
  const toKey = taskDateKey(to)
  if (fromKey === toKey) return 0
  return toKey > fromKey ? 1 : -1
}

/** Moving forward the wave runs down the list; going back it climbs it. */
export function taskWaveDelay(index: number, count: number, direction: TaskDirection): number {
  if (!Number.isInteger(index) || !Number.isInteger(count) || index < 0 || index >= count) {
    throw new Error('A task wave needs a row index within the list.')
  }
  return (direction < 0 ? count - 1 - index : index) * TASK_WAVE_STAGGER
}

export function taskDayLabel(date: TaskDate, now: Date = new Date()): string {
  const key = taskDateKey(date)
  const weekday = weekdayFormatter.format(new Date(`${key}T12:00:00Z`)).toUpperCase()
  validNow(now)
  const today = localDateKey(now)
  if (key === today) return `${weekday} · TODAY`
  if (key > today) return `${weekday} · NOT YET`
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12)
  return key === localDateKey(yesterday) ? `${weekday} · YESTERDAY` : weekday
}

export function taskMonthLabel(date: TaskDate): string {
  return monthFormatter.format(new Date(`${taskDateKey(date)}T12:00:00Z`))
}

export function taskSummary(day: DayTasks): string {
  if (day.tasks.length === 0) return 'No rituals planned'
  if (day.total === 0) return 'Before this routine began'
  if (day.future) return 'Locked until the day comes'
  return `${day.completed} of ${day.total} kept`
}

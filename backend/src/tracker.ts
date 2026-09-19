import { ApiError } from './errors.js'
import type { Habit, TrackerState } from './types.js'

export const MAX_HABITS = 9
export const MAX_HABIT_NAME_LENGTH = 32
export const MAX_TITLE_LENGTH = 60
export const MAX_TRACKER_BYTES = 700 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(value, field))
}

function daysInMonth(year: number, monthIndex: number): number {
  if (monthIndex === 1) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    return leap ? 29 : 28
  }
  return [3, 5, 8, 10].includes(monthIndex) ? 30 : 31
}

function isValidDateKey(key: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!match) return false
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const day = Number(match[3])
  return monthIndex >= 0 && monthIndex <= 11 && day >= 1 && day <= daysInMonth(year, monthIndex)
}

function invalidTracker(message: string): never {
  throw new ApiError(400, 'INVALID_TRACKER', message)
}

export function validateTracker(value: unknown): TrackerState {
  if (!isRecord(value) || !hasExactFields(value, ['version', 'title', 'habits', 'completions', 'isDemo'])) {
    return invalidTracker(
      'Tracker must contain exactly version, title, habits, completions, and isDemo.',
    )
  }
  if (value.version !== 1) invalidTracker('Tracker version must be 1.')
  if (typeof value.title !== 'string' || value.title.length > MAX_TITLE_LENGTH) {
    invalidTracker(`Tracker title must be a string of at most ${MAX_TITLE_LENGTH} characters.`)
  }
  if (typeof value.isDemo !== 'boolean') invalidTracker('Tracker isDemo must be a boolean.')
  if (!Array.isArray(value.habits) || value.habits.length > MAX_HABITS) {
    invalidTracker(`Habits must be an array containing at most ${MAX_HABITS} habits.`)
  }

  const ids = new Set<string>()
  const names = new Set<string>()
  const habits: Habit[] = []
  for (const candidate of value.habits) {
    if (!isRecord(candidate) || !hasExactFields(candidate, ['id', 'name'])) {
      invalidTracker('Each habit must contain exactly an id and a name.')
    }
    if (typeof candidate.id !== 'string' || !candidate.id.trim() || candidate.id !== candidate.id.trim()) {
      invalidTracker('Habit IDs must be nonempty, trimmed strings.')
    }
    if (ids.has(candidate.id)) invalidTracker('Habit IDs must be distinct.')
    if (typeof candidate.name !== 'string') invalidTracker('Habit names must be strings.')
    const name = candidate.name.trim()
    if (!name || name.length > MAX_HABIT_NAME_LENGTH || name !== candidate.name) {
      invalidTracker(`Habit names must be trimmed and contain 1 to ${MAX_HABIT_NAME_LENGTH} characters.`)
    }
    const foldedName = name.toLowerCase()
    if (names.has(foldedName)) invalidTracker('Habit names must be distinct, ignoring case.')
    ids.add(candidate.id)
    names.add(foldedName)
    habits.push({ id: candidate.id, name })
  }

  if (!isRecord(value.completions)) invalidTracker('Completions must be a date-keyed object.')
  const completions: Record<string, string[]> = {}
  for (const [date, candidateIds] of Object.entries(value.completions)) {
    if (!isValidDateKey(date)) invalidTracker(`Invalid completion date: "${date}".`)
    if (!Array.isArray(candidateIds)) invalidTracker(`Completions for ${date} must be an array.`)
    const unique = new Set<string>()
    for (const id of candidateIds) {
      if (typeof id !== 'string' || !ids.has(id)) {
        invalidTracker(`Completions for ${date} contain an unknown habit ID.`)
      }
      if (unique.has(id)) invalidTracker(`Completions for ${date} contain a duplicate habit ID.`)
      unique.add(id)
    }
    completions[date] = [...unique]
  }

  const tracker: TrackerState = {
    version: 1,
    title: value.title as string,
    habits,
    completions,
    isDemo: value.isDemo as boolean,
  }
  if (Buffer.byteLength(JSON.stringify(tracker), 'utf8') > MAX_TRACKER_BYTES) {
    throw new ApiError(413, 'TRACKER_TOO_LARGE', 'Tracker data is too large to store.')
  }
  return tracker
}

export function clearDemoProgress(tracker: TrackerState): TrackerState {
  if (!tracker.isDemo) return tracker
  return {
    ...tracker,
    completions: {},
    isDemo: false,
  }
}

export function parseMonth(value: unknown): { key: string; year: number; monthIndex: number } {
  if (typeof value !== 'string') {
    throw new ApiError(400, 'INVALID_MONTH', 'Month is required in YYYY-MM format.')
  }
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) throw new ApiError(400, 'INVALID_MONTH', 'Month must use YYYY-MM format.')
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  if (monthIndex < 0 || monthIndex > 11) {
    throw new ApiError(400, 'INVALID_MONTH', 'Month must use a real month from 01 to 12.')
  }
  return { key: value, year, monthIndex }
}

export function monthStats(
  tracker: TrackerState,
  month: { key: string; year: number; monthIndex: number },
): { completed: number; total: number; percentage: number } {
  const total = daysInMonth(month.year, month.monthIndex) * tracker.habits.length
  if (total === 0) return { completed: 0, total: 0, percentage: 0 }
  const knownIds = new Set(tracker.habits.map((habit) => habit.id))
  let completed = 0
  for (const [date, ids] of Object.entries(tracker.completions)) {
    if (!date.startsWith(`${month.key}-`)) continue
    for (const id of new Set(ids)) {
      if (knownIds.has(id)) completed += 1
    }
  }
  return { completed, total, percentage: Math.round((completed / total) * 100) }
}

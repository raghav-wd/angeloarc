import { ApiError } from './errors.js'
import type {
  LegacyHabit,
  LegacyTrackerState,
  MonthHabit,
  SearchSummary,
  TrackerState,
} from './types.js'

export const MAX_HABITS = 9
export const MAX_HABIT_NAME_LENGTH = 32
export const MAX_TITLE_LENGTH = 60
export const MAX_TRACKER_BYTES = 704 * 1024
export const MAX_HABIT_PLANS = 1_200
export const MAX_COMPLETION_DATES = 45_000
export const LEGACY_START_DATE = '0000-01-01'
export const LEGACY_START_MONTH = '0000-01'

export interface ParsedMonth {
  key: string
  year: number
  monthIndex: number
}

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

function isValidMonthKey(key: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(key)
  if (!match) return false
  const month = Number(match[2])
  return month >= 1 && month <= 12
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

function validateTitle(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_TITLE_LENGTH) {
    invalidTracker(`Tracker title must be a string of at most ${MAX_TITLE_LENGTH} characters.`)
  }
  return value
}

function validateDemoFlag(value: unknown): boolean {
  if (typeof value !== 'boolean') invalidTracker('Tracker isDemo must be a boolean.')
  return value
}

function validateHabitId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    invalidTracker('Habit IDs must be nonempty, trimmed strings.')
  }
  return value
}

function validateHabitName(value: unknown): string {
  if (typeof value !== 'string') invalidTracker('Habit names must be strings.')
  const name = value.trim()
  if (!name || name.length > MAX_HABIT_NAME_LENGTH || name !== value) {
    invalidTracker(`Habit names must be trimmed and contain 1 to ${MAX_HABIT_NAME_LENGTH} characters.`)
  }
  return name
}

function validateLegacyHabits(value: unknown): LegacyHabit[] {
  if (!Array.isArray(value) || value.length > MAX_HABITS) {
    invalidTracker(`Habits must be an array containing at most ${MAX_HABITS} habits.`)
  }
  const ids = new Set<string>()
  const names = new Set<string>()
  return value.map((candidate: unknown) => {
    if (!isRecord(candidate) || !hasExactFields(candidate, ['id', 'name'])) {
      invalidTracker('Each legacy habit must contain exactly an id and a name.')
    }
    const id = validateHabitId(candidate.id)
    const name = validateHabitName(candidate.name)
    if (ids.has(id)) invalidTracker('Habit IDs must be distinct.')
    const foldedName = name.toLowerCase()
    if (names.has(foldedName)) invalidTracker('Habit names must be distinct, ignoring case.')
    ids.add(id)
    names.add(foldedName)
    return { id, name }
  })
}

function validateCompletionRecord(
  value: unknown,
  allowedIdsForDate: (date: string) => ReadonlyMap<string, MonthHabit | LegacyHabit>,
  earliestDateForId?: (id: string) => string,
  maxDates?: number,
): Record<string, string[]> {
  if (!isRecord(value)) invalidTracker('Completions must be a date-keyed object.')
  const entries = Object.entries(value)
  if (maxDates !== undefined && entries.length > maxDates) {
    invalidTracker(`Completions may contain at most ${maxDates} date entries.`)
  }
  const completions: Record<string, string[]> = {}
  for (const [date, candidateIds] of entries) {
    if (!isValidDateKey(date)) invalidTracker(`Invalid completion date: "${date}".`)
    if (!Array.isArray(candidateIds)) invalidTracker(`Completions for ${date} must be an array.`)
    const allowedIds = allowedIdsForDate(date)
    const unique = new Set<string>()
    for (const id of candidateIds) {
      if (typeof id !== 'string' || !allowedIds.has(id)) {
        invalidTracker(`Completions for ${date} contain a habit that is not active that month.`)
      }
      if (earliestDateForId && date < earliestDateForId(id)) {
        invalidTracker(`Completions for ${date} occur before a habit's start date.`)
      }
      if (unique.has(id)) invalidTracker(`Completions for ${date} contain a duplicate habit ID.`)
      unique.add(id)
    }
    completions[date] = [...unique]
  }
  return completions
}

function validateLegacyTracker(value: Record<string, unknown>): LegacyTrackerState {
  if (!hasExactFields(value, ['version', 'title', 'habits', 'completions', 'isDemo'])) {
    invalidTracker('Legacy tracker must contain exactly version, title, habits, completions, and isDemo.')
  }
  const habits = validateLegacyHabits(value.habits)
  const habitsById = new Map(habits.map((habit) => [habit.id, habit]))
  const completions = validateCompletionRecord(value.completions, () => habitsById)
  return {
    version: 1,
    title: validateTitle(value.title),
    habits,
    completions,
    isDemo: validateDemoFlag(value.isDemo),
  }
}

function resolvePlanFromRecord(
  startedOn: string,
  habitPlans: Readonly<Record<string, MonthHabit[]>>,
  monthKey: string,
  sortedPlanKeys?: readonly string[],
): MonthHabit[] {
  if (monthKey < startedOn.slice(0, 7)) return []
  const keys = sortedPlanKeys ?? Object.keys(habitPlans).sort()
  let low = 0
  let high = keys.length - 1
  let resolvedKey: string | undefined
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2)
    const candidate = keys[middle]!
    if (candidate <= monthKey) {
      resolvedKey = candidate
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return resolvedKey ? habitPlans[resolvedKey] ?? [] : []
}

function validateV2Tracker(value: Record<string, unknown>): TrackerState {
  if (!hasExactFields(value, ['version', 'title', 'startedOn', 'habitPlans', 'completions', 'isDemo'])) {
    invalidTracker(
      'Tracker must contain exactly version, title, startedOn, habitPlans, completions, and isDemo.',
    )
  }
  if (typeof value.startedOn !== 'string' || !isValidDateKey(value.startedOn)) {
    invalidTracker('Tracker startedOn must be a real YYYY-MM-DD date.')
  }
  const startedOn = value.startedOn
  const baselineMonth = startedOn.slice(0, 7)
  if (!isRecord(value.habitPlans)) invalidTracker('habitPlans must be a month-keyed object.')
  const planEntries = Object.entries(value.habitPlans)
  if (planEntries.length > MAX_HABIT_PLANS) {
    invalidTracker(`habitPlans may contain at most ${MAX_HABIT_PLANS} monthly snapshots.`)
  }
  if (!Object.hasOwn(value.habitPlans, baselineMonth)) {
    invalidTracker(`habitPlans must include a baseline plan for ${baselineMonth}.`)
  }

  const startsById = new Map<string, string>()
  const habitPlans: Record<string, MonthHabit[]> = {}
  for (const [monthKey, candidatePlan] of planEntries) {
    if (!isValidMonthKey(monthKey)) invalidTracker(`Invalid habit plan month: "${monthKey}".`)
    if (monthKey < baselineMonth) invalidTracker('Habit plans cannot precede the tracker start month.')
    if (!Array.isArray(candidatePlan) || candidatePlan.length > MAX_HABITS) {
      invalidTracker(`Each habit plan must contain at most ${MAX_HABITS} habits.`)
    }
    const ids = new Set<string>()
    const names = new Set<string>()
    const plan: MonthHabit[] = []
    for (const candidate of candidatePlan) {
      if (!isRecord(candidate) || !hasExactFields(candidate, ['id', 'name', 'startedOn'])) {
        invalidTracker('Each month habit must contain exactly id, name, and startedOn.')
      }
      const id = validateHabitId(candidate.id)
      const name = validateHabitName(candidate.name)
      if (typeof candidate.startedOn !== 'string' || !isValidDateKey(candidate.startedOn)) {
        invalidTracker('Habit startedOn must be a real YYYY-MM-DD date.')
      }
      const habitStartedOn = candidate.startedOn
      if (habitStartedOn < startedOn) invalidTracker('Habit start dates cannot precede the tracker start date.')
      if (habitStartedOn.slice(0, 7) > monthKey) {
        invalidTracker('A habit cannot appear in a plan before its start month.')
      }
      if (ids.has(id)) invalidTracker('Habit IDs must be distinct within each plan.')
      const foldedName = name.toLowerCase()
      if (names.has(foldedName)) invalidTracker('Habit names must be distinct within each plan, ignoring case.')
      const knownStart = startsById.get(id)
      if (knownStart !== undefined && knownStart !== habitStartedOn) {
        invalidTracker('A repeated habit ID must keep the same start date across plans.')
      }
      startsById.set(id, habitStartedOn)
      ids.add(id)
      names.add(foldedName)
      plan.push({ id, name, startedOn: habitStartedOn })
    }
    habitPlans[monthKey] = plan
  }

  const sortedPlanKeys = Object.keys(habitPlans).sort()
  const idsByMonth = new Map<string, ReadonlyMap<string, MonthHabit>>()
  const completions = validateCompletionRecord(
    value.completions,
    (date) => {
      const monthKey = date.slice(0, 7)
      const cached = idsByMonth.get(monthKey)
      if (cached) return cached
      const plan = resolvePlanFromRecord(startedOn, habitPlans, monthKey, sortedPlanKeys)
      const ids = new Map(plan.map((habit) => [habit.id, habit]))
      idsByMonth.set(monthKey, ids)
      return ids
    },
    (id) => startsById.get(id) ?? '9999-12-31',
    MAX_COMPLETION_DATES,
  )
  for (const date of Object.keys(completions)) {
    if (date < startedOn) invalidTracker(`Completions for ${date} precede the tracker start date.`)
  }

  return {
    version: 2,
    title: validateTitle(value.title),
    startedOn,
    habitPlans,
    completions,
    isDemo: validateDemoFlag(value.isDemo),
  }
}

function assertTrackerSize(tracker: TrackerState): TrackerState {
  if (Buffer.byteLength(JSON.stringify(tracker), 'utf8') > MAX_TRACKER_BYTES) {
    throw new ApiError(413, 'TRACKER_TOO_LARGE', 'Tracker data is too large to store.')
  }
  return tracker
}

export function migrateLegacyTracker(tracker: LegacyTrackerState): TrackerState {
  return assertTrackerSize({
    version: 2,
    title: tracker.title,
    startedOn: LEGACY_START_DATE,
    habitPlans: {
      [LEGACY_START_MONTH]: tracker.habits.map((habit) => ({
        ...habit,
        startedOn: LEGACY_START_DATE,
      })),
    },
    completions: structuredClone(tracker.completions),
    isDemo: tracker.isDemo,
  })
}

export function validateTracker(value: unknown): TrackerState {
  if (!isRecord(value)) invalidTracker('Tracker must be an object.')
  if (value.version === 1) return migrateLegacyTracker(validateLegacyTracker(value))
  if (value.version === 2) return assertTrackerSize(validateV2Tracker(value))
  invalidTracker('Tracker version must be 1 or 2.')
}

function utcDateKey(now: Date): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('The current time must be a valid Date.')
  }
  return now.toISOString().slice(0, 10)
}

export function clearDemoProgress(tracker: TrackerState, now: Date = new Date()): TrackerState {
  if (!tracker.isDemo) return tracker
  const today = utcDateKey(now)
  const month = parseMonth(today.slice(0, 7))
  // A client just across a local month boundary can legitimately send a demo
  // whose baseline month is one month ahead of the server's UTC month. Use
  // that required baseline as the source plan instead of erasing the routine.
  const sourceMonth = today < tracker.startedOn
    ? parseMonth(tracker.startedOn.slice(0, 7))
    : month
  const currentPlan = resolveHabitPlan(tracker, sourceMonth).map((habit) => ({
    ...habit,
    startedOn: today,
  }))
  return assertTrackerSize({
    version: 2,
    title: tracker.title,
    startedOn: today,
    habitPlans: { [month.key]: currentPlan },
    completions: {},
    isDemo: false,
  })
}

export function parseMonth(value: unknown): ParsedMonth {
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

export function resolveHabitPlan(tracker: TrackerState, month: ParsedMonth): MonthHabit[] {
  return resolvePlanFromRecord(tracker.startedOn, tracker.habitPlans, month.key)
}

function eligibleStartDay(startedOn: string, monthKey: string, lastDay: number): number {
  const startMonth = startedOn.slice(0, 7)
  if (startMonth < monthKey) return 1
  if (startMonth > monthKey) return lastDay + 1
  return Number(startedOn.slice(8, 10))
}

export function monthStats(
  tracker: TrackerState,
  month: ParsedMonth,
): { completed: number; total: number; percentage: number } {
  const habits = resolveHabitPlan(tracker, month)
  const lastDay = daysInMonth(month.year, month.monthIndex)
  const trackerStartDay = eligibleStartDay(tracker.startedOn, month.key, lastDay)
  let total = 0
  for (const habit of habits) {
    const firstDay = Math.max(trackerStartDay, eligibleStartDay(habit.startedOn, month.key, lastDay))
    if (firstDay <= lastDay) total += lastDay - firstDay + 1
  }
  if (total === 0) return { completed: 0, total: 0, percentage: 0 }

  const habitsById = new Map(habits.map((habit) => [habit.id, habit]))
  let completed = 0
  for (const [date, ids] of Object.entries(tracker.completions)) {
    if (!date.startsWith(`${month.key}-`) || date < tracker.startedOn) continue
    for (const id of ids) {
      const habit = habitsById.get(id)
      if (habit && date >= habit.startedOn) completed += 1
    }
  }
  return { completed, total, percentage: Math.round((completed / total) * 100) }
}

export function trackerSearchSummary(tracker: TrackerState): SearchSummary {
  const latestPlanKey = Object.keys(tracker.habitPlans).sort().at(-1)
  return {
    title: tracker.title,
    habitCount: latestPlanKey ? tracker.habitPlans[latestPlanKey]?.length ?? 0 : 0,
  }
}

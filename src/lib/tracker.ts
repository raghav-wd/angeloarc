export const MAX_HABITS = 9;
export const MAX_HABIT_NAME_LENGTH = 32;
export const MAX_TITLE_LENGTH = 60;
export const STORAGE_KEY = 'angelo-routine-v1';

export interface Habit {
  id: string;
  name: string;
}

export interface MonthHabit extends Habit {
  startedOn: string;
}

export interface Month {
  year: number;
  month: number;
}

export interface TrackerState {
  version: 2;
  title: string;
  startedOn: string;
  habitPlans: Record<string, MonthHabit[]>;
  completions: Record<string, string[]>;
  isDemo: boolean;
}

interface LegacyTrackerState {
  version: 1;
  title: string;
  habits: Habit[];
  completions: Record<string, string[]>;
  isDemo: boolean;
}

export class StorageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageValidationError';
  }
}

export class FutureDateError extends Error {
  constructor() {
    super('Future check-ins are locked. You can only update today or earlier.');
    this.name = 'FutureDateError';
  }
}

export class UnavailableDateError extends Error {
  constructor() {
    super('This habit was not part of your routine on that date.');
    this.name = 'UnavailableDateError';
  }
}

const STARTER_HABITS: readonly Habit[] = [
  { id: 'move', name: 'Move your body' },
  { id: 'read', name: 'Read 10 pages' },
  { id: 'water', name: 'Drink more water' },
  { id: 'focus', name: 'Deep work' },
  { id: 'mind', name: 'Quiet your mind' },
  { id: 'sleep', name: 'Sleep 8 hours' },
];

const LEGACY_START_DATE = '0000-01-01';

const fullDateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactFields(value: Record<string, unknown>, fields: string[]): boolean {
  return Object.keys(value).length === fields.length
    && fields.every((field) => Object.hasOwn(value, field));
}

function validateMonth(month: Month): void {
  if (!month || !Number.isInteger(month.year) || month.year < 0 || month.year > 9999) {
    throw new Error('Month year must be an integer from 0 to 9999.');
  }
  if (!Number.isInteger(month.month) || month.month < 0 || month.month > 11) {
    throw new Error('Month index must be an integer from 0 to 11.');
  }
}

export function daysInMonth(month: Month): number {
  validateMonth(month);
  if (month.month === 1) {
    const isLeapYear = month.year % 4 === 0
      && (month.year % 100 !== 0 || month.year % 400 === 0);
    return isLeapYear ? 29 : 28;
  }
  return [3, 5, 8, 10].includes(month.month) ? 30 : 31;
}

export function shiftMonth(month: Month, delta: number): Month {
  validateMonth(month);
  if (!Number.isSafeInteger(delta)) {
    throw new Error('Month delta must be a safe integer.');
  }
  const offset = month.year * 12 + month.month + delta;
  const year = Math.floor(offset / 12);
  const shifted = { year, month: offset - year * 12 };
  validateMonth(shifted);
  return shifted;
}

export function monthKey(month: Month): string {
  validateMonth(month);
  return `${String(month.year).padStart(4, '0')}-${String(month.month + 1).padStart(2, '0')}`;
}

export function dateKey(month: Month, day: number): string {
  const dayCount = daysInMonth(month);
  if (!Number.isInteger(day) || day < 1 || day > dayCount) {
    throw new Error(`Day must be an integer from 1 to ${dayCount} for ${monthKey(month)}.`);
  }
  return `${monthKey(month)}-${String(day).padStart(2, '0')}`;
}

export function localDateKey(now: Date = new Date()): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('The current date must be a valid Date.');
  }
  return dateKey({ year: now.getFullYear(), month: now.getMonth() }, now.getDate());
}

export function isFutureDate(month: Month, day: number, now: Date = new Date()): boolean {
  return dateKey(month, day) > localDateKey(now);
}

export function formatFullDate(month: Month, day: number): string {
  return fullDateFormatter.format(new Date(`${dateKey(month, day)}T12:00:00Z`));
}

function dateParts(value: string): { month: Month; day: number } | null {
  if (typeof value !== 'string' || value.length !== 10) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const month = { year: Number(match[1]), month: Number(match[2]) - 1 };
  const day = Number(match[3]);
  try {
    return day >= 1 && day <= daysInMonth(month) ? { month, day } : null;
  } catch {
    return null;
  }
}

function isValidDateKey(value: string): boolean {
  return dateParts(value) !== null;
}

function isValidMonthKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

function normalizeHabitInputs(value: unknown, ErrorType: new (message: string) => Error): Habit[] {
  if (!Array.isArray(value) || value.length > MAX_HABITS) {
    throw new ErrorType(`Habits must be an array containing at most ${MAX_HABITS} habits.`);
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  return Array.from(value, (candidate: unknown) => {
    if (!isRecord(candidate)) throw new ErrorType('Each habit must contain an id and a name.');
    if (typeof candidate.id !== 'string' || !candidate.id.trim() || candidate.id !== candidate.id.trim()) {
      throw new ErrorType('Habit IDs must be nonempty, trimmed strings.');
    }
    if (ids.has(candidate.id)) throw new ErrorType('Habit IDs must be distinct.');
    if (typeof candidate.name !== 'string') throw new ErrorType('Habit names must be strings.');
    const name = candidate.name.trim();
    if (!name || name.length > MAX_HABIT_NAME_LENGTH) {
      throw new ErrorType(`Habit names must contain 1 to ${MAX_HABIT_NAME_LENGTH} characters.`);
    }
    const foldedName = name.toLowerCase();
    if (names.has(foldedName)) {
      throw new ErrorType('Habit names must be distinct, ignoring case.');
    }
    ids.add(candidate.id);
    names.add(foldedName);
    return { id: candidate.id, name };
  });
}

function validateLegacyHabits(value: unknown): Habit[] {
  const habits = normalizeHabitInputs(value, StorageValidationError);
  if (!(value as unknown[]).every((habit) => isRecord(habit) && hasExactFields(habit, ['id', 'name']))) {
    throw new StorageValidationError('Each legacy habit must contain exactly an id and a name.');
  }
  if (!(value as Array<Record<string, unknown>>).every((habit) => habit.name === String(habit.name).trim())) {
    throw new StorageValidationError('Stored habit names must be trimmed.');
  }
  return habits;
}

function validateHabitPlan(value: unknown, planMonth: string): MonthHabit[] {
  const habits = normalizeHabitInputs(value, StorageValidationError);
  return habits.map((habit, index) => {
    const candidate = (value as unknown[])[index];
    if (!isRecord(candidate) || !hasExactFields(candidate, ['id', 'name', 'startedOn'])) {
      throw new StorageValidationError('Each planned habit must contain exactly id, name, and startedOn.');
    }
    if (candidate.name !== habit.name) {
      throw new StorageValidationError('Stored habit names must be trimmed.');
    }
    if (typeof candidate.startedOn !== 'string' || !isValidDateKey(candidate.startedOn)) {
      throw new StorageValidationError('Habit startedOn values must be real YYYY-MM-DD dates.');
    }
    if (candidate.startedOn.slice(0, 7) > planMonth) {
      throw new StorageValidationError('A habit cannot appear in a plan before its start month.');
    }
    return { ...habit, startedOn: candidate.startedOn };
  });
}

export function getHabitsForMonth(state: TrackerState, month: Month): MonthHabit[] {
  const key = monthKey(month);
  if (key < state.startedOn.slice(0, 7)) return [];
  const planKey = Object.keys(state.habitPlans)
    .filter((candidate) => candidate <= key)
    .sort()
    .at(-1);
  return planKey ? state.habitPlans[planKey].map((habit) => ({ ...habit })) : [];
}

export function habitAvailableFrom(state: TrackerState, habit: MonthHabit): string {
  return state.startedOn > habit.startedOn ? state.startedOn : habit.startedOn;
}

export function isHabitAvailableOnDate(
  state: TrackerState,
  month: Month,
  day: number,
  habitId: string,
): boolean {
  const key = dateKey(month, day);
  const habit = getHabitsForMonth(state, month).find((candidate) => candidate.id === habitId);
  return Boolean(habit && key >= habitAvailableFrom(state, habit));
}

export function createInitialState(now: Date = new Date()): TrackerState {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('The current date must be a valid Date.');
  }
  const month = { year: now.getFullYear(), month: now.getMonth() };
  validateMonth(month);
  const planMonth = monthKey(month);
  const sampleStart = dateKey(month, 1);
  const habits = STARTER_HABITS.map((habit) => ({ ...habit, startedOn: sampleStart }));
  const completions: Record<string, string[]> = {};
  let seed = month.year * 12 + month.month + 1;

  // A month-seeded sequence keeps earlier demo days unchanged as the month advances.
  for (let day = 1; day <= now.getDate(); day += 1) {
    const completed: string[] = [];
    for (const habit of habits) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      if (seed / 0x100000000 < 0.8) completed.push(habit.id);
    }
    if (completed.length > 0) completions[dateKey(month, day)] = completed;
  }

  return {
    version: 2,
    title: 'No Excuses Grind',
    startedOn: sampleStart,
    habitPlans: { [planMonth]: habits },
    completions,
    isDemo: true,
  };
}

function beginRealTracker(state: TrackerState, now: Date): TrackerState {
  const currentMonth = { year: now.getFullYear(), month: now.getMonth() };
  const startedOn = localDateKey(now);
  const habits = getHabitsForMonth(state, currentMonth).map((habit) => ({
    id: habit.id,
    name: habit.name,
    startedOn,
  }));
  return {
    ...state,
    startedOn,
    habitPlans: { [monthKey(currentMonth)]: habits },
    completions: {},
    isDemo: false,
  };
}

export function getMonthStats(
  state: TrackerState,
  month: Month,
): { completed: number; total: number; percentage: number } {
  const dayCount = daysInMonth(month);
  const habits = getHabitsForMonth(state, month);
  const key = monthKey(month);
  let total = 0;
  let completed = 0;

  for (const habit of habits) {
    const availableFrom = habitAvailableFrom(state, habit);
    const availableMonth = availableFrom.slice(0, 7);
    if (availableMonth > key) continue;
    const firstDay = availableMonth === key ? Number(availableFrom.slice(8, 10)) : 1;
    total += dayCount - firstDay + 1;
    for (let day = firstDay; day <= dayCount; day += 1) {
      const ids = state.completions[dateKey(month, day)] ?? [];
      if (ids.includes(habit.id)) completed += 1;
    }
  }

  return {
    completed,
    total,
    percentage: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

export function toggleCompletion(
  state: TrackerState,
  month: Month,
  day: number,
  habitId: string,
  now: Date = new Date(),
): TrackerState {
  const key = dateKey(month, day);
  if (!getHabitsForMonth(state, month).some((habit) => habit.id === habitId)
    || !isHabitAvailableOnDate(state, month, day, habitId)) {
    throw new UnavailableDateError();
  }
  if (isFutureDate(month, day, now)) throw new FutureDateError();

  const ids = new Set(state.completions[key] ?? []);
  if (ids.has(habitId)) ids.delete(habitId);
  else ids.add(habitId);
  const completions = { ...state.completions };
  if (ids.size === 0) delete completions[key];
  else completions[key] = [...ids];
  return { ...state, completions };
}

function knownHabitStarts(state: TrackerState): Map<string, string> {
  const starts = new Map<string, string>();
  for (const plan of Object.values(state.habitPlans)) {
    for (const habit of plan) starts.set(habit.id, habit.startedOn);
  }
  return starts;
}

export function updateHabitPlan(
  state: TrackerState,
  month: Month,
  nextHabits: Habit[],
  now: Date = new Date(),
): TrackerState {
  const normalized = normalizeHabitInputs(nextHabits, Error);
  const base = state.isDemo ? beginRealTracker(state, now) : state;
  const planMonth = monthKey(month);
  if (planMonth < base.startedOn.slice(0, 7)) {
    throw new Error('A routine cannot be changed before the tracker start month.');
  }
  const today = { year: now.getFullYear(), month: now.getMonth() };
  const newHabitStart = planMonth === monthKey(today) ? localDateKey(now) : dateKey(month, 1);
  const existingStarts = knownHabitStarts(base);
  const plan = normalized.map((habit) => ({
    ...habit,
    startedOn: existingStarts.get(habit.id) ?? newHabitStart,
  }));
  const habitPlans = { ...base.habitPlans, [planMonth]: plan };
  const provisional = { ...base, habitPlans };
  const completions: Record<string, string[]> = {};

  for (const [key, ids] of Object.entries(base.completions)) {
    const parts = dateParts(key);
    if (!parts) continue;
    const retained = ids.filter((id) => isHabitAvailableOnDate(provisional, parts.month, parts.day, id));
    if (retained.length > 0) completions[key] = retained;
  }
  return { ...provisional, completions };
}

export function clearTrackerProgress(state: TrackerState, now: Date = new Date()): TrackerState {
  if (state.isDemo) return beginRealTracker(state, now);
  return { ...state, completions: {}, isDemo: false };
}

function migrateLegacyTracker(legacy: LegacyTrackerState): TrackerState {
  return {
    version: 2,
    title: legacy.title,
    startedOn: LEGACY_START_DATE,
    habitPlans: {
      '0000-01': legacy.habits.map((habit) => ({ ...habit, startedOn: LEGACY_START_DATE })),
    },
    completions: legacy.completions,
    isDemo: legacy.isDemo,
  };
}

function parseLegacyTracker(parsed: Record<string, unknown>): TrackerState {
  if (!hasExactFields(parsed, ['version', 'title', 'habits', 'completions', 'isDemo'])) {
    throw new StorageValidationError(
      'Legacy tracker data must contain exactly version, title, habits, completions, and isDemo.',
    );
  }
  if (typeof parsed.title !== 'string' || parsed.title.length > MAX_TITLE_LENGTH) {
    throw new StorageValidationError(`Tracker title must be a string of at most ${MAX_TITLE_LENGTH} characters.`);
  }
  if (typeof parsed.isDemo !== 'boolean') throw new StorageValidationError('The isDemo flag must be a boolean.');
  const habits = validateLegacyHabits(parsed.habits);
  const knownIds = new Set(habits.map((habit) => habit.id));
  if (!isRecord(parsed.completions)) throw new StorageValidationError('Completions must be a date-keyed object.');
  const completions: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(parsed.completions)) {
    if (!isValidDateKey(key)) {
      throw new StorageValidationError(`Invalid completion date: "${key}". Use a real yyyy-mm-dd date.`);
    }
    if (!Array.isArray(value)) throw new StorageValidationError(`Completions for ${key} must be an array of habit IDs.`);
    const uniqueIds = new Set<string>();
    for (const id of value) {
      if (typeof id !== 'string' || !knownIds.has(id)) {
        throw new StorageValidationError(`Completions for ${key} contain an unknown habit ID.`);
      }
      if (uniqueIds.has(id)) throw new StorageValidationError(`Completions for ${key} contain a duplicate habit ID.`);
      uniqueIds.add(id);
    }
    completions[key] = [...uniqueIds];
  }
  return migrateLegacyTracker({
    version: 1,
    title: parsed.title,
    habits,
    completions,
    isDemo: parsed.isDemo,
  });
}

function parseTrackerV2(parsed: Record<string, unknown>): TrackerState {
  if (!hasExactFields(parsed, ['version', 'title', 'startedOn', 'habitPlans', 'completions', 'isDemo'])) {
    throw new StorageValidationError(
      'Tracker data must contain exactly version, title, startedOn, habitPlans, completions, and isDemo.',
    );
  }
  if (typeof parsed.title !== 'string' || parsed.title.length > MAX_TITLE_LENGTH) {
    throw new StorageValidationError(`Tracker title must be a string of at most ${MAX_TITLE_LENGTH} characters.`);
  }
  if (typeof parsed.startedOn !== 'string' || !isValidDateKey(parsed.startedOn)) {
    throw new StorageValidationError('Tracker startedOn must be a real YYYY-MM-DD date.');
  }
  if (typeof parsed.isDemo !== 'boolean') throw new StorageValidationError('The isDemo flag must be a boolean.');
  if (!isRecord(parsed.habitPlans)) throw new StorageValidationError('Habit plans must be a month-keyed object.');
  const startMonth = parsed.startedOn.slice(0, 7);
  if (!Object.hasOwn(parsed.habitPlans, startMonth)) {
    throw new StorageValidationError('Habit plans must contain a baseline plan for the tracker start month.');
  }
  const habitPlans: Record<string, MonthHabit[]> = {};
  const startsById = new Map<string, string>();
  for (const [key, value] of Object.entries(parsed.habitPlans)) {
    if (!isValidMonthKey(key) || key < startMonth) {
      throw new StorageValidationError(`Invalid habit plan month: "${key}".`);
    }
    const plan = validateHabitPlan(value, key);
    for (const habit of plan) {
      if (habit.startedOn < parsed.startedOn) {
        throw new StorageValidationError('Habit start dates cannot precede the tracker start date.');
      }
      const previousStart = startsById.get(habit.id);
      if (previousStart && previousStart !== habit.startedOn) {
        throw new StorageValidationError('A habit ID must keep the same start date across monthly plans.');
      }
      startsById.set(habit.id, habit.startedOn);
    }
    habitPlans[key] = plan;
  }

  const state: TrackerState = {
    version: 2,
    title: parsed.title,
    startedOn: parsed.startedOn,
    habitPlans,
    completions: {},
    isDemo: parsed.isDemo,
  };
  if (!isRecord(parsed.completions)) throw new StorageValidationError('Completions must be a date-keyed object.');
  for (const [key, value] of Object.entries(parsed.completions)) {
    const parts = dateParts(key);
    if (!parts) {
      throw new StorageValidationError(`Invalid completion date: "${key}". Use a real yyyy-mm-dd date.`);
    }
    if (!Array.isArray(value)) throw new StorageValidationError(`Completions for ${key} must be an array of habit IDs.`);
    const uniqueIds = new Set<string>();
    for (const id of value) {
      if (typeof id !== 'string' || !isHabitAvailableOnDate(state, parts.month, parts.day, id)) {
        throw new StorageValidationError(`Completions for ${key} contain an unavailable habit ID.`);
      }
      if (uniqueIds.has(id)) throw new StorageValidationError(`Completions for ${key} contain a duplicate habit ID.`);
      uniqueIds.add(id);
    }
    state.completions[key] = [...uniqueIds];
  }
  return state;
}

export function parseStoredState(value: string): TrackerState {
  if (typeof value !== 'string') {
    throw new StorageValidationError('Stored tracker data must be a JSON string.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) throw new StorageValidationError('Stored tracker data is not valid JSON.');
    throw error;
  }
  if (!isRecord(parsed)) throw new StorageValidationError('Stored tracker data must be an object.');
  if (parsed.version === 1) return parseLegacyTracker(parsed);
  if (parsed.version === 2) return parseTrackerV2(parsed);
  throw new StorageValidationError('Stored tracker version must be 1 or 2.');
}

export function polarPoint(
  cx: number,
  cy: number,
  radius: number,
  angle: number,
): { x: number; y: number } {
  if (![cx, cy, radius, angle].every(Number.isFinite) || radius < 0) {
    throw new Error('Polar coordinates require finite numbers and a nonnegative radius.');
  }
  const radians = ((angle % 360) * Math.PI) / 180;
  const point = { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error('Polar coordinates exceed the supported numeric range.');
  }
  return point;
}

function svgNumber(value: number): string {
  return String(Number(value.toFixed(3)));
}

export function annularSectorPath(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  if (![cx, cy, innerRadius, outerRadius, startAngle, endAngle].every(Number.isFinite)) {
    throw new Error('Annular sector coordinates, radii, and angles must be finite numbers.');
  }
  if (innerRadius < 0 || outerRadius <= innerRadius) {
    throw new Error('Annular sector radii must satisfy 0 <= inner radius < outer radius.');
  }
  const span = endAngle - startAngle;
  if (span === 0 || Math.abs(span) > 360) {
    throw new Error('Annular sector angles must span more than 0 and at most 360 degrees.');
  }
  const pointAt = (radius: number, angle: number): string => {
    const point = polarPoint(cx, cy, radius, angle);
    return `${svgNumber(point.x)} ${svgNumber(point.y)}`;
  };
  const arcTo = (radius: number, from: number, to: number): string =>
    `A ${svgNumber(radius)} ${svgNumber(radius)} 0 ${Math.abs(to - from) > 180 ? 1 : 0} ${to > from ? 1 : 0} ${pointAt(radius, to)}`;

  // SVG arcs with coincident endpoints cannot draw a full circle in one segment.
  const fullCircle = Math.abs(span) === 360;
  const angles = fullCircle
    ? [startAngle, startAngle + span / 2, endAngle]
    : [startAngle, endAngle];
  const path = [`M ${pointAt(outerRadius, startAngle)}`];
  for (let index = 1; index < angles.length; index += 1) {
    path.push(arcTo(outerRadius, angles[index - 1], angles[index]));
  }
  if (innerRadius > 0) {
    if (fullCircle) path.push('Z');
    path.push(`${fullCircle ? 'M' : 'L'} ${pointAt(innerRadius, endAngle)}`);
    for (let index = angles.length - 1; index > 0; index -= 1) {
      path.push(arcTo(innerRadius, angles[index], angles[index - 1]));
    }
  } else if (!fullCircle) {
    path.push(`L ${svgNumber(cx)} ${svgNumber(cy)}`);
  }
  path.push('Z');
  return path.join(' ');
}

export function getDaySectors(
  month: Month,
): Array<{ day: number; startAngle: number; endAngle: number; midAngle: number; endsWeek: boolean }> {
  const dayCount = daysInMonth(month);
  const dailyGap = 0.6;
  const weeklyGap = 2.6;
  const firstDate = new Date(Date.UTC(1970, 0, 1, 12));
  firstDate.setUTCFullYear(month.year, month.month, 1);
  const firstWeekday = firstDate.getUTCDay();
  const endsWeek = (day: number) => (firstWeekday + day - 1) % 7 === 0;
  const weekBoundaries = Array.from(
    { length: dayCount - 1 },
    (_, index) => index + 1,
  ).filter(endsWeek).length;
  const width = (270 - (dayCount - 1) * dailyGap - weekBoundaries * weeklyGap) / dayCount;
  let passedWeekBoundaries = 0;

  return Array.from({ length: dayCount }, (_, index) => {
    const day = index + 1;
    const startAngle = -90 + index * (width + dailyGap) + passedWeekBoundaries * weeklyGap;
    const endAngle = index === dayCount - 1 ? 180 : startAngle + width;
    const sector = { day, startAngle, endAngle, midAngle: (startAngle + endAngle) / 2, endsWeek: endsWeek(day) };
    if (sector.endsWeek && day < dayCount) passedWeekBoundaries += 1;
    return sector;
  });
}

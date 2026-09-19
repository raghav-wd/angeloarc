export const MAX_HABITS = 9;
export const MAX_HABIT_NAME_LENGTH = 32;
export const MAX_TITLE_LENGTH = 60;
export const STORAGE_KEY = 'angelo-routine-v1';

export interface Habit {
  id: string;
  name: string;
}

export interface Month {
  year: number;
  month: number;
}

export interface TrackerState {
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

const STARTER_HABITS: readonly Habit[] = [
  { id: 'move', name: 'Move your body' },
  { id: 'read', name: 'Read 10 pages' },
  { id: 'water', name: 'Drink more water' },
  { id: 'focus', name: 'Deep work' },
  { id: 'mind', name: 'Quiet your mind' },
  { id: 'sleep', name: 'Sleep 8 hours' },
];

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

export function isFutureDate(month: Month, day: number, now: Date = new Date()): boolean {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('The current date must be a valid Date.');
  }
  const today = { year: now.getFullYear(), month: now.getMonth() };
  return dateKey(month, day) > dateKey(today, now.getDate());
}

export function formatFullDate(month: Month, day: number): string {
  return fullDateFormatter.format(new Date(`${dateKey(month, day)}T12:00:00Z`));
}

export function createInitialState(now: Date = new Date()): TrackerState {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('The current date must be a valid Date.');
  }
  const month = { year: now.getFullYear(), month: now.getMonth() };
  validateMonth(month);
  const habits = STARTER_HABITS.map((habit) => ({ ...habit }));
  const completions: Record<string, string[]> = {};
  let seed = month.year * 12 + month.month + 1;

  // A month-seeded sequence keeps earlier demo days unchanged as the month advances.
  for (let day = 1; day <= now.getDate(); day += 1) {
    const completed: string[] = [];
    for (const habit of habits) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      if (seed / 0x100000000 < 0.8) {
        completed.push(habit.id);
      }
    }
    if (completed.length > 0) {
      completions[dateKey(month, day)] = completed;
    }
  }

  return {
    version: 1,
    title: 'No Excuses Grind',
    habits,
    completions,
    isDemo: true,
  };
}

export function getMonthStats(
  state: TrackerState,
  month: Month,
): { completed: number; total: number; percentage: number } {
  const dayCount = daysInMonth(month);
  // Consistency measures progress toward the whole month, including days still ahead.
  const total = dayCount * state.habits.length;
  if (total === 0) {
    return { completed: 0, total: 0, percentage: 0 };
  }

  const knownIds = new Set(state.habits.map((habit) => habit.id));
  let completed = 0;
  for (let day = 1; day <= dayCount; day += 1) {
    const ids = new Set(state.completions[dateKey(month, day)] ?? []);
    for (const id of ids) {
      if (knownIds.has(id)) completed += 1;
    }
  }
  return { completed, total, percentage: Math.round((completed / total) * 100) };
}

export function toggleCompletion(
  state: TrackerState,
  month: Month,
  day: number,
  habitId: string,
  now: Date = new Date(),
): TrackerState {
  const key = dateKey(month, day);
  if (!state.habits.some((habit) => habit.id === habitId)) {
    throw new Error(`Cannot toggle an unknown habit ID: "${habitId}".`);
  }
  if (isFutureDate(month, day, now)) {
    throw new FutureDateError();
  }

  const ids = new Set(state.completions[key] ?? []);
  if (ids.has(habitId)) {
    ids.delete(habitId);
  } else {
    ids.add(habitId);
  }
  const completions = { ...state.completions };
  if (ids.size === 0) {
    delete completions[key];
  } else {
    completions[key] = [...ids];
  }
  return { ...state, completions };
}

function validateHabits(
  value: unknown,
  ErrorType: new (message: string) => Error,
  requireTrimmedNames = false,
): Habit[] {
  if (!Array.isArray(value) || value.length > MAX_HABITS) {
    throw new ErrorType(`Habits must be an array containing at most ${MAX_HABITS} habits.`);
  }

  const ids = new Set<string>();
  const names = new Set<string>();
  return Array.from(value, (habit: unknown) => {
    if (!isRecord(habit) || !hasExactFields(habit, ['id', 'name'])) {
      throw new ErrorType('Each habit must contain exactly an id and a name.');
    }
    if (typeof habit.id !== 'string' || !habit.id.trim() || habit.id !== habit.id.trim()) {
      throw new ErrorType('Habit IDs must be nonempty, trimmed strings.');
    }
    if (ids.has(habit.id)) {
      throw new ErrorType('Habit IDs must be distinct.');
    }
    if (typeof habit.name !== 'string') {
      throw new ErrorType('Habit names must be strings.');
    }
    const name = habit.name.trim();
    if (!name || name.length > MAX_HABIT_NAME_LENGTH) {
      throw new ErrorType(`Habit names must contain 1 to ${MAX_HABIT_NAME_LENGTH} characters.`);
    }
    if (requireTrimmedNames && name !== habit.name) {
      throw new ErrorType('Stored habit names must be trimmed.');
    }
    const foldedName = name.toLowerCase();
    if (names.has(foldedName)) {
      throw new ErrorType('Habit names must be distinct, ignoring case.');
    }
    ids.add(habit.id);
    names.add(foldedName);
    return { id: habit.id, name };
  });
}

export function reconcileHabits(state: TrackerState, habits: Habit[]): TrackerState {
  const nextHabits = validateHabits(habits, Error);
  const knownIds = new Set(nextHabits.map((habit) => habit.id));
  const completions: Record<string, string[]> = {};
  for (const [key, ids] of Object.entries(state.completions)) {
    const retained = [...new Set(ids.filter((id) => knownIds.has(id)))];
    if (retained.length > 0) {
      completions[key] = retained;
    }
  }
  return { ...state, habits: nextHabits, completions };
}

function isValidDateKey(key: string): boolean {
  if (key.length !== 10) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return false;
  const month = { year: Number(match[1]), month: Number(match[2]) - 1 };
  const day = Number(match[3]);
  return month.month >= 0 && month.month <= 11
    && day >= 1 && day <= daysInMonth(month);
}

export function parseStoredState(value: string): TrackerState {
  if (typeof value !== 'string') {
    throw new StorageValidationError('Stored tracker data must be a JSON string.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new StorageValidationError('Stored tracker data is not valid JSON.');
    }
    throw error;
  }

  if (!isRecord(parsed)
    || !hasExactFields(parsed, ['version', 'title', 'habits', 'completions', 'isDemo'])) {
    throw new StorageValidationError(
      'Stored tracker data must contain exactly version, title, habits, completions, and isDemo.',
    );
  }
  if (parsed.version !== 1) {
    throw new StorageValidationError('Stored tracker version must be 1.');
  }
  if (typeof parsed.title !== 'string' || parsed.title.length > MAX_TITLE_LENGTH) {
    throw new StorageValidationError(`Tracker title must be a string of at most ${MAX_TITLE_LENGTH} characters.`);
  }
  if (typeof parsed.isDemo !== 'boolean') {
    throw new StorageValidationError('The isDemo flag must be a boolean.');
  }
  const habits = validateHabits(parsed.habits, StorageValidationError, true);
  const knownIds = new Set(habits.map((habit) => habit.id));
  if (!isRecord(parsed.completions)) {
    throw new StorageValidationError('Completions must be a date-keyed object.');
  }

  const completions: Record<string, string[]> = {};
  for (const [key, ids] of Object.entries(parsed.completions)) {
    if (!isValidDateKey(key)) {
      throw new StorageValidationError(`Invalid completion date: "${key}". Use a real yyyy-mm-dd date.`);
    }
    if (!Array.isArray(ids)) {
      throw new StorageValidationError(`Completions for ${key} must be an array of habit IDs.`);
    }
    const uniqueIds = new Set<string>();
    for (const id of ids) {
      if (typeof id !== 'string' || !knownIds.has(id)) {
        throw new StorageValidationError(`Completions for ${key} contain an unknown habit ID.`);
      }
      if (uniqueIds.has(id)) {
        throw new StorageValidationError(`Completions for ${key} contain a duplicate habit ID.`);
      }
      uniqueIds.add(id);
    }
    completions[key] = [...uniqueIds];
  }
  return {
    version: 1,
    title: parsed.title,
    habits,
    completions,
    isDemo: parsed.isDemo,
  };
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
  dayCount: number,
): Array<{ day: number; startAngle: number; endAngle: number; midAngle: number }> {
  if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > 31) {
    throw new Error('Day count must be an integer from 1 to 31.');
  }
  const dailyGap = 0.6;
  const weeklyGap = 2.6;
  const weekBoundaries = Math.floor((dayCount - 1) / 7);
  const width = (270 - (dayCount - 1) * dailyGap - weekBoundaries * weeklyGap) / dayCount;
  return Array.from({ length: dayCount }, (_, index) => {
    const startAngle = -90 + index * (width + dailyGap) + Math.floor(index / 7) * weeklyGap;
    const endAngle = index === dayCount - 1 ? 180 : startAngle + width;
    return { day: index + 1, startAngle, endAngle, midAngle: (startAngle + endAngle) / 2 };
  });
}

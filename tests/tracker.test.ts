import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_HABITS,
  MAX_HABIT_NAME_LENGTH,
  MAX_TITLE_LENGTH,
  STORAGE_KEY,
  FutureDateError,
  StorageValidationError,
  UnavailableDateError,
  annularSectorPath,
  clearTrackerProgress,
  createInitialState,
  dateKey,
  daysInMonth,
  formatFullDate,
  getDaySectors,
  getHabitsForMonth,
  getMonthStats,
  habitAvailableFrom,
  isFutureDate,
  isHabitAvailableOnDate,
  monthKey,
  parseStoredState,
  polarPoint,
  shiftMonth,
  toggleCompletion,
  updateHabitPlan,
  type Habit,
  type Month,
  type MonthHabit,
  type TrackerState,
} from '../src/lib/tracker.ts';

const august: Month = { year: 2026, month: 7 };
const september: Month = { year: 2026, month: 8 };
const october: Month = { year: 2026, month: 9 };
const septemberNineteenth = new Date(2026, 8, 19, 12);
const endOfSeptember = new Date(2026, 8, 30, 12);

function monthHabit(id: string, name: string, startedOn = '2026-08-01'): MonthHabit {
  return { id, name, startedOn };
}

function stateWith(overrides: Partial<TrackerState> = {}): TrackerState {
  return {
    version: 2,
    title: 'My routine',
    startedOn: '2026-08-01',
    habitPlans: {
      '2026-08': [monthHabit('move', 'Move'), monthHabit('read', 'Read')],
    },
    completions: {},
    isDemo: false,
    ...overrides,
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function approximately(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);
}

function rejectsStored(value: unknown): void {
  const serialized = JSON.stringify(value);
  assert.ok(serialized !== undefined);
  assert.throws(() => parseStoredState(serialized), StorageValidationError);
}

describe('calendar helpers and constants', () => {
  it('exports the persistence key and editing limits', () => {
    assert.equal(MAX_HABITS, 9);
    assert.equal(MAX_HABIT_NAME_LENGTH, 32);
    assert.equal(MAX_TITLE_LENGTH, 60);
    assert.equal(STORAGE_KEY, 'angelo-routine-v1');
  });

  it('returns the correct length for all months', () => {
    const actual = Array.from({ length: 12 }, (_, month) => daysInMonth({ year: 2026, month }));
    assert.deepEqual(actual, [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
  });

  for (const [year, days] of [[2024, 29], [2025, 28], [1900, 28], [2000, 29], [2100, 28], [0, 29]]) {
    it(`handles Gregorian leap rules in ${year}`, () => {
      assert.equal(daysInMonth({ year, month: 1 }), days);
    });
  }

  it('shifts across month and year boundaries without mutation', () => {
    const month = deepFreeze({ year: 2026, month: 11 });
    assert.deepEqual(shiftMonth(month, 1), { year: 2027, month: 0 });
    assert.deepEqual(shiftMonth({ year: 2026, month: 0 }, -1), { year: 2025, month: 11 });
    assert.deepEqual(shiftMonth(month, 26), { year: 2029, month: 1 });
    assert.deepEqual(shiftMonth(month, -25), { year: 2024, month: 10 });
    assert.deepEqual(shiftMonth(month, 0), month);
    assert.notEqual(shiftMonth(month, 0), month);
    assert.deepEqual(month, { year: 2026, month: 11 });
  });

  it('formats zero-based months, low years, and full dates correctly', () => {
    assert.equal(monthKey(september), '2026-09');
    assert.equal(monthKey({ year: 9, month: 0 }), '0009-01');
    assert.equal(dateKey({ year: 0, month: 1 }, 29), '0000-02-29');
    assert.equal(dateKey({ year: 99, month: 11 }, 31), '0099-12-31');
    assert.deepEqual(shiftMonth({ year: 99, month: 11 }, 1), { year: 100, month: 0 });
    assert.equal(formatFullDate({ year: 2020, month: 1 }, 29), 'Saturday, February 29, 2020');
    assert.equal(formatFullDate(september, 1), 'Tuesday, September 1, 2026');
  });

  it('rejects invalid months, days, dates, and shifts instead of normalizing them', () => {
    for (const month of [
      { year: 2026, month: -1 }, { year: 2026, month: 12 }, { year: 2026, month: 1.5 },
      { year: -1, month: 0 }, { year: 10000, month: 0 }, { year: 2026.5, month: 0 },
      { year: NaN, month: 0 }, { year: 2026, month: Infinity },
    ]) {
      assert.throws(() => daysInMonth(month), /Month/);
      assert.throws(() => monthKey(month), /Month/);
      assert.throws(() => shiftMonth(month, 0), /Month/);
    }
    assert.throws(() => daysInMonth(null as unknown as Month), /Month/);
    for (const day of [0, -1, 31, 1.5, NaN, Infinity]) {
      assert.throws(() => dateKey(september, day), /Day/);
      assert.throws(() => formatFullDate(september, day), /Day/);
    }
    assert.throws(() => dateKey({ year: 2025, month: 1 }, 29), /Day/);
    assert.equal(dateKey({ year: 2024, month: 1 }, 29), '2024-02-29');
    for (const delta of [0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => shiftMonth(september, delta), /delta/);
    }
    assert.throws(() => shiftMonth({ year: 0, month: 0 }, -1), /year/);
    assert.throws(() => shiftMonth({ year: 9999, month: 11 }, 1), /year/);
  });
});

describe('initial demo state and reset', () => {
  it('starts a V2 demo on day one of the current month with the ordered starter plan', () => {
    const state = createInitialState(septemberNineteenth);
    const habits = getHabitsForMonth(state, september);
    assert.equal(state.version, 2);
    assert.equal(state.title, 'No Excuses Grind');
    assert.equal(state.startedOn, '2026-09-01');
    assert.deepEqual(Object.keys(state.habitPlans), ['2026-09']);
    assert.equal(state.isDemo, true);
    assert.deepEqual(habits.map((habit) => habit.name), [
      'Move your body', 'Read 10 pages', 'Drink more water',
      'Deep work', 'Quiet your mind', 'Sleep 8 hours',
    ]);
    assert.ok(habits.every((habit) => habit.startedOn === '2026-09-01'));
    assert.equal(new Set(habits.map((habit) => habit.id)).size, 6);
    assert.deepEqual(getHabitsForMonth(state, august), []);
  });

  it('is deterministic and returns independent plans and completion arrays', () => {
    const now = new Date(2026, 8, 19, 12);
    const timestamp = now.getTime();
    const first = createInitialState(now);
    const second = createInitialState(new Date(2026, 8, 19, 23, 59));
    assert.deepEqual(first, second);
    assert.equal(now.getTime(), timestamp);
    assert.notEqual(first, second);
    assert.notEqual(first.habitPlans, second.habitPlans);
    assert.notEqual(first.habitPlans['2026-09'], second.habitPlans['2026-09']);
    assert.notEqual(first.habitPlans['2026-09'][0], second.habitPlans['2026-09'][0]);
    assert.notEqual(first.completions, second.completions);
    for (const key of Object.keys(first.completions)) {
      assert.notEqual(first.completions[key], second.completions[key]);
    }
    first.habitPlans['2026-09'][0].name = 'Changed';
    assert.equal(createInitialState(now).habitPlans['2026-09'][0].name, 'Move your body');
  });

  for (const [year, month, day] of [[2026, 8, 19], [2024, 1, 29], [2026, 3, 30], [2026, 0, 31]]) {
    it(`seeds valid, roughly 80% progress only through ${year}-${month + 1}-${day}`, () => {
      const selectedMonth = { year, month };
      const state = createInitialState(new Date(year, month, day, 12));
      const habits = getHabitsForMonth(state, selectedMonth);
      const known = new Set(habits.map((habit) => habit.id));
      let completed = 0;
      for (const [key, ids] of Object.entries(state.completions)) {
        assert.ok(key.startsWith(`${monthKey(selectedMonth)}-`));
        const sampleDay = Number(key.slice(-2));
        assert.ok(sampleDay >= 1 && sampleDay <= day);
        assert.equal(key, dateKey(selectedMonth, sampleDay));
        assert.ok(ids.length > 0);
        assert.equal(new Set(ids).size, ids.length);
        assert.ok(ids.every((id) => known.has(id)));
        completed += ids.length;
      }
      const proportion = completed / (day * habits.length);
      assert.ok(proportion >= 0.7 && proportion <= 0.9, `Unexpected demo proportion: ${proportion}`);
      assert.deepEqual(parseStoredState(JSON.stringify(state)), state);
    });
  }

  it('keeps earlier sample days stable and seeds no later dates on day one', () => {
    const earlier = createInitialState(new Date(2026, 8, 10, 12));
    const later = createInitialState(septemberNineteenth);
    for (let day = 1; day <= 10; day += 1) {
      const key = dateKey(september, day);
      assert.deepEqual(earlier.completions[key], later.completions[key]);
    }
    const firstDay = createInitialState(new Date(2027, 0, 1, 0, 1));
    assert.deepEqual(Object.keys(firstDay.completions), ['2027-01-01']);
  });

  it('clears a demo into a real tracker starting today with only the current plan', () => {
    const demo = deepFreeze(createInitialState(septemberNineteenth));
    const cleared = clearTrackerProgress(demo, septemberNineteenth);
    assert.equal(cleared.startedOn, '2026-09-19');
    assert.equal(cleared.isDemo, false);
    assert.deepEqual(cleared.completions, {});
    assert.deepEqual(Object.keys(cleared.habitPlans), ['2026-09']);
    assert.ok(cleared.habitPlans['2026-09'].every((habit) => habit.startedOn === '2026-09-19'));
    assert.deepEqual(getMonthStats(cleared, september), {
      completed: 0, total: 6 * 12, percentage: 0,
    });
    assert.equal(demo.startedOn, '2026-09-01');
    assert.notDeepEqual(demo.completions, {});
  });

  it('clears a real tracker without moving its start or rewriting plans', () => {
    const original = deepFreeze(stateWith({ completions: { '2026-09-01': ['move'] } }));
    const cleared = clearTrackerProgress(original, septemberNineteenth);
    assert.deepEqual(cleared, { ...original, completions: {}, isDemo: false });
    assert.equal(cleared.habitPlans, original.habitPlans);
  });

  it('rejects invalid current dates', () => {
    assert.throws(() => createInitialState(new Date(NaN)), /valid Date/);
    assert.throws(() => createInitialState('2026-09-01' as unknown as Date), /valid Date/);
    assert.throws(() => clearTrackerProgress(createInitialState(septemberNineteenth), new Date(NaN)), /valid Date/);
  });
});

describe('habit plan change points and availability', () => {
  it('inherits the latest plan at or before a month and returns copies', () => {
    const state = stateWith({
      habitPlans: {
        '2026-08': [monthHabit('move', 'Move'), monthHabit('read', 'Read')],
        '2026-10': [monthHabit('move', 'Walk'), monthHabit('sleep', 'Sleep', '2026-10-01')],
      },
    });
    assert.deepEqual(getHabitsForMonth(state, { year: 2026, month: 6 }), []);
    assert.deepEqual(getHabitsForMonth(state, august), state.habitPlans['2026-08']);
    assert.deepEqual(getHabitsForMonth(state, september), state.habitPlans['2026-08']);
    assert.deepEqual(getHabitsForMonth(state, october), state.habitPlans['2026-10']);
    assert.deepEqual(getHabitsForMonth(state, { year: 2026, month: 10 }), state.habitPlans['2026-10']);
    const copy = getHabitsForMonth(state, september);
    assert.notEqual(copy, state.habitPlans['2026-08']);
    assert.notEqual(copy[0], state.habitPlans['2026-08'][0]);
    copy[0].name = 'Changed only in the copy';
    assert.equal(state.habitPlans['2026-08'][0].name, 'Move');
  });

  it('starts a new current-month habit today and leaves the previous month unchanged', () => {
    const original = deepFreeze(stateWith());
    const result = updateHabitPlan(original, september, [
      { id: 'read', name: 'Read a book' },
      { id: 'move', name: 'Move' },
      { id: 'sleep', name: 'Sleep' },
    ], septemberNineteenth);
    assert.deepEqual(getHabitsForMonth(result, august), original.habitPlans['2026-08']);
    assert.deepEqual(result.habitPlans['2026-09'], [
      monthHabit('read', 'Read a book'),
      monthHabit('move', 'Move'),
      monthHabit('sleep', 'Sleep', '2026-09-19'),
    ]);
    assert.deepEqual(getHabitsForMonth(result, october), result.habitPlans['2026-09']);
    assert.equal(isHabitAvailableOnDate(result, september, 18, 'sleep'), false);
    assert.equal(isHabitAvailableOnDate(result, september, 19, 'sleep'), true);
    assert.equal(original.habitPlans['2026-09'], undefined);
  });

  it('starts a new habit on day one when editing a past month', () => {
    const julyState = stateWith({
      startedOn: '2026-07-10',
      habitPlans: { '2026-07': [monthHabit('move', 'Move', '2026-07-10')] },
    });
    const result = updateHabitPlan(julyState, august, [
      { id: 'move', name: 'Move' }, { id: 'swim', name: 'Swim' },
    ], septemberNineteenth);
    assert.deepEqual(getHabitsForMonth(result, { year: 2026, month: 6 }), julyState.habitPlans['2026-07']);
    assert.deepEqual(result.habitPlans['2026-08'], [
      monthHabit('move', 'Move', '2026-07-10'),
      monthHabit('swim', 'Swim', '2026-08-01'),
    ]);
    assert.equal(isHabitAvailableOnDate(result, august, 1, 'swim'), true);
  });

  it('uses the later tracker or habit start and is unavailable before either', () => {
    const state = stateWith({
      startedOn: '2026-09-10',
      habitPlans: {
        '2026-09': [
          monthHabit('move', 'Move', '2026-09-10'),
          monthHabit('read', 'Read', '2026-09-15'),
        ],
      },
    });
    const [move, read] = getHabitsForMonth(state, september);
    assert.equal(habitAvailableFrom(state, move), '2026-09-10');
    assert.equal(habitAvailableFrom(state, read), '2026-09-15');
    assert.deepEqual(getHabitsForMonth(state, august), []);
    assert.equal(isHabitAvailableOnDate(state, september, 9, 'move'), false);
    assert.equal(isHabitAvailableOnDate(state, september, 10, 'move'), true);
    assert.equal(isHabitAvailableOnDate(state, september, 14, 'read'), false);
    assert.equal(isHabitAvailableOnDate(state, september, 15, 'read'), true);
    assert.equal(isHabitAvailableOnDate(state, october, 1, 'read'), true);
    assert.equal(isHabitAvailableOnDate(state, september, 15, 'missing'), false);
  });

  it('removing from a plan preserves earlier history and scrubs later invalid completions', () => {
    const original = deepFreeze(stateWith({
      completions: {
        '2026-08-31': ['move', 'read'],
        '2026-09-01': ['move', 'read'],
        '2026-09-02': ['read'],
        '2026-10-01': ['read'],
        '2026-10-02': ['move'],
      },
    }));
    const result = updateHabitPlan(original, september, [{ id: 'move', name: 'Move' }], septemberNineteenth);
    assert.deepEqual(getHabitsForMonth(result, august), original.habitPlans['2026-08']);
    assert.deepEqual(getHabitsForMonth(result, september), [monthHabit('move', 'Move')]);
    assert.deepEqual(result.completions, {
      '2026-08-31': ['move', 'read'],
      '2026-09-01': ['move'],
      '2026-10-02': ['move'],
    });
    assert.deepEqual(original.completions['2026-09-01'], ['move', 'read']);
  });

  it('renames and reorders by stable ID without losing eligible completions', () => {
    const original = stateWith({
      completions: { '2026-08-31': ['move'], '2026-09-01': ['move', 'read'] },
    });
    const result = updateHabitPlan(original, september, [
      { id: 'read', name: 'Read' }, { id: 'move', name: 'Walk' },
    ], septemberNineteenth);
    assert.equal(getHabitsForMonth(result, august)[0].name, 'Move');
    assert.deepEqual(getHabitsForMonth(result, september), [
      monthHabit('read', 'Read'), monthHabit('move', 'Walk'),
    ]);
    assert.deepEqual(result.completions, original.completions);
  });

  it('allows nine habits per plan and more than nine IDs over the lifetime', () => {
    const januaryHabits = Array.from({ length: 9 }, (_, index) =>
      monthHabit(`january-${index}`, `January ${index}`, '2026-01-01'));
    const februaryHabits = Array.from({ length: 9 }, (_, index) =>
      monthHabit(`february-${index}`, `February ${index}`, '2026-02-01'));
    const lifetimeState: TrackerState = {
      version: 2,
      title: 'Changing seasons',
      startedOn: '2026-01-01',
      habitPlans: { '2026-01': januaryHabits, '2026-02': februaryHabits },
      completions: { '2026-01-01': ['january-0'], '2026-02-01': ['february-0'] },
      isDemo: false,
    };
    const parsed = parseStoredState(JSON.stringify(lifetimeState));
    assert.equal(new Set(Object.values(parsed.habitPlans).flat().map((habit) => habit.id)).size, 18);
    assert.deepEqual(getMonthStats(parsed, { year: 2026, month: 0 }), {
      completed: 1, total: 279, percentage: 0,
    });
    assert.deepEqual(getMonthStats(parsed, { year: 2026, month: 1 }), {
      completed: 1, total: 252, percentage: 0,
    });
    const tooMany: Habit[] = Array.from({ length: 10 }, (_, index) => ({
      id: `habit-${index}`, name: `Habit ${index}`,
    }));
    assert.throws(() => updateHabitPlan(stateWith(), september, tooMany, septemberNineteenth), /at most 9/);
  });

  it('normalizes editable names and rejects duplicate or pre-start plans', () => {
    const result = updateHabitPlan(stateWith(), september, [
      { id: 'move', name: '  Morning walk  ' },
    ], septemberNineteenth);
    assert.equal(result.habitPlans['2026-09'][0].name, 'Morning walk');
    assert.throws(() => updateHabitPlan(stateWith(), september, [
      { id: 'one', name: 'Read' }, { id: 'two', name: ' read ' },
    ], septemberNineteenth), /distinct, ignoring case/);
    assert.throws(() => updateHabitPlan(stateWith(), { year: 2026, month: 6 }, [], septemberNineteenth), /before/);
  });
});

describe('partial-month consistency', () => {
  it('counts eligible habit-days, including future eligible days, in the denominator', () => {
    const state = deepFreeze(stateWith({
      startedOn: '2026-09-10',
      habitPlans: {
        '2026-09': [
          monthHabit('move', 'Move', '2026-09-10'),
          monthHabit('read', 'Read', '2026-09-20'),
        ],
      },
      completions: {
        '2026-09-09': ['move'],
        '2026-09-10': ['move'],
        '2026-09-19': ['read'],
        '2026-09-20': ['read'],
        '2026-09-30': ['move', 'read'],
        '2026-10-01': ['move', 'read'],
      },
    }));
    assert.deepEqual(getMonthStats(state, september), {
      completed: 4,
      total: 32,
      percentage: 13,
    });
    assert.deepEqual(getMonthStats(state, august), { completed: 0, total: 0, percentage: 0 });
  });

  it('handles partial leap and common Februaries', () => {
    const leapState: TrackerState = {
      version: 2,
      title: 'Leap',
      startedOn: '2024-02-28',
      habitPlans: { '2024-02': [monthHabit('move', 'Move', '2024-02-28')] },
      completions: { '2024-02-29': ['move'] },
      isDemo: false,
    };
    assert.deepEqual(getMonthStats(leapState, { year: 2024, month: 1 }), {
      completed: 1, total: 2, percentage: 50,
    });
    const commonState: TrackerState = {
      ...leapState,
      startedOn: '2025-02-28',
      habitPlans: { '2025-02': [monthHabit('move', 'Move', '2025-02-28')] },
      completions: { '2025-02-28': ['move'] },
    };
    assert.deepEqual(getMonthStats(commonState, { year: 2025, month: 1 }), {
      completed: 1, total: 1, percentage: 100,
    });
  });

  it('returns zeroes for zero habits and for months before the tracker start', () => {
    const state = stateWith({
      startedOn: '2026-09-19',
      habitPlans: { '2026-09': [] },
      completions: {},
    });
    assert.deepEqual(getMonthStats(state, september), { completed: 0, total: 0, percentage: 0 });
    assert.deepEqual(getMonthStats(state, august), { completed: 0, total: 0, percentage: 0 });
  });

  it('reaches 100 percent when every eligible day is complete', () => {
    const state = stateWith({
      startedOn: '2026-09-28',
      habitPlans: { '2026-09': [monthHabit('move', 'Move', '2026-09-28')] },
    });
    for (let day = 28; day <= 30; day += 1) state.completions[dateKey(september, day)] = ['move'];
    assert.deepEqual(getMonthStats(state, september), { completed: 3, total: 3, percentage: 100 });
  });
});

describe('completion toggling', () => {
  it('toggles an eligible date immutably and removes an empty completion key', () => {
    const original = deepFreeze(stateWith({ completions: { '2026-08-31': ['read'] } }));
    const enabled = toggleCompletion(original, september, 30, 'move', endOfSeptember);
    assert.notEqual(enabled, original);
    assert.notEqual(enabled.completions, original.completions);
    assert.equal(enabled.habitPlans, original.habitPlans);
    assert.deepEqual(enabled.completions['2026-08-31'], ['read']);
    assert.deepEqual(enabled.completions['2026-09-30'], ['move']);
    assert.equal(original.completions['2026-09-30'], undefined);

    deepFreeze(enabled);
    const disabled = toggleCompletion(enabled, september, 30, 'move', endOfSeptember);
    assert.deepEqual(disabled, original);
    assert.equal(Object.hasOwn(disabled.completions, '2026-09-30'), false);
  });

  it('preserves other completions on the same date and in other months', () => {
    const original = deepFreeze(stateWith({
      completions: { '2026-09-01': ['move', 'read'], '2026-10-01': ['move'] },
    }));
    const result = toggleCompletion(original, september, 1, 'move', endOfSeptember);
    assert.deepEqual(result.completions, { '2026-09-01': ['read'], '2026-10-01': ['move'] });
    assert.notEqual(result.completions['2026-09-01'], original.completions['2026-09-01']);
    assert.deepEqual(original.completions['2026-09-01'], ['move', 'read']);
  });

  it('rejects unavailable and future dates but works on an eligible boundary', () => {
    const original = deepFreeze(stateWith({
      startedOn: '2026-09-10',
      habitPlans: {
        '2026-09': [
          monthHabit('move', 'Move', '2026-09-10'),
          monthHabit('read', 'Read', '2026-09-20'),
        ],
      },
    }));
    const before = JSON.stringify(original);
    assert.throws(() => toggleCompletion(original, september, 9, 'move', endOfSeptember), UnavailableDateError);
    assert.throws(() => toggleCompletion(original, september, 19, 'read', endOfSeptember), UnavailableDateError);
    assert.throws(() => toggleCompletion(original, september, 10, 'missing', endOfSeptember), UnavailableDateError);
    assert.throws(
      () => toggleCompletion(original, september, 20, 'move', new Date(2026, 8, 19, 23, 59)),
      FutureDateError,
    );
    const eligible = toggleCompletion(original, september, 10, 'move', endOfSeptember);
    assert.deepEqual(eligible.completions['2026-09-10'], ['move']);
    assert.equal(JSON.stringify(original), before);
  });

  it('unlocks at local midnight and keeps today editable', () => {
    const beforeMidnight = new Date(2026, 8, 19, 23, 59, 59, 999);
    const midnight = new Date(2026, 8, 20, 0, 0, 0);
    const original = deepFreeze(stateWith());
    assert.throws(() => toggleCompletion(original, september, 20, 'move', beforeMidnight), FutureDateError);
    const enabled = toggleCompletion(original, september, 20, 'move', midnight);
    assert.deepEqual(enabled.completions['2026-09-20'], ['move']);
    assert.deepEqual(toggleCompletion(enabled, september, 20, 'move', midnight), original);
  });

  describe('future date availability', () => {
    it('compares local calendar days rather than time of day', () => {
      for (const hour of [0, 12, 23]) {
        const now = new Date(2026, 8, 19, hour, 59);
        assert.equal(isFutureDate(september, 18, now), false);
        assert.equal(isFutureDate(september, 19, now), false);
        assert.equal(isFutureDate(september, 20, now), true);
        assert.equal(isFutureDate(august, 31, now), false);
        assert.equal(isFutureDate(october, 1, now), true);
      }
    });

    it('handles year rollover and leap-day boundaries', () => {
      const december = { year: 2026, month: 11 };
      const january = { year: 2027, month: 0 };
      assert.equal(isFutureDate(january, 1, new Date(2026, 11, 31, 23, 59)), true);
      assert.equal(isFutureDate(january, 1, new Date(2027, 0, 1)), false);
      assert.equal(isFutureDate(december, 31, new Date(2027, 0, 1)), false);
      assert.equal(isFutureDate({ year: 2024, month: 1 }, 29, new Date(2024, 1, 28, 23, 59)), true);
      assert.equal(isFutureDate({ year: 2024, month: 1 }, 29, new Date(2024, 1, 29)), false);
    });

    it('uses the real current local date by default', () => {
      const now = new Date();
      const month = { year: now.getFullYear(), month: now.getMonth() };
      assert.equal(isFutureDate(month, now.getDate()), false);
      assert.equal(isFutureDate(shiftMonth(month, 1), 1), true);
      assert.equal(isFutureDate(shiftMonth(month, -1), 1), false);
    });

    it('validates dates and the current time instead of normalizing them', () => {
      assert.throws(() => isFutureDate(september, 31, endOfSeptember), /Day/);
      assert.throws(() => isFutureDate({ year: 2025, month: 1 }, 29, endOfSeptember), /Day/);
      assert.throws(() => isFutureDate(september, 1, new Date(NaN)), /valid Date/);
      assert.throws(() => toggleCompletion(stateWith(), september, 1, 'move', new Date(NaN)), /valid Date/);
      for (const day of [0, -1, 31, 1.5, NaN, Infinity]) {
        assert.throws(() => toggleCompletion(stateWith(), september, day, 'move'), /Day/);
      }
    });
  });
});

describe('stored V1 migration and strict V2 validation', () => {
  it('migrates exact V1 data to a sentinel plan and is idempotent as V2', () => {
    const legacy = {
      version: 1,
      title: 'Legacy routine',
      habits: [{ id: 'move', name: 'Move' }, { id: 'read', name: 'Read' }],
      completions: { '2026-09-01': ['move'], '2000-02-29': ['read'] },
      isDemo: false,
    };
    const migrated = parseStoredState(JSON.stringify(legacy));
    assert.deepEqual(migrated, {
      version: 2,
      title: 'Legacy routine',
      startedOn: '0000-01-01',
      habitPlans: {
        '0000-01': [
          { id: 'move', name: 'Move', startedOn: '0000-01-01' },
          { id: 'read', name: 'Read', startedOn: '0000-01-01' },
        ],
      },
      completions: legacy.completions,
      isDemo: false,
    });
    const reparsed = parseStoredState(JSON.stringify(migrated));
    assert.deepEqual(reparsed, migrated);
    assert.deepEqual(parseStoredState(JSON.stringify(reparsed)), reparsed);
  });

  it('round-trips exact V2 records, title boundaries, and empty completion arrays', () => {
    for (const title of ['', ' ', 'x'.repeat(60)]) {
      const state = stateWith({
        title,
        completions: { '2026-08-01': ['move', 'read'], '2026-09-01': [] },
      });
      const parsed = parseStoredState(JSON.stringify(state));
      assert.deepEqual(parsed, state);
      assert.notEqual(parsed, state);
      assert.notEqual(parsed.habitPlans, state.habitPlans);
    }
    const empty = stateWith({ title: '', habitPlans: { '2026-08': [] }, completions: {}, isDemo: true });
    assert.deepEqual(parseStoredState(JSON.stringify(empty)), empty);
  });

  it('throws an identifiable StorageValidationError for malformed JSON and roots', () => {
    for (const value of ['', '{', '{"version":2,}', 'undefined']) {
      assert.throws(() => parseStoredState(value), (error: unknown) => {
        assert.ok(error instanceof StorageValidationError);
        assert.equal(error.name, 'StorageValidationError');
        assert.match(error.message, /JSON/);
        return true;
      });
    }
    assert.throws(() => parseStoredState(1 as unknown as string), StorageValidationError);
    for (const value of [null, [], 1, true, 'state', {}]) rejectsStored(value);
  });

  it('requires the exact V2 top-level shape and valid scalar fields', () => {
    for (const field of ['version', 'title', 'startedOn', 'habitPlans', 'completions', 'isDemo']) {
      const record = structuredClone(stateWith()) as unknown as Record<string, unknown>;
      delete record[field];
      rejectsStored(record);
    }
    rejectsStored({ ...stateWith(), extra: true });
    for (const version of [0, 3, '2', null]) rejectsStored({ ...stateWith(), version });
    for (const title of [null, 12, [], 'x'.repeat(61)]) rejectsStored({ ...stateWith(), title });
    for (const isDemo of [0, 1, 'true', null]) rejectsStored({ ...stateWith(), isDemo });
    for (const startedOn of [null, '', '2026-02-29', '2026-8-01', '2026-08-32']) {
      rejectsStored({ ...stateWith(), startedOn });
    }
  });

  it('requires a real baseline plan and valid month change-point keys', () => {
    for (const habitPlans of [null, [], 'plans', 1, {}, { '2026-09': [] }]) {
      rejectsStored({ ...stateWith(), habitPlans });
    }
    for (const key of ['2026-00', '2026-13', '2026-8', '26-08', '2026-08-01', '2026-07']) {
      rejectsStored({
        ...stateWith(),
        habitPlans: { '2026-08': stateWith().habitPlans['2026-08'], [key]: [] },
      });
    }
  });

  it('strictly validates planned habit shapes, limits, names, and stable start dates', () => {
    const invalidPlans: unknown[] = [
      { '2026-08': {} },
      { '2026-08': [null] },
      { '2026-08': [{ id: 'move', name: 'Move' }] },
      { '2026-08': [{ id: 'move', name: 'Move', startedOn: '2026-08-01', extra: true }] },
      { '2026-08': [{ id: ' move ', name: 'Move', startedOn: '2026-08-01' }] },
      { '2026-08': [{ id: 'move', name: ' Move ', startedOn: '2026-08-01' }] },
      { '2026-08': [{ id: 'move', name: '', startedOn: '2026-08-01' }] },
      { '2026-08': [{ id: 'move', name: 'Move', startedOn: '2026-02-29' }] },
      { '2026-08': [{ id: 'move', name: 'Move', startedOn: '2026-09-01' }] },
      { '2026-08': Array.from({ length: 10 }, (_, index) =>
        monthHabit(`habit-${index}`, `Habit ${index}`)) },
      { '2026-08': [monthHabit('one', 'Read'), monthHabit('two', 'READ')] },
      { '2026-08': [monthHabit('same', 'Read'), monthHabit('same', 'Walk')] },
    ];
    for (const habitPlans of invalidPlans) rejectsStored({ ...stateWith(), habitPlans });

    rejectsStored({
      ...stateWith(),
      habitPlans: {
        '2026-08': [monthHabit('move', 'Move')],
        '2026-09': [monthHabit('move', 'Move', '2026-08-02')],
      },
    });
    rejectsStored({
      ...stateWith({ startedOn: '2026-08-10' }),
      habitPlans: { '2026-08': [monthHabit('move', 'Move', '2026-08-09')] },
    });
  });

  it('rejects invalid, duplicate, unknown, and unavailable completion IDs', () => {
    const state = stateWith({
      startedOn: '2026-08-10',
      habitPlans: {
        '2026-08': [
          monthHabit('move', 'Move', '2026-08-10'),
          monthHabit('read', 'Read', '2026-08-20'),
        ],
        '2026-09': [monthHabit('move', 'Move', '2026-08-10')],
      },
    });
    for (const ids of [null, {}, 'move', ['move', 'move'], [1], [null], [''], ['missing']]) {
      rejectsStored({ ...state, completions: { '2026-08-20': ids } });
    }
    rejectsStored({ ...state, completions: { '2026-08-09': ['move'] } });
    rejectsStored({ ...state, completions: { '2026-08-19': ['read'] } });
    rejectsStored({ ...state, completions: { '2026-09-01': ['read'] } });
    for (const key of [
      '2026-02-29', '1900-02-29', '2100-02-29', '2024-02-30', '2026-04-31',
      '2026-09-31', '2026-00-01', '2026-13-01', '2026-09-00', '2026-09-32',
      '2026-9-01', '2026-09-1', '26-09-01', '-001-01-01', '10000-01-01',
      '2026-09-01T00:00:00Z', '2026-09-01 ', '2026-09-01\n', 'constructor',
    ]) {
      rejectsStored({ ...state, completions: { [key]: ['move'] } });
    }
  });

  it('keeps V1 validation strict before migration', () => {
    const legacy = {
      version: 1,
      title: 'Legacy',
      habits: [{ id: 'move', name: 'Move' }],
      completions: { '2026-09-01': ['move'] },
      isDemo: false,
    };
    rejectsStored({ ...legacy, extra: true });
    rejectsStored({ ...legacy, habits: [{ id: 'move', name: ' Move ' }] });
    rejectsStored({ ...legacy, completions: { '2026-09-01': ['missing'] } });
    rejectsStored({ ...legacy, completions: { '2026-09-01': ['move', 'move'] } });
  });
});

describe('radial geometry', () => {
  it('places -90 degrees at the top and increases angles clockwise', () => {
    for (const [angle, x, y] of [[-90, 10, 15], [0, 15, 20], [90, 10, 25], [180, 5, 20], [270, 10, 15]]) {
      const point = polarPoint(10, 20, 5, angle);
      approximately(point.x, x);
      approximately(point.y, y);
    }
    const diagonal = polarPoint(0, 0, 10, 45);
    approximately(diagonal.x, Math.sqrt(50));
    approximately(diagonal.y, Math.sqrt(50));
    assert.deepEqual(polarPoint(10, 20, 0, 42), { x: 10, y: 20 });
  });

  for (const { month, sundayDays } of [
    { month: { year: 2026, month: 1 }, sundayDays: [1, 8, 15, 22] },
    { month: { year: 2024, month: 1 }, sundayDays: [4, 11, 18, 25] },
    { month: { year: 2026, month: 3 }, sundayDays: [5, 12, 19, 26] },
    { month: { year: 2026, month: 7 }, sundayDays: [2, 9, 16, 23, 30] },
    { month: { year: 2026, month: 4 }, sundayDays: [3, 10, 17, 24, 31] },
  ]) {
    const dayCount = daysInMonth(month);
    it(`lays out ${month.year}-${month.month + 1} with weekly gaps after its Sundays`, () => {
      const sectors = getDaySectors(month);
      assert.equal(sectors.length, dayCount);
      assert.deepEqual(sectors.map((sector) => sector.day), Array.from({ length: dayCount }, (_, index) => index + 1));
      assert.deepEqual(sectors.filter((sector) => sector.endsWeek).map((sector) => sector.day), sundayDays);
      assert.equal(sectors[0].startAngle, -90);
      assert.equal(sectors.at(-1)?.endAngle, 180);
      assert.equal(360 - (sectors[dayCount - 1].endAngle - sectors[0].startAngle), 90);
      const width = sectors[0].endAngle - sectors[0].startAngle;
      let totalWidth = 0;
      let totalGaps = 0;
      let weekBoundaries = 0;
      for (let index = 0; index < sectors.length; index += 1) {
        const sector = sectors[index];
        assert.ok(sector.startAngle >= -90 && sector.endAngle <= 180);
        assert.ok(sector.endAngle > sector.startAngle);
        approximately(sector.endAngle - sector.startAngle, width);
        approximately(sector.midAngle, (sector.startAngle + sector.endAngle) / 2);
        totalWidth += sector.endAngle - sector.startAngle;
        if (index < sectors.length - 1) {
          const next = sectors[index + 1];
          const isWeekBoundary = sundayDays.includes(sector.day);
          const gap = next.startAngle - sector.endAngle;
          approximately(gap, isWeekBoundary ? 3.2 : 0.6);
          if (isWeekBoundary) {
            weekBoundaries += 1;
            approximately((sector.endAngle + next.startAngle) / 2, sector.endAngle + 1.6);
          }
          totalGaps += gap;
        }
        const path = annularSectorPath(320, 320, 100, 130, sector.startAngle, sector.endAngle);
        assert.match(path, /^M [-\d. ]+ A [-\d. ]+ L [-\d. ]+ A [-\d. ]+ Z$/);
        assert.doesNotMatch(path, /NaN|Infinity/);
      }
      const internalSundays = sundayDays.filter((day) => day < dayCount).length;
      assert.equal(weekBoundaries, internalSundays);
      approximately(totalGaps, (dayCount - 1) * 0.6 + weekBoundaries * 2.6);
      approximately(totalWidth + totalGaps, 270);
    });
  }

  it('returns a closed annular wedge with opposite inner and outer sweeps', () => {
    assert.equal(
      annularSectorPath(100, 100, 20, 40, -90, 0),
      'M 100 60 A 40 40 0 0 1 140 100 L 120 100 A 20 20 0 0 0 100 80 Z',
    );
    assert.equal(
      annularSectorPath(0, 0, 5, 10, 0, 270),
      'M 10 0 A 10 10 0 1 1 0 -10 L 0 -5 A 5 5 0 1 0 5 0 Z',
    );
    assert.equal(
      annularSectorPath(100, 100, 20, 40, 0, -90),
      'M 140 100 A 40 40 0 0 0 100 60 L 100 80 A 20 20 0 0 1 120 100 Z',
    );
  });

  it('limits path precision to three decimals and normalizes negative zero', () => {
    const path = annularSectorPath(1.234567, -8.765432, 12.345678, 23.456789, -89.123456, 17.987654);
    const numbers = path.match(/-?\d+(?:\.\d+)?/g);
    assert.ok(numbers);
    assert.ok(numbers.every((value) => Number.isFinite(Number(value))));
    assert.ok(numbers.every((value) => (value.split('.')[1]?.length ?? 0) <= 3));
    assert.match(path, / Z$/);
    assert.doesNotMatch(annularSectorPath(0, 0, 5, 10, -90, 0), /(?:^| )-0(?: |$)/);
  });

  it('supports a zero inner radius and complete annuli', () => {
    assert.equal(annularSectorPath(0, 0, 0, 10, -90, 0), 'M 0 -10 A 10 10 0 0 1 10 0 L 0 0 Z');
    for (const end of [270, -450]) {
      const full = annularSectorPath(0, 0, 5, 10, -90, end);
      assert.equal(full.match(/\bA\b/g)?.length, 4);
      assert.equal(full.match(/\bM\b/g)?.length, 2);
      assert.equal(full.match(/\bZ\b/g)?.length, 2);
      assert.doesNotMatch(full, /\bL\b/);
    }
    const disk = annularSectorPath(0, 0, 0, 10, 0, 360);
    assert.equal(disk.match(/\bA\b/g)?.length, 2);
    assert.doesNotMatch(disk, /\bL\b|\bA 0\b/);
  });

  it('rejects invalid geometry instead of emitting invalid SVG', () => {
    assert.throws(() => polarPoint(0, 0, -1, 0), /radius/);
    assert.throws(() => polarPoint(0, 0, 1, NaN), /finite/);
    assert.throws(() => polarPoint(Infinity, 0, 1, 0), /finite/);
    assert.throws(() => polarPoint(Number.MAX_VALUE, 0, Number.MAX_VALUE, 0), /range/);
    for (const [inner, outer] of [[-1, 10], [10, 10], [11, 10], [0, 0]]) {
      assert.throws(() => annularSectorPath(0, 0, inner, outer, -90, 0), /radii/);
    }
    assert.throws(() => annularSectorPath(0, 0, 5, Infinity, -90, 0), /finite/);
    assert.throws(() => annularSectorPath(0, 0, 5, 10, 0, 0), /span/);
    assert.throws(() => annularSectorPath(0, 0, 5, 10, 0, 361), /span/);
    for (const month of [
      { year: 2026, month: -1 }, { year: 2026, month: 12 }, { year: -1, month: 0 }, null,
    ]) {
      assert.throws(() => getDaySectors(month as Month), /Month/);
    }
  });
});

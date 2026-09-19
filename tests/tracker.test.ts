import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_HABITS,
  MAX_HABIT_NAME_LENGTH,
  MAX_TITLE_LENGTH,
  STORAGE_KEY,
  FutureDateError,
  StorageValidationError,
  annularSectorPath,
  createInitialState,
  dateKey,
  daysInMonth,
  formatFullDate,
  getDaySectors,
  getMonthStats,
  isFutureDate,
  monthKey,
  parseStoredState,
  polarPoint,
  reconcileHabits,
  shiftMonth,
  toggleCompletion,
  type Habit,
  type Month,
  type TrackerState,
} from '../src/lib/tracker.ts';

const september: Month = { year: 2026, month: 8 };
const endOfSeptember = new Date(2026, 8, 30, 12);

function stateWith(overrides: Partial<TrackerState> = {}): TrackerState {
  return {
    version: 1,
    title: 'My routine',
    habits: [{ id: 'move', name: 'Move' }, { id: 'read', name: 'Read' }],
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

  it('shifts in either direction across month and year boundaries without mutation', () => {
    const month = deepFreeze({ year: 2026, month: 11 });
    assert.deepEqual(shiftMonth(month, 1), { year: 2027, month: 0 });
    assert.deepEqual(shiftMonth({ year: 2026, month: 0 }, -1), { year: 2025, month: 11 });
    assert.deepEqual(shiftMonth(month, 26), { year: 2029, month: 1 });
    assert.deepEqual(shiftMonth(month, -25), { year: 2024, month: 10 });
    assert.deepEqual(shiftMonth(month, 0), month);
    assert.notEqual(shiftMonth(month, 0), month);
    assert.deepEqual(month, { year: 2026, month: 11 });
  });

  it('formats zero-based months and four-digit years without the Date year-1900 offset', () => {
    assert.equal(monthKey(september), '2026-09');
    assert.equal(monthKey({ year: 9, month: 0 }), '0009-01');
    assert.equal(dateKey({ year: 0, month: 1 }, 29), '0000-02-29');
    assert.equal(dateKey({ year: 99, month: 11 }, 31), '0099-12-31');
    assert.deepEqual(shiftMonth({ year: 99, month: 11 }, 1), { year: 100, month: 0 });
  });

  it('formats English full dates independently of the local timezone', () => {
    assert.equal(formatFullDate({ year: 2020, month: 1 }, 29), 'Saturday, February 29, 2020');
    assert.equal(formatFullDate(september, 1), 'Tuesday, September 1, 2026');
  });

  it('rejects invalid months, years, days, and shifts instead of normalizing them', () => {
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

describe('initial demo state', () => {
  it('uses the exact title and ordered starter habits with stable IDs', () => {
    const state = createInitialState(new Date(2026, 8, 19, 12));
    assert.equal(state.version, 1);
    assert.equal(state.title, 'No Excuses Grind');
    assert.equal(state.isDemo, true);
    assert.deepEqual(state.habits.map((habit) => habit.name), [
      'Move your body', 'Read 10 pages', 'Drink more water',
      'Deep work', 'Quiet your mind', 'Sleep 8 hours',
    ]);
    assert.equal(new Set(state.habits.map((habit) => habit.id)).size, 6);
    assert.deepEqual(state.habits, createInitialState(new Date(2027, 0, 1)).habits);
  });

  it('is deterministic, does not mutate now, and returns independent state objects', () => {
    const now = new Date(2026, 8, 19, 12);
    const timestamp = now.getTime();
    const first = createInitialState(now);
    const second = createInitialState(new Date(2026, 8, 19, 23, 59));
    assert.deepEqual(first, second);
    assert.equal(now.getTime(), timestamp);
    assert.notEqual(first, second);
    assert.notEqual(first.habits, second.habits);
    assert.notEqual(first.habits[0], second.habits[0]);
    assert.notEqual(first.completions, second.completions);
    for (const key of Object.keys(first.completions)) {
      assert.notEqual(first.completions[key], second.completions[key]);
    }
    first.habits[0].name = 'Changed';
    assert.equal(createInitialState(now).habits[0].name, 'Move your body');
  });

  for (const [year, month, day] of [[2026, 8, 19], [2024, 1, 29], [2026, 3, 30], [2026, 0, 31]]) {
    it(`seeds valid, roughly 80% progress only through ${year}-${month + 1}-${day}`, () => {
      const state = createInitialState(new Date(year, month, day, 12));
      const known = new Set(state.habits.map((habit) => habit.id));
      let completed = 0;
      for (const [key, ids] of Object.entries(state.completions)) {
        assert.ok(key.startsWith(`${monthKey({ year, month })}-`));
        const sampleDay = Number(key.slice(-2));
        assert.ok(sampleDay >= 1 && sampleDay <= day);
        assert.equal(key, dateKey({ year, month }, sampleDay));
        assert.ok(ids.length > 0);
        assert.equal(new Set(ids).size, ids.length);
        assert.ok(ids.every((id) => known.has(id)));
        completed += ids.length;
      }
      const proportion = completed / (day * state.habits.length);
      assert.ok(proportion >= 0.7 && proportion <= 0.9, `Unexpected demo proportion: ${proportion}`);
      assert.deepEqual(parseStoredState(JSON.stringify(state)), state);
    });
  }

  it('keeps earlier days stable and seeds no later dates on the first day of a new month', () => {
    const earlier = createInitialState(new Date(2026, 8, 10, 12));
    const later = createInitialState(new Date(2026, 8, 19, 12));
    for (let day = 1; day <= 10; day += 1) {
      const key = dateKey(september, day);
      assert.deepEqual(earlier.completions[key], later.completions[key]);
    }
    const firstDay = createInitialState(new Date(2027, 0, 1, 0, 1));
    assert.deepEqual(Object.keys(firstDay.completions), ['2027-01-01']);
  });

  it('rejects an invalid current date', () => {
    assert.throws(() => createInitialState(new Date(NaN)), /valid Date/);
    assert.throws(() => createInitialState('2026-09-01' as unknown as Date), /valid Date/);
  });
});

describe('month statistics', () => {
  it('uses every displayed day, including future locked dates, in the denominator', () => {
    const state = deepFreeze(stateWith({
      completions: { '2026-09-01': ['move'], '2026-09-30': ['read'], '2026-10-01': ['move', 'read'] },
    }));
    assert.deepEqual(getMonthStats(state, september), { completed: 2, total: 60, percentage: 3 });
    assert.deepEqual(getMonthStats(state, { year: 2026, month: 9 }), {
      completed: 2, total: 62, percentage: 3,
    });
  });

  it('uses leap February and rounds percentages to the nearest whole number', () => {
    const state = stateWith({
      habits: [{ id: 'move', name: 'Move' }],
      completions: { '2024-02-29': ['move'], '2023-02-01': ['move'] },
    });
    assert.deepEqual(getMonthStats(state, { year: 2024, month: 1 }), {
      completed: 1, total: 29, percentage: 3,
    });
    assert.deepEqual(getMonthStats(state, { year: 2023, month: 1 }), {
      completed: 1, total: 28, percentage: 4,
    });
  });

  it('ignores unknown, stale, and duplicate IDs as well as invalid or out-of-month date keys', () => {
    const state = deepFreeze(stateWith({
      completions: {
        '2026-09-01': ['move', 'move', 'deleted', 'read', 'read'],
        '2026-09-02': ['read', 'deleted'],
        '2026-09-31': ['move', 'read'],
        '2026-09-00': ['move', 'read'],
        '2026-09-1': ['move', 'read'],
        '2025-09-01': ['move', 'read'],
      },
    }));
    assert.deepEqual(getMonthStats(state, september), { completed: 3, total: 60, percentage: 5 });
  });

  it('returns all zeroes for zero habits, even with stale completion records', () => {
    assert.deepEqual(getMonthStats(stateWith({
      habits: [], completions: { '2026-09-01': ['move'] },
    }), september), { completed: 0, total: 0, percentage: 0 });
  });

  it('handles both an empty and a completely filled month', () => {
    const state = stateWith();
    assert.deepEqual(getMonthStats(state, september), { completed: 0, total: 60, percentage: 0 });
    for (let day = 1; day <= 30; day += 1) {
      state.completions[dateKey(september, day)] = ['move', 'read'];
    }
    assert.deepEqual(getMonthStats(state, september), { completed: 60, total: 60, percentage: 100 });
  });
});

describe('completion toggling', () => {
  for (const isDemo of [false, true]) {
    it(`toggles on and off immutably while preserving isDemo=${isDemo}`, () => {
      const original = deepFreeze(stateWith({
        isDemo, completions: { '2026-08-31': ['read'] },
      }));
      const enabled = toggleCompletion(original, september, 30, 'move', endOfSeptember);
      assert.notEqual(enabled, original);
      assert.notEqual(enabled.completions, original.completions);
      assert.equal(enabled.habits, original.habits);
      assert.equal(enabled.completions['2026-08-31'], original.completions['2026-08-31']);
      assert.deepEqual(enabled.completions['2026-09-30'], ['move']);
      assert.equal(enabled.isDemo, isDemo);
      assert.equal(original.completions['2026-09-30'], undefined);

      deepFreeze(enabled);
      const disabled = toggleCompletion(enabled, september, 30, 'move', endOfSeptember);
      assert.deepEqual(disabled, original);
      assert.equal(Object.hasOwn(disabled.completions, '2026-09-30'), false);
      assert.deepEqual(enabled.completions['2026-09-30'], ['move']);
    });
  }

  it('preserves other completions on the same day and across months', () => {
    const original = deepFreeze(stateWith({
      completions: { '2026-09-01': ['move', 'read'], '2026-10-01': ['move'] },
    }));
    const result = toggleCompletion(original, september, 1, 'move', endOfSeptember);
    assert.deepEqual(result.completions, { '2026-09-01': ['read'], '2026-10-01': ['move'] });
    assert.notEqual(result.completions['2026-09-01'], original.completions['2026-09-01']);
    assert.deepEqual(original.completions['2026-09-01'], ['move', 'read']);
  });

  it('removes duplicate copies when switching a habit off', () => {
    const result = toggleCompletion(stateWith({
      completions: { '2026-09-01': ['move', 'move'] },
    }), september, 1, 'move', endOfSeptember);
    assert.deepEqual(result.completions, {});
  });

  it('accepts past leap days but rejects future dates without mutating state', () => {
    const leap = deepFreeze(toggleCompletion(stateWith(), { year: 2024, month: 1 }, 29, 'move', endOfSeptember));
    assert.deepEqual(leap.completions, { '2024-02-29': ['move'] });
    assert.throws(() => toggleCompletion(leap, { year: 2099, month: 11 }, 31, 'read', endOfSeptember), FutureDateError);
    assert.deepEqual(leap.completions, { '2024-02-29': ['move'] });
  });

  it('rejects both new and previously stored future check-ins', () => {
    const now = new Date(2026, 8, 19, 23, 59, 59);
    for (const completions of [{}, { '2026-09-20': ['move'] }]) {
      const state = deepFreeze(stateWith({ completions }));
      const before = JSON.stringify(state);
      assert.throws(() => toggleCompletion(state, september, 20, 'move', now), FutureDateError);
      assert.throws(() => toggleCompletion(state, { year: 2026, month: 9 }, 1, 'move', now), FutureDateError);
      assert.equal(JSON.stringify(state), before);
    }
  });

  it('unlocks at local midnight and keeps today and past days editable', () => {
    const beforeMidnight = new Date(2026, 8, 19, 23, 59, 59, 999);
    const midnight = new Date(2026, 8, 20, 0, 0, 0);
    const original = deepFreeze(stateWith());
    assert.throws(() => toggleCompletion(original, september, 20, 'move', beforeMidnight), FutureDateError);
    const enabled = toggleCompletion(original, september, 20, 'move', midnight);
    assert.deepEqual(enabled.completions['2026-09-20'], ['move']);
    const undone = toggleCompletion(enabled, september, 20, 'move', midnight);
    assert.deepEqual(undone, original);
    const past = toggleCompletion(undone, { year: 2025, month: 11 }, 31, 'move', midnight);
    assert.deepEqual(past.completions['2025-12-31'], ['move']);
  });

  describe('future date availability', () => {
    it('compares local calendar days rather than time of day', () => {
      for (const hour of [0, 12, 23]) {
        const now = new Date(2026, 8, 19, hour, 59);
        assert.equal(isFutureDate(september, 18, now), false);
        assert.equal(isFutureDate(september, 19, now), false);
        assert.equal(isFutureDate(september, 20, now), true);
        assert.equal(isFutureDate({ year: 2026, month: 7 }, 31, now), false);
        assert.equal(isFutureDate({ year: 2026, month: 9 }, 1, now), true);
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
      assert.throws(() => toggleCompletion(stateWith(), shiftMonth(month, 1), 1, 'move'), FutureDateError);
    });

    it('validates dates instead of silently allowing invalid input', () => {
      assert.throws(() => isFutureDate(september, 31, endOfSeptember), /Day/);
      assert.throws(() => isFutureDate({ year: 2025, month: 1 }, 29, endOfSeptember), /Day/);
      assert.throws(() => isFutureDate(september, 1, new Date(NaN)), /valid Date/);
      assert.throws(() => toggleCompletion(stateWith(), september, 1, 'move', new Date(NaN)), /valid Date/);
    });
  });

  it('rejects unknown habits and invalid dates without changing state', () => {
    const original = deepFreeze(stateWith());
    for (const day of [0, -1, 31, 1.5, NaN, Infinity]) {
      assert.throws(() => toggleCompletion(original, september, day, 'move'), /Day/);
    }
    assert.throws(() => toggleCompletion(original, { year: 2025, month: 1 }, 29, 'move'), /Day/);
    assert.throws(() => toggleCompletion(original, { year: 2026, month: 12 }, 1, 'move'), /Month/);
    assert.throws(() => toggleCompletion(original, september, 1, 'missing'), /unknown habit ID/);
    assert.throws(() => toggleCompletion(original, september, 1, ''), /unknown habit ID/);
    assert.throws(() => toggleCompletion(stateWith({ habits: [] }), september, 1, 'move'), /unknown/);
    assert.deepEqual(original, stateWith());
  });
});

describe('habit reconciliation', () => {
  it('trims, renames, and reorders habits while retaining their completion IDs', () => {
    const original = deepFreeze(stateWith({
      isDemo: true,
      completions: { '2026-09-01': ['move', 'read'], '2025-12-31': ['read'] },
    }));
    const habits = deepFreeze([
      { id: 'read', name: '  Read a book  ' },
      { id: 'move', name: 'Walk' },
      { id: 'sleep', name: 'Sleep' },
    ]);
    const result = reconcileHabits(original, habits);
    assert.deepEqual(result.habits, [
      { id: 'read', name: 'Read a book' }, { id: 'move', name: 'Walk' }, { id: 'sleep', name: 'Sleep' },
    ]);
    assert.deepEqual(result.completions, original.completions);
    assert.equal(result.isDemo, true);
    assert.equal(result.title, original.title);
    assert.notEqual(result, original);
    assert.notEqual(result.habits, habits);
    assert.notEqual(result.habits[0], habits[0]);
    assert.notEqual(result.completions, original.completions);
    assert.notEqual(result.completions['2026-09-01'], original.completions['2026-09-01']);
    assert.equal(habits[0].name, '  Read a book  ');
  });

  it('scrubs deleted, stale, and duplicate IDs from every month and removes empty dates', () => {
    const original = deepFreeze(stateWith({
      completions: {
        '2025-12-31': ['read'],
        '2026-01-01': ['read', 'move', 'move'],
        '2026-09-02': ['move', 'read', 'stale'],
        '2026-10-01': [],
      },
    }));
    const result = reconcileHabits(original, [{ id: 'move', name: 'Move' }]);
    assert.deepEqual(result.completions, { '2026-01-01': ['move'], '2026-09-02': ['move'] });
    assert.deepEqual(original.completions['2025-12-31'], ['read']);
    assert.equal(result.isDemo, false);
  });

  it('allows zero habits and clears every completion key', () => {
    const original = deepFreeze(stateWith({
      completions: { '2025-01-01': ['move'], '2026-09-01': ['move', 'read'] },
    }));
    const result = reconcileHabits(original, []);
    assert.deepEqual(result.habits, []);
    assert.deepEqual(result.completions, {});
    assert.deepEqual(getMonthStats(result, september), { completed: 0, total: 0, percentage: 0 });
    assert.deepEqual(parseStoredState(JSON.stringify(result)), result);
  });

  it('accepts nine distinct habits and trims names before checking their 32-character limit', () => {
    const habits = Array.from({ length: 9 }, (_, index) => ({
      id: `habit-${index}`, name: index === 0 ? `  ${'a'.repeat(32)}  ` : `Habit ${index}`,
    }));
    const result = reconcileHabits(stateWith(), habits);
    assert.equal(result.habits.length, 9);
    assert.equal(result.habits[0].name.length, 32);
    assert.deepEqual(parseStoredState(JSON.stringify(result)), result);
  });

  const invalidHabits: Array<[string, unknown]> = [
    ['non-array habits', {}],
    ['more than nine habits', Array.from({ length: 10 }, (_, index) => ({ id: `${index}`, name: `Habit ${index}` }))],
    ['empty names', [{ id: 'one', name: '' }]],
    ['whitespace-only names', [{ id: 'one', name: ' \n\t ' }]],
    ['overlong names', [{ id: 'one', name: 'a'.repeat(33) }]],
    ['case-insensitive duplicate names', [{ id: 'one', name: 'Read' }, { id: 'two', name: 'READ' }]],
    ['duplicate IDs', [{ id: 'same', name: 'Read' }, { id: 'same', name: 'Walk' }]],
    ['empty IDs', [{ id: '', name: 'Read' }]],
    ['untrimmed IDs', [{ id: ' id ', name: 'Read' }]],
    ['non-string IDs', [{ id: 12, name: 'Read' }]],
    ['non-string names', [{ id: 'one', name: 12 }]],
    ['missing habit fields', [{ id: 'one' }]],
    ['unknown habit fields', [{ id: 'one', name: 'Read', extra: true }]],
    ['null habits', [null]],
    ['sparse habits', new Array(1)],
  ];
  for (const [label, habits] of invalidHabits) {
    it(`rejects ${label} in both reconciliation and storage`, () => {
      assert.throws(() => reconcileHabits(stateWith(), habits as Habit[]), Error);
      rejectsStored({ ...stateWith(), habits });
    });
  }

  it('detects duplicates after trimming names', () => {
    assert.throws(() => reconcileHabits(stateWith(), [
      { id: 'one', name: ' Read ' }, { id: 'two', name: 'read' },
    ]), /distinct, ignoring case/);
  });
});

describe('strict storage validation', () => {
  it('round-trips valid records, empty titles, maximum-length titles, and empty completion arrays', () => {
    for (const title of ['', ' ', 'x'.repeat(60)]) {
      const state = stateWith({
        title,
        completions: {
          '2000-02-29': ['move', 'read'], '2024-02-29': ['read'],
          '0000-02-29': ['move'], '2026-09-01': [],
        },
      });
      assert.deepEqual(parseStoredState(JSON.stringify(state)), state);
    }
    const empty = stateWith({ title: '', habits: [], completions: {}, isDemo: true });
    assert.deepEqual(parseStoredState(JSON.stringify(empty)), empty);
  });

  it('throws an identifiable StorageValidationError for malformed JSON', () => {
    for (const value of ['', '{', '{"version":1,}', 'undefined']) {
      assert.throws(() => parseStoredState(value), (error: unknown) => {
        assert.ok(error instanceof StorageValidationError);
        assert.ok(error instanceof Error);
        assert.equal(error.name, 'StorageValidationError');
        assert.match(error.message, /JSON/);
        return true;
      });
    }
    assert.throws(() => parseStoredState(1 as unknown as string), StorageValidationError);
  });

  it('rejects primitive, array, null, missing-field, and extra-field records', () => {
    for (const value of [null, [], 1, true, 'state', {}]) rejectsStored(value);
    for (const field of ['version', 'title', 'habits', 'completions', 'isDemo']) {
      const record: Record<string, unknown> = { ...stateWith() };
      delete record[field];
      rejectsStored(record);
    }
    rejectsStored({ ...stateWith(), extra: true });
  });

  it('rejects wrong versions, title types or lengths, and non-boolean demo flags', () => {
    for (const version of [0, 2, '1', null]) rejectsStored({ ...stateWith(), version });
    for (const title of [null, 12, [], 'x'.repeat(61)]) rejectsStored({ ...stateWith(), title });
    for (const isDemo of [0, 1, 'true', null]) rejectsStored({ ...stateWith(), isDemo });
  });

  it('requires stored names to already be trimmed rather than silently repairing data', () => {
    rejectsStored({ ...stateWith(), habits: [{ id: 'move', name: ' Move ' }] });
  });

  it('rejects non-record completions', () => {
    for (const completions of [null, [], 'complete', 1]) {
      rejectsStored({ ...stateWith(), completions });
    }
  });

  for (const key of [
    '2026-02-29', '1900-02-29', '2100-02-29', '2024-02-30', '2026-04-31',
    '2026-09-31', '2026-00-01', '2026-13-01', '2026-09-00', '2026-09-32',
    '2026-9-01', '2026-09-1', '26-09-01', '-001-01-01', '10000-01-01',
    '2026-09-01T00:00:00Z', '2026-09-01 ', '2026-09-01\n', '2026-09-01\r',
    '2026-09-01\u2028', '__proto__', 'constructor',
  ]) {
    it(`rejects the non-calendar or non-ISO date key "${key}"`, () => {
      rejectsStored({ ...stateWith(), completions: { [key]: ['move'] } });
    });
  }

  it('rejects non-array, unknown, duplicate, and non-string completion IDs', () => {
    for (const ids of [null, {}, 'move', ['missing'], ['move', 'move'], [1], [null], ['']]) {
      rejectsStored({ ...stateWith(), completions: { '2026-09-01': ids } });
    }
    rejectsStored({ ...stateWith(), habits: [], completions: { '2026-09-01': ['move'] } });
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
      assert.deepEqual(sectors.map((sector) => sector.day), Array.from({ length: dayCount }, (_, i) => i + 1));
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

  it('returns an explicitly closed annular wedge with opposite inner and outer sweeps', () => {
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

  it('supports a zero inner radius and complete annuli without degenerate circular arcs', () => {
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

  it('rejects invalid geometry rather than emitting invalid SVG', () => {
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
      { year: 2026, month: -1 },
      { year: 2026, month: 12 },
      { year: -1, month: 0 },
      null,
    ]) {
      assert.throws(() => getDaySectors(month as Month), /Month/);
    }
  });
});

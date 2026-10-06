import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  getDayTasks,
  TASK_WAVE_STAGGER,
  taskDateDirection,
  taskDateFor,
  taskDateKey,
  taskDayLabel,
  taskMonthLabel,
  taskSummary,
  taskWaveDelay,
} from '../src/lib/dayTasks.ts'
import type { TaskDate } from '../src/lib/dayTasks.ts'
import type { MonthHabit, TrackerState } from '../src/lib/tracker.ts'

const october = { year: 2026, month: 9 }
const september = { year: 2026, month: 8 }
// Monday, October 5 2026, around noon on this device.
const now = new Date(2026, 9, 5, 12)

function on(day: number, month = october): TaskDate {
  return { month, day }
}

function monthHabit(id: string, name: string, startedOn = '2026-09-01'): MonthHabit {
  return { id, name, startedOn }
}

function stateWith(overrides: Partial<TrackerState> = {}): TrackerState {
  return {
    version: 2,
    title: 'My routine',
    startedOn: '2026-09-01',
    habitPlans: {
      '2026-09': [monthHabit('move', 'Move'), monthHabit('read', 'Read')],
      '2026-10': [
        monthHabit('move', 'Move'),
        monthHabit('read', 'Read'),
        monthHabit('water', 'Drink water', '2026-10-03'),
      ],
    },
    completions: {
      '2026-09-30': ['read'],
      '2026-10-02': ['move'],
      '2026-10-05': ['read', 'water'],
    },
    reminders: ['No excuses, just do it.'],
    isDemo: false,
    ...overrides,
  }
}

describe('tasks for a single day', () => {
  it('lists every habit planned for the month with that day’s check-ins', () => {
    const today = getDayTasks(stateWith(), on(5), now)
    assert.equal(today.key, '2026-10-05')
    assert.equal(today.isToday, true)
    assert.equal(today.future, false)
    assert.deepEqual(today.tasks.map(({ habit, done, available }) => [habit.id, done, available]), [
      ['move', false, true],
      ['read', true, true],
      ['water', true, true],
    ])
    assert.equal(today.completed, 2)
    assert.equal(today.total, 3)
  })

  it('keeps habits that had not started yet in the list, but out of the count', () => {
    const earlier = getDayTasks(stateWith(), on(2), now)
    assert.deepEqual(earlier.tasks.map(({ habit, available }) => [habit.id, available]), [
      ['move', true],
      ['read', true],
      ['water', false],
    ])
    assert.equal(earlier.completed, 1)
    assert.equal(earlier.total, 2)
    assert.equal(earlier.isToday, false)
    assert.equal(earlier.future, false)
  })

  it('uses the plan of the day’s own month', () => {
    const lastMonth = getDayTasks(stateWith(), on(30, september), now)
    assert.deepEqual(lastMonth.tasks.map(({ habit, done }) => [habit.id, done]), [['move', false], ['read', true]])
  })

  it('marks future days and days before the tracker began', () => {
    const later = getDayTasks(stateWith(), on(12), now)
    assert.equal(later.future, true)
    assert.equal(later.completed, 0)
    assert.equal(later.total, 3)

    const beforeStart = getDayTasks(stateWith({ startedOn: '2026-10-04' }), on(3), now)
    assert.equal(beforeStart.total, 0)
    assert.ok(beforeStart.tasks.every((task) => !task.available && !task.done))

    const unplanned = getDayTasks(stateWith(), on(10, { year: 2026, month: 7 }), now)
    assert.deepEqual(unplanned.tasks, [])
  })

  it('rejects dates that do not exist', () => {
    assert.throws(() => getDayTasks(stateWith(), on(31, september), now), /Day must be/)
    assert.throws(() => getDayTasks(stateWith(), on(0), now), /Day must be/)
    assert.throws(() => getDayTasks(stateWith(), on(5), new Date(Number.NaN)), /valid Date/)
  })
})

describe('moving the list between days', () => {
  it('starts from the local calendar day', () => {
    assert.deepEqual(taskDateFor(now), on(5))
    assert.equal(taskDateKey(taskDateFor(new Date(2026, 0, 31, 23, 59))), '2026-01-31')
    assert.throws(() => taskDateFor(new Date(Number.NaN)), /valid Date/)
  })

  it('knows which way in time the list is moving, across months too', () => {
    assert.equal(taskDateDirection(on(5), on(12)), 1)
    assert.equal(taskDateDirection(on(12), on(5)), -1)
    assert.equal(taskDateDirection(on(5), on(5)), 0)
    assert.equal(taskDateDirection(on(1), on(30, september)), -1)
    assert.equal(taskDateDirection(on(30, september), on(1)), 1)
  })

  it('runs the wave down the list going forward and up it going back', () => {
    assert.deepEqual([0, 1, 2, 3].map((index) => taskWaveDelay(index, 4, 1)), [0, 1, 2, 3].map((step) => step * TASK_WAVE_STAGGER))
    assert.deepEqual([0, 1, 2, 3].map((index) => taskWaveDelay(index, 4, -1)), [3, 2, 1, 0].map((step) => step * TASK_WAVE_STAGGER))
    assert.equal(taskWaveDelay(2, 4, 0), 2 * TASK_WAVE_STAGGER)
    for (const [index, count] of [[-1, 4], [4, 4], [0.5, 4], [0, 0]]) {
      assert.throws(() => taskWaveDelay(index, count, 1), /row index/)
    }
  })
})

describe('words for a day of tasks', () => {
  it('names the weekday and how it relates to today', () => {
    assert.equal(taskDayLabel(on(5), now), 'MONDAY · TODAY')
    assert.equal(taskDayLabel(on(4), now), 'SUNDAY · YESTERDAY')
    assert.equal(taskDayLabel(on(1), now), 'THURSDAY')
    assert.equal(taskDayLabel(on(6), now), 'TUESDAY · NOT YET')
    assert.equal(taskDayLabel(on(30, september), new Date(2026, 9, 1, 0, 5)), 'WEDNESDAY · YESTERDAY')
    assert.equal(taskMonthLabel(on(5)), 'Oct')
    assert.equal(taskMonthLabel(on(30, september)), 'Sep')
  })

  it('sums the day up in a few words', () => {
    assert.equal(taskSummary(getDayTasks(stateWith(), on(5), now)), '2 of 3 kept')
    assert.equal(taskSummary(getDayTasks(stateWith(), on(12), now)), 'Locked until the day comes')
    assert.equal(taskSummary(getDayTasks(stateWith({ startedOn: '2026-10-04' }), on(3), now)), 'Before this routine began')
    assert.equal(taskSummary(getDayTasks(stateWith(), on(10, { year: 2026, month: 7 }), now)), 'No rituals planned')
  })
})

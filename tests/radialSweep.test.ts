import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  habitLabelProgress,
  PANEL_EXIT_DURATION,
  SWEEP_IN_DURATION,
  SWEEP_OUT_DURATION,
  SWEEP_STAGGER,
  sweepProgress,
  TEXT_SWEEP,
} from '../src/lib/radialSweep.ts'
import { getDaySectors } from '../src/lib/tracker.ts'

describe('radial sweep choreography', () => {
  it('measures one clockwise revolution from the top of the wheel', () => {
    assert.equal(sweepProgress(-90), 0)
    assert.equal(sweepProgress(0), 0.25)
    assert.equal(sweepProgress(90), 0.5)
    assert.equal(sweepProgress(180), 0.75)
    assert.equal(sweepProgress(270), 0)
    assert.equal(sweepProgress(-91), 359 / 360)
    assert.equal(sweepProgress(450), 0.5)
    for (const invalid of [NaN, Infinity, -Infinity]) {
      assert.throws(() => sweepProgress(invalid), /angle/)
    }
  })

  it('keeps every day cell inside the first three quarters of the sweep, in day order', () => {
    const sectors = getDaySectors({ year: 2026, month: 8 })
    const progress = sectors.map((sector) => sweepProgress(sector.midAngle))
    assert.ok(progress[0] < 0.02)
    for (let index = 1; index < progress.length; index += 1) {
      assert.ok(progress[index] > progress[index - 1])
    }
    assert.ok(progress[progress.length - 1] <= 0.75)
  })

  it('sweeps the page copy top, then right, then bottom, then left', () => {
    assert.equal(TEXT_SWEEP.heroHeading, 0)
    assert.ok(TEXT_SWEEP.heroHeading < TEXT_SWEEP.dayNote)
    assert.ok(TEXT_SWEEP.dayNote < TEXT_SWEEP.flashTrigger)
    assert.ok(TEXT_SWEEP.flashTrigger < TEXT_SWEEP.footerSignoff)
    assert.ok(TEXT_SWEEP.footerSignoff < TEXT_SWEEP.monthNavigation)
    assert.ok(TEXT_SWEEP.monthNavigation < TEXT_SWEEP.footerGuide)
    assert.ok(TEXT_SWEEP.footerGuide < TEXT_SWEEP.intentionNote)
    assert.ok(TEXT_SWEEP.intentionNote < TEXT_SWEEP.consistencyScore)
    assert.ok(TEXT_SWEEP.consistencyScore < TEXT_SWEEP.ritualsHeading)
    for (const value of Object.values(TEXT_SWEEP)) {
      assert.ok(value >= 0 && value < 1)
    }
  })

  it('climbs the habit labels bottom to top after the last day cell', () => {
    for (const count of [1, 2, 5, 9]) {
      let previous = 1
      for (let index = 0; index < count; index += 1) {
        const progress = habitLabelProgress(index, count)
        assert.ok(progress > 0.75 && progress < TEXT_SWEEP.ritualsHeading)
        if (count > 1) assert.ok(index === 0 || progress < previous)
        previous = progress
      }
    }
    for (const [index, count] of [[-1, 5], [5, 5], [0.5, 5], [0, 0], [0, 1.5]]) {
      assert.throws(() => habitLabelProgress(index, count), /habit count/i)
    }
  })

  it('gives every staggered element time to finish animating', () => {
    assert.equal(SWEEP_STAGGER, 880)
    assert.ok(SWEEP_OUT_DURATION >= SWEEP_STAGGER + 260)
    assert.ok(SWEEP_IN_DURATION >= SWEEP_STAGGER + 320)
    assert.ok(PANEL_EXIT_DURATION > 0 && PANEL_EXIT_DURATION < SWEEP_OUT_DURATION)
  })
})

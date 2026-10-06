import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BOX_PATH,
  CHECKBOX_MORPH_DURATION,
  checkboxMorphEase,
  checkboxMorphPath,
  checkboxMorphPoints,
  checkboxMorphProgress,
  TICK_PATH,
} from '../src/lib/checkboxMorph.ts'

function coordinates(path: string): number[] {
  return [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map(([number]) => Number(number))
}

describe('checkbox to tick morph', () => {
  it('starts as a closed square and ends as a two-stroke tick', () => {
    assert.equal(checkboxMorphPath(0), BOX_PATH)
    assert.equal(checkboxMorphPath(1), TICK_PATH)
    assert.deepEqual(coordinates(BOX_PATH), [3.5, 3.5, 3.5, 16.5, 16.5, 16.5, 16.5, 3.5, 3.5, 3.5])
    const [startX, startY, elbowX, elbowY, foldedX, foldedY, tipX, tipY, endX, endY] = coordinates(TICK_PATH)
    // The bottom of the box shrinks into the elbow and the top into the tip.
    assert.deepEqual([foldedX, foldedY], [elbowX, elbowY])
    assert.deepEqual([endX, endY], [tipX, tipY])
    // A short stroke down to the elbow, then a longer one up to the tip.
    assert.ok(startX < elbowX && startY < elbowY)
    assert.ok(tipX > elbowX && tipY < elbowY)
    assert.ok(Math.hypot(tipX - elbowX, tipY - elbowY) > Math.hypot(elbowX - startX, elbowY - startY) * 1.5)
  })

  it('moves every vertex continuously instead of swapping icons', () => {
    const start = coordinates(BOX_PATH)
    const end = coordinates(TICK_PATH)
    for (const progress of [0.01, 0.25, 0.5, 0.75, 0.99]) {
      const path = checkboxMorphPath(progress)
      assert.equal(path.match(/M/g)?.length, 1)
      assert.equal(path.match(/L/g)?.length, 4)
      assert.doesNotMatch(path, /Z/)
      assert.notEqual(path, BOX_PATH)
      assert.notEqual(path, TICK_PATH)
      coordinates(path).forEach((coordinate, index) => {
        assert.ok(Math.abs(coordinate - (start[index] + (end[index] - start[index]) * progress)) <= 0.00051)
      })
    }
    assert.equal(checkboxMorphPoints(0.5).length, 5)
  })

  it('eases in and out and settles exactly on either end', () => {
    assert.equal(checkboxMorphEase(0), 0)
    assert.equal(checkboxMorphEase(0.5), 0.5)
    assert.equal(checkboxMorphEase(1), 1)
    assert.ok(checkboxMorphEase(0.1) < 0.1)
    assert.ok(checkboxMorphEase(0.9) > 0.9)
    assert.equal(checkboxMorphEase(-1), 0)
    assert.equal(checkboxMorphEase(2), 1)

    assert.equal(checkboxMorphProgress(0, 0, 1), 0)
    assert.equal(checkboxMorphProgress(CHECKBOX_MORPH_DURATION / 2, 0, 1), 0.5)
    assert.equal(checkboxMorphProgress(CHECKBOX_MORPH_DURATION, 0, 1), 1)
    assert.equal(checkboxMorphProgress(CHECKBOX_MORPH_DURATION * 3, 0, 1), 1)
    assert.equal(checkboxMorphProgress(CHECKBOX_MORPH_DURATION, 1, 0), 0)
    assert.equal(checkboxMorphProgress(0, 0.4, 0.4), 0.4)
  })

  it('turns back from part-way at the same pace, without jumping', () => {
    const from = 0.3
    assert.equal(checkboxMorphProgress(0, from, 0), from)
    // Covering 30% of the distance takes 30% of the full duration.
    assert.equal(checkboxMorphProgress(CHECKBOX_MORPH_DURATION * 0.3, from, 0), 0)
    const midway = checkboxMorphProgress(CHECKBOX_MORPH_DURATION * 0.15, from, 0)
    assert.ok(Math.abs(midway - 0.15) < 1e-9)
  })

  it('rejects progress and timing it cannot draw', () => {
    for (const invalid of [-0.01, 1.01, NaN, Infinity]) {
      assert.throws(() => checkboxMorphPath(invalid), /between 0 and 1/)
      assert.throws(() => checkboxMorphProgress(10, invalid, 1), /between 0 and 1/)
      assert.throws(() => checkboxMorphProgress(10, 0, invalid), /between 0 and 1/)
    }
    for (const invalid of [-1, NaN, Infinity]) {
      assert.throws(() => checkboxMorphProgress(invalid, 0, 1), /nonnegative/)
    }
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CROSS_CURSOR_PATH,
  CURSOR_MORPH_DURATION,
  cursorMorphPath,
  cursorMorphProgress,
  TRIANGLE_CURSOR_PATH,
} from '../src/lib/cursorMorph.ts'

function coordinates(path: string): number[] {
  return [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map(([number]) => Number(number))
}

describe('continuous cursor outline morph', () => {
  it('preserves the original triangle and morphs it to a twelve-vertex cross', () => {
    assert.equal(cursorMorphPath(0), TRIANGLE_CURSOR_PATH)
    assert.equal(cursorMorphPath(1), CROSS_CURSOR_PATH)
    assert.deepEqual(coordinates(TRIANGLE_CURSOR_PATH), [
      3, 2.5, 7.1, 5.4, 10.3, 7.4, 13.8, 10.1, 17.2, 12.1, 22.7, 16.1,
      14.2, 17.2, 11.3, 26.8, 9.1, 20.1, 8.2, 16.3, 6.5, 12.3, 5.5, 8.1,
    ])
    assert.equal(coordinates(CROSS_CURSOR_PATH).length, 24)
    assert.notEqual(TRIANGLE_CURSOR_PATH, CROSS_CURSOR_PATH)
  })

  it('moves every border vertex continuously instead of switching paths', () => {
    const start = coordinates(TRIANGLE_CURSOR_PATH)
    const end = coordinates(CROSS_CURSOR_PATH)
    for (const progress of [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
      const path = cursorMorphPath(progress)
      assert.equal(path.match(/M/g)?.length, 1)
      assert.equal(path.match(/L/g)?.length, 11)
      assert.equal(path.match(/Z/g)?.length, 1)
      assert.notEqual(path, TRIANGLE_CURSOR_PATH)
      assert.notEqual(path, CROSS_CURSOR_PATH)
      coordinates(path).forEach((coordinate, index) => {
        assert.ok(Math.abs(coordinate - (start[index] + (end[index] - start[index]) * progress)) <= 0.00051)
      })
    }
  })

  it('forms the cross quickly, holds it, then returns exactly to the triangle', () => {
    assert.equal(CURSOR_MORPH_DURATION, 560)
    assert.equal(cursorMorphProgress(0), 0)
    assert.ok(cursorMorphProgress(90) > 0.8)
    assert.equal(cursorMorphProgress(180), 1)
    assert.equal(cursorMorphProgress(250), 1)
    assert.equal(cursorMorphProgress(320), 1)
    assert.equal(cursorMorphProgress(440), 0.5)
    assert.equal(cursorMorphProgress(560), 0)
    assert.equal(cursorMorphProgress(1000), 0)
    assert.equal(cursorMorphPath(cursorMorphProgress(560)), TRIANGLE_CURSOR_PATH)
  })

  it('restarts repeated attempts from the current outline without jumping', () => {
    for (const current of [0.1, 0.5, 0.9, 1]) {
      assert.equal(cursorMorphProgress(0, current), current)
      assert.ok(cursorMorphProgress(60, current) >= current)
      assert.equal(cursorMorphProgress(180, current), 1)
      assert.equal(cursorMorphProgress(560, current), 0)
    }
  })

  it('keeps every sampled frame bounded and rejects invalid animation input', () => {
    for (let elapsed = 0; elapsed <= 600; elapsed += 4) {
      const progress = cursorMorphProgress(elapsed)
      assert.ok(progress >= 0 && progress <= 1)
      assert.ok(coordinates(cursorMorphPath(progress)).every(Number.isFinite))
    }
    for (const value of [-1, 1.1, NaN, Infinity]) {
      assert.throws(() => cursorMorphPath(value), /progress/)
      assert.throws(() => cursorMorphProgress(10, value), /timing/)
    }
    for (const value of [-1, NaN, Infinity]) {
      assert.throws(() => cursorMorphProgress(value), /timing/)
    }
  })
})

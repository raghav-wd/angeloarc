import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createCursorMorph,
  CROSS_CURSOR_PATH,
  CURSOR_MODE_SHAPES,
  CURSOR_MORPH_DURATION,
  cursorMorphPath,
  cursorMorphProgress,
  cursorShapeEase,
  cursorShapePath,
  TRIANGLE_CURSOR_PATH,
} from '../src/lib/cursorMorph.ts'
import type { CursorContour, CursorShape } from '../src/lib/cursorMorph.ts'

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

function distanceToOutline([x, y]: readonly [number, number], contour: CursorContour): number {
  let best = Infinity
  contour.forEach(([ax, ay], index) => {
    const [bx, by] = contour[(index + 1) % contour.length]
    const length = (bx - ax) ** 2 + (by - ay) ** 2
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / length))
    best = Math.min(best, Math.hypot(x - (ax + (bx - ax) * t), y - (ay + (by - ay) * t)))
  })
  return best
}

function bounds(shape: CursorShape) {
  const points = shape.flat()
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
}

function signedArea(contour: CursorContour): number {
  return contour.reduce((sum, [x, y], index) => {
    const [nextX, nextY] = contour[(index + 1) % contour.length]
    return sum + x * nextY - nextX * y
  }, 0) / 2
}

describe('cursor shapes for picking things up', () => {
  it('draws the pointer exactly as the original triangle', () => {
    assert.equal(cursorShapePath(CURSOR_MODE_SHAPES.pointer), TRIANGLE_CURSOR_PATH)
  })

  it('centres the grabbing hand and the switch arrows on the hotspot', () => {
    for (const mode of ['grab', 'switch'] as const) {
      const box = bounds(CURSOR_MODE_SHAPES[mode])
      assert.ok(Math.abs((box.left + box.right) / 2 - 3) < 1.6, `${mode} is centred horizontally`)
      assert.ok(Math.abs((box.top + box.bottom) / 2 - 3) < 1.6, `${mode} is centred vertically`)
      assert.ok(box.right - box.left > 15 && box.right - box.left < 24, `${mode} has a cursor-like width`)
    }
    assert.equal(CURSOR_MODE_SHAPES.grab.length, 1)
    assert.equal(CURSOR_MODE_SHAPES.switch.length, 2)
    assert.equal(cursorShapePath(CURSOR_MODE_SHAPES.switch).match(/M/g)?.length, 2)
  })

  it('winds every outline the same way so morphs never turn inside out', () => {
    for (const shape of Object.values(CURSOR_MODE_SHAPES)) {
      for (const contour of shape) assert.ok(signedArea(contour) > 0)
    }
  })

  it('starts and ends each morph exactly on the two outlines', () => {
    const pairs = [['pointer', 'grab'], ['grab', 'switch'], ['switch', 'grab'], ['grab', 'pointer']] as const
    for (const [from, to] of pairs) {
      const morph = createCursorMorph(CURSOR_MODE_SHAPES[from], CURSOR_MODE_SHAPES[to])
      const start = morph(0)
      const end = morph(1)
      CURSOR_MODE_SHAPES[from].forEach((contour, index) => {
        for (const point of start[index]) assert.ok(distanceToOutline(point, contour) < 1e-6, `${from} start`)
        for (const corner of contour) assert.ok(start[index].some(([x, y]) => Math.hypot(x - corner[0], y - corner[1]) < 1e-6))
      })
      CURSOR_MODE_SHAPES[to].forEach((contour, index) => {
        for (const point of end[index]) assert.ok(distanceToOutline(point, contour) < 1e-6, `${to} end`)
      })
    }
  })

  it('moves a fixed set of points smoothly instead of swapping icons', () => {
    const morph = createCursorMorph(CURSOR_MODE_SHAPES.pointer, CURSOR_MODE_SHAPES.grab)
    let previous = morph(0)
    for (let step = 1; step <= 100; step += 1) {
      const next = morph(step / 100)
      assert.equal(next.length, previous.length)
      next.forEach((contour, index) => {
        assert.equal(contour.length, previous[index].length)
        contour.forEach(([x, y], point) => {
          const [lastX, lastY] = previous[index][point]
          assert.ok(Math.hypot(x - lastX, y - lastY) < 0.5)
        })
      })
      previous = next
    }
  })

  it('grows the second switch arrow out of nothing and folds it away again', () => {
    const apart = createCursorMorph(CURSOR_MODE_SHAPES.grab, CURSOR_MODE_SHAPES.switch)
    assert.equal(cursorShapePath(apart(0)).match(/M/g)?.length, 1)
    assert.equal(cursorShapePath(apart(0.5)).match(/M/g)?.length, 2)
    const together = createCursorMorph(CURSOR_MODE_SHAPES.switch, CURSOR_MODE_SHAPES.grab)
    assert.equal(cursorShapePath(together(1)).match(/M/g)?.length, 1)
  })

  it('can change course from a half-finished outline', () => {
    const halfway = createCursorMorph(CURSOR_MODE_SHAPES.pointer, CURSOR_MODE_SHAPES.grab)(0.4)
    const reroute = createCursorMorph(halfway, CURSOR_MODE_SHAPES.switch)
    const start = reroute(0)
    halfway.forEach((contour, index) => {
      for (const point of start[index]) assert.ok(distanceToOutline(point, contour) < 1e-6)
    })
    CURSOR_MODE_SHAPES.switch.forEach((contour, index) => {
      for (const point of reroute(1)[index]) assert.ok(distanceToOutline(point, contour) < 1e-6)
    })
  })

  it('eases into place and rejects invalid progress', () => {
    assert.equal(cursorShapeEase(0), 0)
    assert.equal(cursorShapeEase(1), 1)
    assert.ok(cursorShapeEase(0.25) > 0.25)
    const morph = createCursorMorph(CURSOR_MODE_SHAPES.pointer, CURSOR_MODE_SHAPES.grab)
    for (const value of [-0.1, 1.1, NaN, Infinity]) assert.throws(() => morph(value), /progress/)
  })
})

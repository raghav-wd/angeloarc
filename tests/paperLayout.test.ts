import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BALL_SPACING_X,
  BALL_SPACING_Y,
  clusterPatterns,
  DROP_BOUNCE_DURATION,
  DROP_FALL_DURATION,
  DROP_MAX_STAGGER,
  dropDuration,
  exitDistance,
  layoutCluster,
  planDrop,
} from '../src/lib/paperLayout.ts'
import type { ClusterArea } from '../src/lib/paperLayout.ts'
import { createRandom } from '../src/lib/paperMesh.ts'

const DESKTOP: ClusterArea = { width: 1440, height: 900, top: 166, bottom: 784, inset: 78 }
const PHONE: ClusterArea = { width: 390, height: 844, top: 150, bottom: 688, inset: 50 }

function rows(points: Array<{ x: number; y: number }>): number[] {
  const counts = new Map<number, number>()
  for (const point of points) {
    const key = Math.round(point.y)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([, count]) => count)
}

function centroid(points: Array<{ x: number; y: number }>) {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  }
}

describe('paper ball cluster layout', () => {
  it('puts a single ball dead centre', () => {
    const layout = layoutCluster(1, DESKTOP)
    assert.equal(layout.shape, 'center')
    assert.equal(layout.positions[0].x, DESKTOP.width / 2)
    assert.equal(layout.scale, 1)
  })

  it('arranges three balls as a centred triangle', () => {
    const layout = layoutCluster(3, DESKTOP)
    assert.equal(layout.shape, 'triangle')
    assert.deepEqual(rows(layout.positions), [1, 2])
    const [apex, left, right] = layout.positions
    assert.equal(apex.x, DESKTOP.width / 2)
    assert.equal(left.y, right.y)
    assert.ok(Math.abs((left.x + right.x) / 2 - apex.x) < 1e-9)
    assert.ok(right.x - left.x === BALL_SPACING_X)
    assert.ok(left.y - apex.y === BALL_SPACING_Y)
  })

  it('uses recognisable shapes for small counts on a desktop', () => {
    const expected: Record<number, [string, number[]]> = {
      2: ['pair', [2]],
      4: ['diamond', [1, 2, 1]],
      5: ['cross', [2, 1, 2]],
      6: ['ring', [2, 2, 2]],
      7: ['hexagon', [2, 3, 2]],
      9: ['square', [3, 3, 3]],
    }
    for (const [count, [shape, rowCounts]] of Object.entries(expected)) {
      const layout = layoutCluster(Number(count), DESKTOP)
      assert.equal(layout.shape, shape, `count ${count}`)
      assert.deepEqual(rows(layout.positions), rowCounts, `count ${count}`)
    }
  })

  it('keeps every cluster horizontally centred and inside the area', () => {
    for (const area of [DESKTOP, PHONE]) {
      for (let count = 1; count <= 12; count += 1) {
        const layout = layoutCluster(count, area)
        assert.equal(layout.positions.length, count)
        assert.ok(Math.abs(centroid(layout.positions).x - area.width / 2) < 1e-6, `count ${count}`)
        for (const point of layout.positions) {
          assert.ok(point.x - layout.labelWidth / 2 >= area.inset - 1, `count ${count} fits left`)
          assert.ok(point.x + layout.labelWidth / 2 <= area.width - area.inset + 1, `count ${count} fits right`)
          assert.ok(point.y - layout.ball / 2 >= area.top - 1, `count ${count} fits top`)
        }
      }
    }
  })

  it('only shrinks balls when the area is too small for them', () => {
    assert.equal(layoutCluster(12, DESKTOP).scale, 1)
    const phone = layoutCluster(12, PHONE)
    assert.ok(phone.scale < 1 && phone.scale > 0.4)
  })

  it('rejects impossible requests', () => {
    assert.throws(() => clusterPatterns(0), /positive whole number/)
    assert.throws(() => clusterPatterns(1.5), /positive whole number/)
    assert.throws(() => layoutCluster(2, { ...DESKTOP, width: NaN }), /finite/)
  })
})

describe('paper ball drop choreography', () => {
  it('drops centre balls first and keeps impacts on screen', () => {
    const layout = layoutCluster(7, DESKTOP)
    const drops = planDrop(layout, DESKTOP, createRandom('drop-test'))
    assert.equal(drops.length, 7)
    const middle = layout.positions.findIndex((point) => point.x === layout.center.x && point.y === layout.center.y)
    assert.equal(drops[middle].start, 0)
    for (const drop of drops) {
      assert.ok(drop.start >= 0 && drop.start <= DROP_MAX_STAGGER)
      assert.ok(drop.force >= 0.8 && drop.force <= 1.2)
      assert.ok(drop.impact.x >= 0 && drop.impact.x <= DESKTOP.width)
      assert.ok(drop.impact.y >= 0 && drop.impact.y <= DESKTOP.height)
    }
    assert.ok(dropDuration(drops) <= DROP_MAX_STAGGER + DROP_FALL_DURATION + DROP_BOUNCE_DURATION)
  })

  it('is deterministic for a given random source', () => {
    const layout = layoutCluster(5, DESKTOP)
    assert.deepEqual(planDrop(layout, DESKTOP, createRandom('same')), planDrop(layout, DESKTOP, createRandom('same')))
    assert.deepEqual(planDrop({ ...layout, positions: [] }, DESKTOP, Math.random), [])
  })

  it('rolls exiting balls completely off the screen', () => {
    const viewport = { width: 1000, height: 600 }
    const radius = 40
    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7, 2.5, -2.2]) {
      const from = { x: 500, y: 300 }
      const distance = exitDistance(from, angle, viewport, radius)
      const end = { x: from.x + Math.cos(angle) * distance, y: from.y + Math.sin(angle) * distance }
      const outside = end.x <= -radius || end.x >= viewport.width + radius || end.y <= -radius || end.y >= viewport.height + radius
      assert.ok(outside, `angle ${angle}`)
    }
  })
})

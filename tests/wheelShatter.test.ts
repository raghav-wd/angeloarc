import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createRandom } from '../src/lib/paperMesh.ts'
import { getDaySectors } from '../src/lib/tracker.ts'
import {
  BLADE_STREAK,
  bladeStreak,
  cubicBezier,
  polygonArea,
  polygonCentroid,
  seamStyle,
  sectorPolygon,
  SHARD_DURATION,
  shardPose,
  SHATTER_STAGGER,
  shatterEnd,
  shatterTiles,
  splitPolygon,
  wheelSlashes,
} from '../src/lib/wheelShatter.ts'
import { SWEEP_OUT_DURATION } from '../src/lib/radialSweep.ts'
import type { Point } from '../src/lib/wheelShatter.ts'

const square: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10]]

// A month's wheel laid out the way the tracker draws it.
function wheel(habits: number) {
  const sectors = getDaySectors({ year: 2026, month: 9 })
  const innerRadius = 112
  const outerRadius = innerRadius + habits * 29
  const center = Math.max((outerRadius + 35) * 2, 550) / 2
  const random = createRandom(`test:${habits}`)
  const slashes = wheelSlashes(center, innerRadius, outerRadius, random, Math.round(sectors.length * (2 + habits * 0.14)))
  const tiles = Array.from({ length: habits }, (_, ring) => sectors.map((sector) => ({
    polygon: sectorPolygon(center, center, outerRadius - ring * 29 - 25.5, outerRadius - ring * 29, sector.startAngle, sector.endAngle),
    angle: sector.midAngle,
  }))).flat()
  return { center, innerRadius, outerRadius, slashes, tiles, plan: shatterTiles(center, tiles, slashes, random) }
}

describe('polygons', () => {
  it('measures area and finds the middle', () => {
    assert.equal(polygonArea(square), 100)
    assert.deepEqual(polygonCentroid(square), [5, 5])
  })

  it('draws a tile of the wheel with its arcs sampled', () => {
    const tile = sectorPolygon(100, 100, 50, 80, -90, -60, 4)
    assert.equal(tile.length, 10)
    const exact = (Math.PI * (80 ** 2 - 50 ** 2)) * (30 / 360)
    assert.ok(Math.abs(polygonArea(tile) - exact) / exact < 0.01)
    assert.throws(() => sectorPolygon(0, 0, 80, 50, 0, 10), /outer radius past the inner one/)
  })
})

describe('splitting along a line', () => {
  it('cuts a polygon into two parts that add up to it', () => {
    const split = splitPolygon(square, [0, 4], [1, 0])
    assert.ok(split)
    const [front, back] = split.sides
    assert.equal(polygonArea(front) + polygonArea(back), 100)
    assert.equal(polygonArea(back), 40)
    assert.deepEqual(split.chord.map(([x]) => x).sort((a, b) => a - b), [0, 10])
  })

  it('cuts at a slant too', () => {
    const split = splitPolygon(square, [5, 5], [Math.SQRT1_2, Math.SQRT1_2])
    assert.ok(split)
    assert.ok(Math.abs(polygonArea(split.sides[0]) - 50) < 1e-6)
  })

  it('leaves alone a polygon the line misses or only touches', () => {
    assert.equal(splitPolygon(square, [0, 20], [1, 0]), null)
    assert.equal(splitPolygon(square, [0, 10], [1, 0]), null)
  })
})

describe('the blades round the wheel', () => {
  const { center, slashes } = wheel(6)

  const sweepTime = (angle: number) => Math.min(1, Math.max(0, (angle + 90) / 360)) * SHATTER_STAGGER

  it('come round the days in order, all within the sweep', () => {
    assert.ok(slashes.length >= 80)
    slashes.forEach((slash, index) => {
      assert.ok(slash.at >= 0 && slash.at <= SHATTER_STAGGER)
      assert.ok(slash.travel >= 32 && slash.travel <= 120)
      // Each starts about when the sweep reaches its share of the days; a
      // steep one sets off a little early, from its far end.
      const slot = sweepTime(-88 + 266 * ((index + 0.5) / slashes.length))
      assert.ok(Math.abs(slash.at - slot) <= 130, `blade ${index} at ${slash.at}, slot ${Math.round(slot)}`)
    })
  })

  it('travel clockwise, and set off as the sweep reaches them, even across the top', () => {
    for (const { from, to, at } of slashes) {
      const start = (Math.atan2(from[1] - center, from[0] - center) * 180) / Math.PI
      const end = (Math.atan2(to[1] - center, to[0] - center) * 180) / Math.PI
      const turn = ((((end - start + 180) % 360) + 360) % 360) - 180
      assert.ok(turn >= 0, 'clockwise')
      // Measured from just before the top, so a blade crossing it is early, never last.
      const middle = start + turn / 2
      const unwrapped = middle < -100 ? middle + 360 : middle
      assert.ok(at <= sweepTime(unwrapped) + 1, `at ${at} for a blade around ${Math.round(unwrapped)}°`)
    }
  })

  it('are the same for the same seed', () => {
    assert.deepEqual(wheel(4).slashes, wheel(4).slashes)
  })

  it('need a ring to cut', () => {
    assert.throws(() => wheelSlashes(300, 200, 120, Math.random, 10), /outer radius past the inner one/)
  })
})

describe('the wheel cut to pieces', () => {
  for (const habits of [1, 3, 6, 9]) {
    const { tiles, plan } = wheel(habits)

    it(`cuts every tile of a ${habits}-ring wheel into two to four pieces that add up to it`, () => {
      assert.equal(plan.length, tiles.length)
      plan.forEach((tile, index) => {
        assert.ok(tile.shards.length >= 2 && tile.shards.length <= 4, `tile ${index}: ${tile.shards.length} pieces`)
        assert.ok(tile.seams.length >= 1 && tile.seams.length <= 3)
        const whole = polygonArea(tiles[index].polygon)
        const pieces = tile.shards.map((shard) => polygonArea(shard.points))
        assert.ok(Math.abs(polygonArea(tile.polygon) - whole) / whole < 0.01, `tile ${index} outline`)
        const sum = pieces.reduce((total, area) => total + area, 0)
        assert.ok(Math.abs(sum - whole) / whole < 0.01, `tile ${index} areas`)
        for (const area of pieces) assert.ok(area >= whole * 0.119, `tile ${index} sliver`)
      })
    })

    it(`times a ${habits}-ring wheel so the last piece has fallen before the page changes`, () => {
      for (const tile of plan) {
        assert.ok(tile.at >= 0)
        assert.ok(tile.at + SHARD_DURATION < SWEEP_OUT_DURATION, `${tile.at}`)
      }
    })

    it(`cuts a ${habits}-ring wheel from the top, the first day first`, () => {
      plan.forEach((tile, index) => {
        const angle = tiles[index].angle
        if (angle < -80) assert.ok(tile.at < 110, `first day cut at ${tile.at}`)
        if (angle > 170) assert.ok(tile.at > 400, `last day cut at ${tile.at}`)
      })
    })
  }

  it('cuts most tiles with the long blades, and gives the rest blades of their own', () => {
    const { plan } = wheel(6)
    const local = plan.filter((tile) => tile.local).length
    assert.ok(local / plan.length < 0.35, `${local} local cuts`)
    for (const tile of plan.filter((each) => each.local)) {
      assert.ok(Math.abs(tile.at - (tile.local!.at + tile.local!.travel / 2)) <= 1)
    }
  })

  it('sends the piece above a cut sliding down it and every piece falling', () => {
    for (const tile of wheel(6).plan) {
      for (const shard of tile.shards) {
        assert.ok(shard.fall[1] > shard.slide[1] + 10, 'falls')
        assert.ok(Math.abs(shard.turn) <= 15)
        assert.ok(Math.hypot(...shard.slide) <= 10)
      }
      const slips = tile.shards.map((shard) => Math.hypot(...shard.slide))
      assert.ok(Math.max(...slips) >= 3, 'one piece slips off its cut')
    }
  })
})

describe('the timing of a cut', () => {
  const shard = { points: [], pivot: [0, 0] as Point, slide: [6, 3] as Point, fall: [9, 24] as Point, turn: 10 }

  it('eases like CSS', () => {
    const linear = cubicBezier(0, 0, 1, 1)
    assert.ok(Math.abs(linear(0.3) - 0.3) < 1e-3)
    const ease = cubicBezier(0.25, 0.1, 0.25, 1)
    assert.ok(Math.abs(ease(0.5) - 0.8024) < 2e-3)
    assert.equal(ease(-1), 0)
    assert.equal(ease(2), 1)
  })

  it('holds a beat after the cut, slips along it, then falls and fades', () => {
    assert.deepEqual(shardPose(shard, 0), { x: 0, y: 0, rotate: 0, opacity: 1 })
    assert.deepEqual(shardPose(shard, SHARD_DURATION * 0.1), { x: 0, y: 0, rotate: 0, opacity: 1 })
    const slipped = shardPose(shard, SHARD_DURATION * 0.46)
    assert.ok(Math.abs(slipped.x - 6) < 1e-6 && Math.abs(slipped.y - 3) < 1e-6)
    assert.equal(slipped.opacity, 1)
    const falling = shardPose(shard, SHARD_DURATION * 0.8)
    assert.ok(falling.y > 3 && falling.y < 24 && falling.opacity < 0.9)
    const gone = shardPose(shard, SHARD_DURATION)
    assert.ok(Math.abs(gone.y - 24) < 1e-6 && gone.opacity === 0 && Math.abs(gone.rotate - 10) < 1e-6)
  })

  it('lights the cut white, opens it red, and puts it out', () => {
    assert.equal(seamStyle(-1), null)
    assert.equal(seamStyle(0)?.heat, 0)
    const opening = seamStyle(SHARD_DURATION * 0.3)
    assert.ok(opening && opening.heat > 0 && opening.width > 0.7)
    assert.equal(seamStyle(SHARD_DURATION * 0.7), null)
  })

  it('runs a streak of light along each blade, then is done', () => {
    const slash = { from: [0, 0] as Point, to: [100, 0] as Point, at: 100, travel: 50 }
    assert.equal(bladeStreak(slash, 100), null)
    const early = bladeStreak(slash, 100 + slash.travel * BLADE_STREAK * 0.2)
    const late = bladeStreak(slash, 100 + slash.travel * BLADE_STREAK * 0.7)
    assert.ok(early && late && late[1] > early[1])
    for (const [tail, head] of [early!, late!]) assert.ok(tail >= 0 && head <= 1 && head > tail)
    assert.equal(bladeStreak(slash, 100 + slash.travel * BLADE_STREAK), null)
  })

  it('knows when the last of the wheel has gone', () => {
    const { plan, slashes } = wheel(6)
    const end = shatterEnd(plan, slashes)
    assert.ok(end >= Math.max(...plan.map((tile) => tile.at)) + SHARD_DURATION)
    assert.ok(end < 1180)
  })
})

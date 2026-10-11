import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  backdropCuts,
  bladePath,
  BURN_IGNITE,
  burnOutline,
  burnRadius,
  burnRadiusAt,
  burnShape,
  emberPieces,
  fireIntensity,
  SLASH_BURST_SHAPES,
  slashBurstCuts,
  slashBurstPieces,
  spawnEmbers,
  spawnSlashBurst,
} from '../src/lib/dismantle.ts'
import { createRandom } from '../src/lib/paperMesh.ts'
import { SLASH_BOTTOM, SLASH_TOP, slashEraserWidth, slashStrokes } from '../src/lib/scribble.ts'

const line = { left: 0, right: 120, top: 0, bottom: 18 }

describe('a blade-shaped cut', () => {
  it('is a closed outline pointed at both ends of its length', () => {
    const path = bladePath(40, 3)
    assert.match(path, /^M-20 0Q.+ 20 0Q.+ -20 0Z$/)
  })

  it('refuses a cut with no length or no width', () => {
    assert.throws(() => bladePath(0, 2), /positive length and width/)
    assert.throws(() => bladePath(10, -1), /positive length and width/)
  })
})

describe('the old scars across the page', () => {
  it('makes exactly the asked-for number, all on the page and clear of the wheel', () => {
    const cuts = backdropCuts(createRandom('scars'), 17)
    assert.equal(cuts.length, 17)
    for (const cut of cuts) {
      assert.ok(cut.x >= 0 && cut.x <= 1 && cut.y >= 0 && cut.y <= 1)
      assert.ok(((cut.x - 0.5) / 0.27) ** 2 + ((cut.y - 0.53) / 0.42) ** 2 > 0.95, `${cut.x}, ${cut.y}`)
      assert.ok(cut.length > 0 && cut.width > 0)
      assert.ok(cut.period >= 14 && cut.period <= 28)
      assert.ok(cut.delay <= 0)
    }
  })

  it('is the same pattern for the same seed', () => {
    assert.deepEqual(backdropCuts(createRandom('same'), 9), backdropCuts(createRandom('same'), 9))
  })
})

describe('the burst when a promise is kept', () => {
  it('makes two crossing cuts', () => {
    const [first, second] = slashBurstCuts(createRandom('burst'))
    assert.ok(Math.abs(second.angle - first.angle) >= 60)
    assert.ok(second.delay > first.delay)
  })

  it('throws out drops, sparks and slivers along the cut', () => {
    const pieces = slashBurstPieces(12, createRandom('spray'))
    assert.equal(pieces.length, 12)
    assert.deepEqual(new Set(pieces.map((piece) => piece.shape)), new Set(SLASH_BURST_SHAPES))
    for (const piece of pieces) assert.ok(Math.hypot(piece.dx, piece.dy) <= 60)
    assert.deepEqual(slashBurstPieces(-1, Math.random), [])
  })

  it('does nothing where there is no page to draw on', () => {
    assert.doesNotThrow(() => spawnSlashBurst(10, 10))
    assert.doesNotThrow(() => spawnEmbers(10, 10))
  })
})

describe('a note dropping in on fire', () => {
  it('burns harder as it falls, flares on landing and goes out', () => {
    const fall = 430
    assert.equal(fireIntensity(-5, fall), 0)
    assert.ok(fireIntensity(0, fall) > 0)
    assert.ok(fireIntensity(200, fall) < fireIntensity(400, fall))
    assert.ok(fireIntensity(fall + 1, fall) > fireIntensity(fall - 1, fall))
    assert.ok(fireIntensity(fall + 300, fall) < fireIntensity(fall + 20, fall))
    assert.equal(fireIntensity(fall + 4000, fall), 0)
  })

  it('throws embers mostly upwards', () => {
    const embers = emberPieces(20, createRandom('embers'))
    assert.equal(embers.length, 20)
    assert.ok(embers.filter((ember) => ember.dy < 0).length >= 14)
  })
})

describe('the page burning away', () => {
  const shape = burnShape(createRandom('hole'))

  it('has a ragged edge that stays roughly round', () => {
    const reaches = Array.from({ length: 64 }, (_, step) => burnRadiusAt(shape, (step / 64) * Math.PI * 2, 100))
    assert.ok(Math.max(...reaches) - Math.min(...reaches) > 10, 'ragged')
    for (const reach of reaches) assert.ok(reach > 40 && reach < 160, `reach ${reach}`)
    assert.equal(burnRadiusAt(shape, 1, 0), 0)
  })

  it('waits to catch, takes its first bite, creeps, then is swallowed by the blaze', () => {
    const spot = { start: 300, radius: 120 }
    assert.equal(burnRadius(spot, 200, 0, 2000), 0)
    const bitten = burnRadius(spot, 300 + BURN_IGNITE, 0, 2000)
    assert.ok(Math.abs(bitten - 120) < 1e-6)
    assert.ok(burnRadius(spot, 300 + BURN_IGNITE + 400, 0, 2000) > bitten)
    assert.ok(burnRadius(spot, 0, 1, 2000) >= 2000)
  })

  it('draws holes as closed outlines, wider for the charred rings round them', () => {
    const hole = burnOutline(50, 50, shape, 30)
    assert.match(hole, /^M[\d.-]+ [\d.-]+(L[\d.-]+ [\d.-]+)+Z$/)
    assert.equal(burnOutline(50, 50, shape, 0), '')
    const [, x] = /^M([\d.-]+)/.exec(hole) ?? []
    const [, ringX] = /^M([\d.-]+)/.exec(burnOutline(50, 50, shape, 30, 12)) ?? []
    assert.ok(Number(ringX) > Number(x))
  })
})

describe('cutting a kept task in today\'s list', () => {
  it('makes one long cut through the line, rising, and short ones across it', () => {
    const cuts = slashStrokes([line], 7)
    assert.equal(cuts.length, 2)
    const [long, short] = cuts
    const [start, end] = [long.points[0], long.points[long.points.length - 1]]
    assert.ok(start[0] < line.left && end[0] > line.right)
    assert.ok(end[1] < start[1], 'rises left to right')
    assert.ok(short.length < long.length)
  })

  it('keeps every cut within the band the eraser lifts', () => {
    const height = line.bottom - line.top
    const half = slashEraserWidth(line) / 2
    const middle = line.top + height * ((SLASH_TOP + SLASH_BOTTOM) / 2)
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const cut of slashStrokes([line, { ...line, top: 20, bottom: 38 }], seed).slice(0, 2)) {
        for (const [, y] of cut.points) assert.ok(Math.abs(y - middle) <= half + 0.01, `y ${y}`)
      }
    }
  })

  it('gives a short name only the long cut, and a long one two short ones', () => {
    assert.equal(slashStrokes([{ ...line, right: 30 }], 3).length, 1)
    assert.equal(slashStrokes([{ ...line, right: 220 }], 3).length, 3)
    assert.deepEqual(slashStrokes([line], 9), slashStrokes([line], 9))
  })
})

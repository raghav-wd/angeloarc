import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BIN_DRAWING,
  BIN_RIM_LIFT,
  binArrival,
  binFit,
  binPlacement,
  binSinkDepth,
  FLICK_MIN_SPEED,
  hopPose,
  isFlickToward,
  isOverBin,
  nearestWithin,
  planBinToss,
  project,
  releaseVelocity,
  stepFall,
  stepSpring,
  trimSamples,
  unproject,
} from '../src/lib/paperGesture.ts'
import type { PointerSample } from '../src/lib/paperGesture.ts'
import { groupRollDistance } from '../src/lib/paperLayout.ts'

const VIEWPORT = { width: 1440, height: 900 }

function trail(from: { x: number; y: number }, velocity: { x: number; y: number }, until: number, step = 16): PointerSample[] {
  const samples: PointerSample[] = []
  for (let t = until - 160; t <= until; t += step) {
    samples.push({ x: from.x + velocity.x * (t - until), y: from.y + velocity.y * (t - until), t })
  }
  return samples
}

describe('reading how a paper ball was let go', () => {
  it('measures the speed and direction of a flick', () => {
    const velocity = releaseVelocity(trail({ x: 600, y: 400 }, { x: 1.2, y: -0.4 }, 1000), 1004)
    assert.ok(Math.abs(velocity.x - 1.2) < 1e-6)
    assert.ok(Math.abs(velocity.y + 0.4) < 1e-6)
  })

  it('treats a pointer that came to rest before letting go as placing, not throwing', () => {
    assert.deepEqual(releaseVelocity(trail({ x: 0, y: 0 }, { x: 2, y: 0 }, 1000), 1200), { x: 0, y: 0 })
    assert.deepEqual(releaseVelocity([], 10), { x: 0, y: 0 })
    assert.deepEqual(releaseVelocity([{ x: 1, y: 1, t: 5 }], 6), { x: 0, y: 0 })
  })

  it('caps absurd speeds from jittery pointers', () => {
    const velocity = releaseVelocity(trail({ x: 0, y: 0 }, { x: 40, y: 0 }, 1000), 1000)
    assert.ok(Math.hypot(velocity.x, velocity.y) <= 3.2 + 1e-9)
  })

  it('keeps only the recent end of the trail', () => {
    const samples = trail({ x: 0, y: 0 }, { x: 1, y: 0 }, 1000)
    trimSamples(samples, 1000, 50)
    assert.ok(samples.every((sample) => 1000 - sample.t <= 50))
  })
})

describe('throwing a paper ball at the bin', () => {
  const bin = { x: 1300, y: 450 }

  it('counts a quick flick roughly at the bin as a throw', () => {
    assert.ok(isFlickToward({ x: 700, y: 450 }, { x: 1.4, y: 0.2 }, bin, 60))
    assert.ok(isFlickToward({ x: 700, y: 450 }, { x: 1, y: -0.45 }, bin, 60))
  })

  it('ignores slow drags and flicks the other way', () => {
    assert.equal(isFlickToward({ x: 700, y: 450 }, { x: FLICK_MIN_SPEED * 0.9, y: 0 }, bin, 60), false)
    assert.equal(isFlickToward({ x: 700, y: 450 }, { x: -2, y: 0 }, bin, 60), false)
    assert.equal(isFlickToward({ x: 700, y: 450 }, { x: 0, y: 2 }, bin, 60), false)
    assert.equal(isFlickToward({ x: 700, y: 450 }, { x: NaN, y: 0 }, bin, 60), false)
  })

  it('forgives a looser aim close to the bin', () => {
    const sideways = { x: 1, y: 1.1 }
    assert.equal(isFlickToward({ x: 600, y: 450 }, sideways, bin, 60), false)
    assert.ok(isFlickToward({ x: 1230, y: 400 }, sideways, bin, 60))
  })

  it('bounces once on the page, then lands on the rim of the bin', () => {
    const hops = planBinToss({ x: 700, y: 450, lift: 0.3 }, bin, 1.5, 84)
    assert.equal(hops.length, 2)
    const [first, second] = hops
    assert.equal(first.to.lift, 0)
    assert.deepEqual(first.to, second.from)
    assert.deepEqual(second.to, { ...bin, lift: BIN_RIM_LIFT })
    assert.ok(second.height > first.height)
    for (const hop of hops) {
      assert.ok(hop.duration >= 170 && hop.duration <= 560)
      for (let step = 0; step <= 20; step += 1) assert.ok(hopPose(hop, step / 20).lift >= 0)
    }
    const toward = (first.to.x - 700) * (bin.x - 700) + (first.to.y - 450) * (bin.y - 450)
    assert.ok(toward > 0)
  })

  it('throws harder flicks faster', () => {
    const slow = planBinToss({ x: 600, y: 450, lift: 0.3 }, bin, 0.6, 84)
    const fast = planBinToss({ x: 600, y: 450, lift: 0.3 }, bin, 2.4, 84)
    const total = (hops: typeof slow) => hops.reduce((sum, hop) => sum + hop.duration, 0)
    assert.ok(total(fast) < total(slow))
  })

  it('drops straight in when let go above the bin', () => {
    const hops = planBinToss({ x: 1290, y: 440, lift: 0.3 }, bin, 0, 84)
    assert.equal(hops.length, 1)
    assert.deepEqual(hopPose(hops[0], 1), { ...bin, lift: BIN_RIM_LIFT })
    assert.deepEqual(hopPose(hops[0], 0), { x: 1290, y: 440, lift: 0.3 })
  })
})

describe('the feel of a held paper ball', () => {
  it('maps between the page and the screen through the same perspective', () => {
    for (const lift of [0, 0.3, 1]) {
      const screen = project({ x: 300, y: 200, lift }, VIEWPORT)
      const page = unproject(screen, lift, VIEWPORT)
      assert.ok(Math.abs(page.x - 300) < 1e-9 && Math.abs(page.y - 200) < 1e-9)
    }
    const raised = project({ x: 300, y: 200, lift: 0.5 }, VIEWPORT)
    assert.ok(raised.x < 300 && raised.y < 200, 'raised balls move away from the middle')
  })

  it('springs home with a little overshoot and settles', () => {
    let value = 0
    let velocity = 0
    let peak = 0
    for (let time = 0; time < 1500; time += 16) {
      ;[value, velocity] = stepSpring(value, velocity, 100, 16, 0.024, 0.62)
      peak = Math.max(peak, value)
    }
    assert.ok(peak > 100 && peak < 115)
    assert.ok(Math.abs(value - 100) < 0.5)
  })

  it('falls back onto the page, bounces lower each time and comes to rest', () => {
    let state = { lift: 0.3, velocity: 0, impact: 0 }
    const impacts: number[] = []
    for (let time = 0; time < 1500; time += 16) {
      state = stepFall(state.lift, state.velocity, 16)
      assert.ok(state.lift >= 0)
      if (state.impact > 0) impacts.push(state.impact)
    }
    assert.ok(impacts.length >= 2)
    assert.ok(impacts[1] < impacts[0])
    assert.equal(state.lift, 0)
    assert.equal(state.velocity, 0)
    assert.deepEqual(stepFall(0, 0, 16), { lift: 0, velocity: 0, impact: 0 })
  })

  it('finds the closest ball within reach to swap with', () => {
    const balls = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 160, y: 100 }]
    assert.equal(nearestWithin({ x: 140, y: 100 }, balls, 50)?.id, 'b')
    assert.equal(nearestWithin({ x: 120, y: 100 }, balls, 50)?.id, 'a')
    assert.equal(nearestWithin({ x: 400, y: 100 }, balls, 50), null)
  })
})

describe('rolling a group of balls off screen together', () => {
  it('moves every ball the same distance, far enough for the last one to leave', () => {
    const points = [{ x: 500, y: 300 }, { x: 900, y: 300 }, { x: 700, y: 460 }]
    const distance = groupRollDistance(points, 1440, 42, 1)
    for (const point of points) assert.ok(point.x + distance - 42 >= 1440)
    const entry = groupRollDistance(points, 1440, 42, -1)
    for (const point of points) assert.ok(point.x - entry + 42 <= 0)
    assert.equal(groupRollDistance([], 1440, 42, 1), 0)
  })
})

describe('the waste-paper bin', () => {
  it('stands at the right edge, level with the middle of the balls', () => {
    const desktop = binPlacement(VIEWPORT, 475)
    assert.equal(desktop.scale, 1)
    assert.ok(desktop.x > VIEWPORT.width - 200 && desktop.x < VIEWPORT.width - 60)
    const middle = desktop.y + ((BIN_DRAWING.baseY - BIN_DRAWING.mouthY) / 2) * desktop.scale
    assert.ok(Math.abs(middle - 475) < 20)
    const phone = binPlacement({ width: 390, height: 844 }, 440)
    assert.ok(phone.scale < 1)
    assert.ok(phone.x + BIN_DRAWING.mouthRx * phone.scale <= 390)
  })

  it('catches a ball let go over its mouth or body, and nowhere else', () => {
    const bin = binPlacement(VIEWPORT, 475)
    assert.ok(isOverBin({ x: bin.x, y: bin.y }, bin))
    assert.ok(isOverBin({ x: bin.x + 30, y: bin.y + 80 }, bin))
    assert.equal(isOverBin({ x: bin.x - 120, y: bin.y }, bin), false)
    assert.equal(isOverBin({ x: bin.x, y: bin.y - 120 }, bin), false)
  })

  it('squeezes big balls through the mouth and lets them vanish inside', () => {
    const bin = binPlacement({ width: 390, height: 844 }, 440)
    const fit = binFit(bin, 84)
    assert.ok(fit < 1)
    assert.ok(84 * (1 + BIN_RIM_LIFT) * fit <= BIN_DRAWING.mouthRx * 2 * bin.scale)
    assert.equal(binFit(binPlacement(VIEWPORT, 475), 20), 1)
    const radius = 40
    const arrival = binArrival(bin, radius)
    const rim = bin.y + BIN_DRAWING.mouthRy * bin.scale
    assert.equal(arrival.y + radius, rim)
    const sunk = arrival.y + binSinkDepth(radius, radius * 0.86)
    assert.ok(sunk - radius * 0.86 > rim, 'the top of the ball is below the rim')
  })
})

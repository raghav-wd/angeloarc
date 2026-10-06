// The physics of handling paper balls: picking one up, flicking it, letting
// it fall back with a bounce and tossing it into the bin. Everything here is
// pure, so the page can step it frame by frame.
//
// Positions are on the page in CSS pixels. `lift` is the height above the
// page: 0 is resting on it, 1 makes a ball look twice its size.

export interface Vec {
  x: number
  y: number
}

export interface HopPoint extends Vec {
  lift: number
}

export interface PointerSample extends Vec {
  /** Milliseconds, on the same clock as the release time. */
  t: number
}

export interface Hop {
  from: HopPoint
  to: HopPoint
  /** Extra height at the top of the arc, above the straight line between its ends. */
  height: number
  duration: number
}

export interface Viewport {
  width: number
  height: number
}

/** How strongly lifting a ball pulls it towards the viewer, away from the middle of the screen. */
export const PERSPECTIVE = 0.42
/** Pressing this long without moving picks a ball up instead of clicking it. */
export const HOLD_DELAY = 220
/** Moving this far while pressed picks a ball up straight away. */
export const DRAG_SLOP = 6
export const TOUCH_DRAG_SLOP = 10
/** Release speed (px/ms) that turns letting go into a throw. */
export const FLICK_MIN_SPEED = 0.55
/** How far off a straight line to the bin a throw may still go in. */
export const FLICK_MAX_ANGLE = Math.PI * 0.15
const FLICK_WINDOW = 100
/** A pointer that stood still this long before letting go was placing, not throwing. */
const FLICK_STALE_AFTER = 80
/** A held ball floats this high above the page. */
export const HELD_LIFT = 0.3
/** Lift at which a thrown ball clears the rim of the bin. */
export const BIN_RIM_LIFT = 0.1
export const LIFT_GRAVITY = 0.000026
const MAX_SPEED = 3.2

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount

/** Where a point on the page, raised by `lift`, appears on screen. */
export function project(point: HopPoint, viewport: Viewport): Vec {
  const depth = 1 + point.lift * PERSPECTIVE
  return {
    x: viewport.width / 2 + (point.x - viewport.width / 2) * depth,
    y: viewport.height / 2 + (point.y - viewport.height / 2) * depth,
  }
}

/** The page position that appears at `screen` when raised by `lift`. */
export function unproject(screen: Vec, lift: number, viewport: Viewport): Vec {
  const depth = Math.max(0.2, 1 + lift * PERSPECTIVE)
  return {
    x: viewport.width / 2 + (screen.x - viewport.width / 2) / depth,
    y: viewport.height / 2 + (screen.y - viewport.height / 2) / depth,
  }
}

/** Keeps the last moments of a drag, enough to measure how it was let go. */
export function trimSamples(samples: PointerSample[], now: number, keep = 160): PointerSample[] {
  while (samples.length > 2 && now - samples[0].t > keep) samples.shift()
  return samples
}

/**
 * The pointer's velocity (px/ms) as it was let go: a least-squares fit over
 * the last tenth of a second, or nothing if it had come to rest.
 */
export function releaseVelocity(samples: readonly PointerSample[], now: number): Vec {
  const last = samples[samples.length - 1]
  if (!last || now - last.t > FLICK_STALE_AFTER) return { x: 0, y: 0 }
  const recent = samples.filter((sample) => last.t - sample.t <= FLICK_WINDOW)
  if (recent.length < 2 || last.t - recent[0].t < 8) return { x: 0, y: 0 }
  const meanT = recent.reduce((sum, sample) => sum + sample.t, 0) / recent.length
  const meanX = recent.reduce((sum, sample) => sum + sample.x, 0) / recent.length
  const meanY = recent.reduce((sum, sample) => sum + sample.y, 0) / recent.length
  let spread = 0
  let x = 0
  let y = 0
  for (const sample of recent) {
    const dt = sample.t - meanT
    spread += dt * dt
    x += dt * (sample.x - meanX)
    y += dt * (sample.y - meanY)
  }
  if (spread < 1e-9) return { x: 0, y: 0 }
  const velocity = { x: x / spread, y: y / spread }
  const speed = Math.hypot(velocity.x, velocity.y)
  return speed > MAX_SPEED ? { x: (velocity.x / speed) * MAX_SPEED, y: (velocity.y / speed) * MAX_SPEED } : velocity
}

/**
 * Whether letting go at `from` with `velocity` throws the ball at a target.
 * A nearby target looks wider, so it forgives a sloppier aim.
 */
export function isFlickToward(from: Vec, velocity: Vec, target: Vec, targetRadius: number): boolean {
  const speed = Math.hypot(velocity.x, velocity.y)
  if (!Number.isFinite(speed) || speed < FLICK_MIN_SPEED) return false
  const dx = target.x - from.x
  const dy = target.y - from.y
  const distance = Math.hypot(dx, dy)
  if (distance <= targetRadius) return true
  const allowed = Math.max(FLICK_MAX_ANGLE, Math.atan2(targetRadius * 1.4, distance))
  return (velocity.x * dx + velocity.y * dy) / (speed * distance) >= Math.cos(allowed)
}

export function hopPose(hop: Hop, progress: number): HopPoint {
  const t = clamp(progress, 0, 1)
  return {
    x: lerp(hop.from.x, hop.to.x, t),
    y: lerp(hop.from.y, hop.to.y, t),
    lift: lerp(hop.from.lift, hop.to.lift, t) + 4 * hop.height * t * (1 - t),
  }
}

/**
 * A throw into the bin: the ball strikes the page once on its way, then
 * arcs over the rim. Let go right above the bin, it simply drops in. A harder
 * throw flies faster.
 */
export function planBinToss(from: HopPoint, bin: Vec, speed: number, ball: number): Hop[] {
  const dx = bin.x - from.x
  const dy = bin.y - from.y
  const distance = Math.hypot(dx, dy)
  const rim = { x: bin.x, y: bin.y, lift: BIN_RIM_LIFT }
  if (distance < ball * 0.9) {
    return [{ from, to: rim, height: 0.08, duration: clamp(190 + distance, 200, 300) }]
  }
  const pace = clamp(Number.isFinite(speed) ? speed : 0, 0.9, 2.6)
  const split = distance < ball * 2.4 ? 0.42 : 0.56
  const bounce = { x: from.x + dx * split, y: from.y + dy * split, lift: 0 }
  const first = distance * split
  const second = distance - first
  return [
    { from, to: bounce, height: 0.06 + Math.min(0.2, first / 1800), duration: clamp(first / pace, 170, 420) },
    { from: bounce, to: rim, height: 0.3 + Math.min(0.28, second / 1400), duration: clamp(second / (pace * 0.75), 280, 560) },
  ]
}

/** One step of a damped spring; `frequency` is in radians per millisecond. */
export function stepSpring(
  value: number,
  velocity: number,
  target: number,
  dt: number,
  frequency: number,
  damping: number,
): [value: number, velocity: number] {
  let x = value
  let v = velocity
  for (let remaining = Math.max(0, dt); remaining > 0; remaining -= 8) {
    const h = Math.min(remaining, 8)
    v += (-frequency * frequency * (x - target) - 2 * damping * frequency * v) * h
    x += v * h
  }
  return [x, v]
}

/**
 * Lets a raised ball fall onto the page under gravity. It bounces back up
 * with some of its speed, and reports how hard it struck.
 */
export function stepFall(
  lift: number,
  velocity: number,
  dt: number,
  restitution = 0.36,
): { lift: number; velocity: number; impact: number } {
  if (lift <= 0 && Math.abs(velocity) < 1e-9) return { lift: 0, velocity: 0, impact: 0 }
  let height = lift
  let speed = velocity
  let impact = 0
  for (let remaining = Math.max(0, dt); remaining > 0; remaining -= 8) {
    const h = Math.min(remaining, 8)
    speed -= LIFT_GRAVITY * h
    height += speed * h
    if (height <= 0 && speed < 0) {
      impact = Math.max(impact, -speed)
      height = 0
      speed = -speed * restitution
      if (speed < 0.0006) speed = 0
    }
  }
  return { lift: height, velocity: speed, impact }
}

/** The candidate whose centre lies closest to `point`, if any is within `radius`. */
export function nearestWithin<T extends Vec>(point: Vec, candidates: readonly T[], radius: number): T | null {
  let best: T | null = null
  let bestDistance = radius
  for (const candidate of candidates) {
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y)
    if (distance <= bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

/**
 * The waste-paper bin, in the units of its drawing: an open mouth at the top
 * and a body that tapers down to a smaller base.
 */
export const BIN_DRAWING = {
  width: 112,
  height: 128,
  mouthX: 56,
  mouthY: 20,
  mouthRx: 48,
  mouthRy: 13,
  baseY: 116,
  baseRx: 36,
  baseRy: 9,
} as const

export interface BinPlacement {
  /** Centre of the bin's mouth on screen. */
  x: number
  y: number
  scale: number
}

/** Mirrors the bin's spot in PaperNotes.css: at the right edge, level with the middle of the balls. */
export function binPlacement(viewport: Viewport, middle: number): BinPlacement {
  const compact = viewport.width <= 600
  const scale = compact ? 0.68 : viewport.width <= 1099 ? 0.88 : 1
  return {
    x: viewport.width - (compact ? 46 : viewport.width <= 1099 ? 96 : 124),
    y: middle - 36 * scale,
    scale,
  }
}

/** Whether a point on screen is over the bin's mouth or body. */
export function isOverBin(point: Vec, bin: BinPlacement): boolean {
  const { mouthRx, mouthY, baseY } = BIN_DRAWING
  return Math.abs(point.x - bin.x) <= (mouthRx + 14) * bin.scale
    && point.y >= bin.y - 56 * bin.scale
    && point.y <= bin.y + (baseY - mouthY + 12) * bin.scale
}

/** How much a ball of `diameter`, held `lift` high, must shrink to pass through the bin's mouth. */
export function binFit(bin: BinPlacement, diameter: number, lift = BIN_RIM_LIFT): number {
  return Math.min(1, (BIN_DRAWING.mouthRx * 2 * bin.scale * 0.9) / Math.max(1, diameter * (1 + lift)))
}

/** Where a ball of `radius` on screen arrives so its underside just meets the front of the rim. */
export function binArrival(bin: BinPlacement, radius: number): Vec {
  return { x: bin.x, y: bin.y + BIN_DRAWING.mouthRy * bin.scale - radius }
}

/** How far a ball must sink from its arrival to vanish behind the front of the bin. */
export function binSinkDepth(radius: number, finalRadius: number): number {
  return radius + finalRadius + 3
}

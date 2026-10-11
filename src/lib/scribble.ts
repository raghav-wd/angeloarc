export type ScribblePoint = readonly [x: number, y: number]

/** One line of a task's name, as the box its letters sit in. */
export interface ScribbleLine {
  left: number
  right: number
  top: number
  bottom: number
}

/** An open line the pencil or the eraser travels along. */
export interface ScribbleStroke {
  points: readonly ScribblePoint[]
  /** Distance along the stroke at each point. */
  stops: readonly number[]
  length: number
}

// The zig-zag stays low and loose, mostly within the lowercase letters, so a
// crossed-out name can still be read through it. Fractions of the line box.
export const SCRIBBLE_TOP = 0.33
export const SCRIBBLE_BOTTOM = 0.79
// Each stroke of the zig-zag moves this far along the line, and peaks lean
// forward a little, the way a quick hand writes.
const STEP = [7.5, 10] as const
const LEAN = 1.4
const OVERSHOOT = [1.6, 3.6] as const
// Every turn is rounded off by a share of the strokes either side of it.
const TURN = [0.14, 0.26] as const
const TURN_STEPS = 4
// The eraser rubs back and forth about once every this many pixels.
const RUB_SPAN = 24
const RUB_MARGIN = 4.5
const RUB_SAMPLES = 24

/** A stable 32-bit seed from a few labels, so one task scribbles the same way every time it is drawn. */
export function scribbleSeed(...parts: ReadonlyArray<string | number>): number {
  let hash = 0x811c9dc5
  const text = parts.join('\u001f')
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** A small seeded generator of numbers in [0, 1). */
export function createRandom(seed: number): () => number {
  if (!Number.isFinite(seed)) throw new Error('A scribble seed must be a finite number.')
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function validLines(lines: readonly ScribbleLine[]): void {
  for (const { left, right, top, bottom } of lines) {
    if (![left, right, top, bottom].every(Number.isFinite) || right < left || bottom <= top) {
      throw new Error('Scribble lines need finite boxes with their right and bottom past their left and top.')
    }
  }
}

export function measureStroke(points: readonly ScribblePoint[]): ScribbleStroke {
  if (points.length === 0) throw new Error('A stroke needs at least one point.')
  const stops = [0]
  for (let index = 1; index < points.length; index += 1) {
    const [x, y] = points[index]
    const [lastX, lastY] = points[index - 1]
    stops.push(stops[index - 1] + Math.hypot(x - lastX, y - lastY))
  }
  return { points, stops, length: stops[stops.length - 1] }
}

function rounded(value: number): number {
  return Number(value.toFixed(2))
}

/** SVG path data for a stroke. */
export function strokePath(stroke: ScribbleStroke): string {
  return stroke.points
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${rounded(x)} ${rounded(y)}`)
    .join(' ')
}

/** The point a given distance along a stroke, and the unit direction of travel there. */
export function pointAlong(stroke: ScribbleStroke, distance: number): { point: ScribblePoint; heading: ScribblePoint } {
  if (!Number.isFinite(distance)) throw new Error('A distance along a stroke must be finite.')
  const { points, stops, length } = stroke
  const reach = Math.min(length, Math.max(0, distance))
  if (points.length === 1) return { point: points[0], heading: [1, 0] }
  let low = 0
  let high = points.length - 1
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if (stops[middle] <= reach) low = middle
    else high = middle
  }
  const [x, y] = points[low]
  const [nextX, nextY] = points[high]
  const span = stops[high] - stops[low]
  const amount = span < 1e-9 ? 0 : (reach - stops[low]) / span
  const heading: ScribblePoint = span < 1e-9 ? [1, 0] : [(nextX - x) / span, (nextY - y) / span]
  return { point: [x + (nextX - x) * amount, y + (nextY - y) * amount], heading }
}

function roundTurns(corners: readonly ScribblePoint[], random: () => number): ScribblePoint[] {
  const points: ScribblePoint[] = [corners[0]]
  for (let index = 1; index < corners.length - 1; index += 1) {
    const [lastX, lastY] = corners[index - 1]
    const [x, y] = corners[index]
    const [nextX, nextY] = corners[index + 1]
    const share = TURN[0] + (TURN[1] - TURN[0]) * random()
    const from: ScribblePoint = [x + (lastX - x) * share, y + (lastY - y) * share]
    const to: ScribblePoint = [x + (nextX - x) * share, y + (nextY - y) * share]
    for (let step = 0; step <= TURN_STEPS; step += 1) {
      const t = step / TURN_STEPS
      const a = (1 - t) ** 2
      const b = 2 * (1 - t) * t
      const c = t ** 2
      points.push([a * from[0] + b * x + c * to[0], a * from[1] + b * y + c * to[1]])
    }
  }
  points.push(corners[corners.length - 1])
  return points
}

function zigzag(line: ScribbleLine, random: () => number): ScribbleStroke {
  const between = (min: number, max: number) => min + (max - min) * random()
  const height = line.bottom - line.top
  const top = line.top + height * SCRIBBLE_TOP
  const bottom = line.top + height * SCRIBBLE_BOTTOM
  const reach = bottom - top
  const end = line.right + between(...OVERSHOOT)
  let x = line.left - between(...OVERSHOOT)
  let drift = 0
  // Most hands start a scribble with an upstroke.
  let up = random() < 0.7
  const corners: ScribblePoint[] = [[x, top + reach * between(0.35, 0.65)]]
  while (x < end) {
    let step = between(...STEP)
    // The last stroke stretches to the end rather than leaving a stub after it.
    if (end - (x + step) < STEP[0] / 2) step = end - x
    x += step
    // The whole zig-zag wanders a little up and down as it goes.
    drift = Math.min(0.09, Math.max(-0.09, drift + between(-0.06, 0.06)))
    const y = up ? top + reach * (between(-0.08, 0.16) + drift) : bottom - reach * (between(-0.08, 0.16) - drift)
    corners.push([x + (up ? LEAN : 0), y])
    up = !up
  }
  return measureStroke(roundTurns(corners, random))
}

function lineRandom(seed: number, index: number, salt: number): () => number {
  return createRandom((seed ^ salt) + Math.imul(index + 1, 0x9e3779b9))
}

/** A hand-drawn zig-zag through each line of text, from just before it to just after it. */
export function scribbleStrokes(lines: readonly ScribbleLine[], seed: number): ScribbleStroke[] {
  validLines(lines)
  return lines.map((line, index) => zigzag(line, lineRandom(seed, index, 0x2c1b3c6d)))
}

// Dismantle cuts a kept task instead: one long, low cut rising through the
// whole line, then one or two short steep ones across it, all leaning the
// same way like the strokes of one blade. They stay inside the line box, where
// the eraser can lift them. Fractions of the line box.
export const SLASH_TOP = 0.12
export const SLASH_BOTTOM = 0.9
// Each cut is over in a flash; a blade does not dawdle.
export const SLASH_PACE: StrokePace = { base: 45, speed: 2.6 }

function slashes(line: ScribbleLine, random: () => number): ScribbleStroke[] {
  const between = (min: number, max: number) => min + (max - min) * random()
  const height = line.bottom - line.top
  const width = line.right - line.left
  const high = line.top + height * SLASH_TOP
  const low = line.top + height * SLASH_BOTTOM
  const cuts = [
    measureStroke([
      [line.left - between(3, 7), line.top + height * between(0.68, 0.82)],
      [line.right + between(4, 9), line.top + height * between(0.22, 0.36)],
    ]),
  ]
  const steep = width > 150 ? 2 : width > 40 ? 1 : 0
  for (let index = 0; index < steep; index += 1) {
    const at = line.left + width * (steep === 1 ? between(0.55, 0.75) : index === 0 ? between(0.18, 0.34) : between(0.62, 0.8))
    const run = height * between(0.55, 0.95)
    cuts.push(measureStroke([[at + run / 2, high], [at - run / 2, low]]))
  }
  return cuts
}

/** Cuts through each line of text: the long one first, then the short ones across it. */
export function slashStrokes(lines: readonly ScribbleLine[], seed: number): ScribbleStroke[] {
  validLines(lines)
  return lines.flatMap((line, index) => slashes(line, lineRandom(seed, index, 0x7f4a7c15)))
}

/** How wide the eraser's rubbing has to be to lift a line's cuts completely. */
export function slashEraserWidth(line: ScribbleLine): number {
  return (line.bottom - line.top) * (SLASH_BOTTOM - SLASH_TOP) + 9
}

function rub(line: ScribbleLine, random: () => number): ScribbleStroke {
  const height = line.bottom - line.top
  const middle = line.top + height * ((SCRIBBLE_TOP + SCRIBBLE_BOTTOM) / 2)
  const start = line.left - RUB_MARGIN
  const width = line.right + RUB_MARGIN - start
  const rubs = Math.max(2, Math.round(width / RUB_SPAN))
  // Back and forth far enough to go over the same ground twice.
  const swing = Math.min(11, Math.max(5, (width / rubs) * 0.62))
  const sway = height * 0.06
  const phase = random() * Math.PI * 2
  const samples = rubs * RUB_SAMPLES
  const points: ScribblePoint[] = []
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples
    const turn = Math.PI * 2 * rubs * t
    points.push([
      start + width * t + swing * Math.sin(turn),
      middle + sway * Math.sin(turn * 2 + phase) + height * 0.04 * Math.sin(Math.PI * t + phase),
    ])
  }
  return measureStroke(points)
}

/** The path an eraser rubs along to take each line's scribble away: back and forth, working along the line. */
export function eraserStrokes(lines: readonly ScribbleLine[], seed: number): ScribbleStroke[] {
  validLines(lines)
  return lines.map((line, index) => rub(line, lineRandom(seed, index, 0x5bd1e995)))
}

/** How wide the eraser's rubbing has to be to lift a line's scribble completely. */
export function eraserWidth(line: ScribbleLine): number {
  return (line.bottom - line.top) * (SCRIBBLE_BOTTOM - SCRIBBLE_TOP) + 7
}

/** Distances along a stroke where it turns back on itself sideways, where crumbs fly off an eraser. */
export function strokeTurns(stroke: ScribbleStroke): number[] {
  const turns: number[] = []
  let direction = 0
  for (let index = 1; index < stroke.points.length; index += 1) {
    const dx = stroke.points[index][0] - stroke.points[index - 1][0]
    if (Math.abs(dx) < 1e-6) continue
    const next = Math.sign(dx)
    if (direction !== 0 && next !== direction) turns.push(stroke.stops[index - 1])
    direction = next
  }
  return turns
}

export interface StrokePace {
  /** Time every stroke takes however short it is, in milliseconds. */
  base: number
  /** Pixels covered per millisecond on top of that. */
  speed: number
}

export const PENCIL_PACE: StrokePace = { base: 120, speed: 0.7 }
export const ERASER_PACE: StrokePace = { base: 110, speed: 0.78 }

type StrokeLeg =
  | { kind: 'travel'; from: ScribblePoint; to: ScribblePoint; start: number; duration: number }
  | { kind: 'stroke'; stroke: number; start: number; duration: number }

export interface StrokePlan {
  strokes: readonly ScribbleStroke[]
  legs: readonly StrokeLeg[]
  duration: number
}

/** Time to lift the tool from one place and set it down at another. */
export function travelDuration(from: ScribblePoint, to: ScribblePoint): number {
  const distance = Math.hypot(to[0] - from[0], to[1] - from[1])
  return Math.min(200, Math.max(90, 80 + distance * 0.4))
}

/**
 * Lays the strokes out in time: travelling from `from` to the first one when
 * given, along each stroke in turn, and lifting across to the next.
 */
export function planStrokes(
  strokes: readonly ScribbleStroke[],
  pace: StrokePace,
  from: ScribblePoint | null = null,
): StrokePlan {
  if (!Number.isFinite(pace.base) || pace.base < 0 || !Number.isFinite(pace.speed) || pace.speed <= 0) {
    throw new Error('A stroke pace needs a nonnegative base time and a positive speed.')
  }
  if (from && !from.every(Number.isFinite)) throw new Error('A stroke plan must start from a finite point.')
  const legs: StrokeLeg[] = []
  let time = 0
  let at = from
  strokes.forEach((stroke, index) => {
    const start = stroke.points[0]
    if (at) {
      const duration = travelDuration(at, start)
      legs.push({ kind: 'travel', from: at, to: start, start: time, duration })
      time += duration
    }
    const duration = pace.base + stroke.length / pace.speed
    legs.push({ kind: 'stroke', stroke: index, start: time, duration })
    time += duration
    at = stroke.points[stroke.points.length - 1]
  })
  return { strokes, legs, duration: time }
}

export interface StrokeFrame {
  /** How far along each stroke the tool has been. */
  drawn: number[]
  /** Where the tool is. */
  point: ScribblePoint
  /** The unit direction it is moving in. */
  heading: ScribblePoint
  /** True while the tool is on the paper rather than lifted between strokes. */
  touching: boolean
  /** How far through its current stroke or lift the tool is, from 0 to 1. */
  leg: number
  done: boolean
}

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2
}

/** Where everything stands `elapsed` milliseconds into a plan. */
export function strokeFrame(plan: StrokePlan, elapsed: number): StrokeFrame {
  if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error('Stroke timing must be a nonnegative number.')
  if (plan.strokes.length === 0) throw new Error('A stroke plan needs at least one stroke.')
  const drawn = plan.strokes.map(() => 0)
  for (const leg of plan.legs) {
    const t = leg.duration <= 0 ? 1 : Math.min(1, (elapsed - leg.start) / leg.duration)
    if (leg.kind === 'stroke') {
      const stroke = plan.strokes[leg.stroke]
      drawn[leg.stroke] = t >= 1 ? stroke.length : stroke.length * easeInOutSine(Math.max(0, t))
    }
    if (t >= 1 && leg !== plan.legs[plan.legs.length - 1]) continue
    if (leg.kind === 'travel') {
      const eased = easeInOutCubic(Math.max(0, t))
      const [fromX, fromY] = leg.from
      const [toX, toY] = leg.to
      const distance = Math.hypot(toX - fromX, toY - fromY)
      return {
        drawn,
        point: [fromX + (toX - fromX) * eased, fromY + (toY - fromY) * eased],
        heading: distance < 1e-9 ? [1, 0] : [(toX - fromX) / distance, (toY - fromY) / distance],
        touching: false,
        leg: Math.max(0, t),
        done: false,
      }
    }
    const { point, heading } = pointAlong(plan.strokes[leg.stroke], drawn[leg.stroke])
    return { drawn, point, heading, touching: true, leg: Math.max(0, t), done: t >= 1 }
  }
  const last = plan.strokes[plan.strokes.length - 1]
  return { drawn, ...pointAlong(last, last.length), touching: true, leg: 1, done: true }
}

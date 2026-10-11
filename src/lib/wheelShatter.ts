// Cutting the wheel to pieces, for Dismantle's sweep: blades rake round the
// rings, every tile a blade passes through is split along its line, and the
// pieces slip apart along their cuts and fall away. Pure and seeded, so a
// month always comes apart the same way and the geometry and timing can be
// tested; a canvas paints it (WheelShatterCanvas).
import { SWEEP_OUT_DURATION } from './radialSweep.ts'

export type Point = readonly [x: number, y: number]

/** A blade's path through the wheel; it is drawn from `from` to `to`. */
export interface WheelSlash {
  from: Point
  to: Point
  /** When it sets off, in ms after the sweep begins, and how long it takes to cross. */
  at: number
  travel: number
}

export interface WheelTile {
  polygon: readonly Point[]
  /** The middle of the tile's day, in degrees clockwise from the x axis. */
  angle: number
}

export interface Shard {
  /** The piece's outline. */
  points: Point[]
  /** What it turns about: its middle. */
  pivot: Point
  /** Where it slips to along its cut, then where it falls to (px), and how far it turns (degrees). */
  slide: Point
  fall: Point
  turn: number
}

export interface TileShatter {
  /** The tile whole, as it is until it is cut. */
  polygon: Point[]
  /** When the tile is cut, in ms after the sweep begins. */
  at: number
  shards: Shard[]
  /** Where it was cut, edge to edge. */
  seams: Array<readonly [Point, Point]>
  /** A blade of its own, for a tile none of the long ones crossed. */
  local: WheelSlash | null
}

export interface Split {
  /** The part on the side the line's normal points to, then the part behind it. */
  sides: readonly [Point[], Point[]]
  /** Where the line enters and leaves the polygon. */
  chord: readonly [Point, Point]
}

interface Line {
  point: Point
  /** Unit length. */
  direction: Point
}

/**
 * Once round the wheel takes this long in Dismantle (ms), a brisker pace than
 * the other themes, so every piece has fallen before the page changes. The
 * stylesheet sets the same `--sweep-stagger` for the rest of the page.
 */
export const SHATTER_STAGGER = 700
/** From the cut to the last of a tile's pieces falling out of sight (ms). */
export const SHARD_DURATION = 460
// No tile is cut later than this, so its pieces have gone before the page changes.
const LAST_CUT = SWEEP_OUT_DURATION - SHARD_DURATION - 20
// The days of the month fill this arc of the wheel, clockwise from the top;
// the rest is left for the habits' names.
const FIRST_DAY_ANGLE = -90
const LAST_DAY_ANGLE = 180
// A blade crosses the wheel at this many px per ms.
const BLADE_SPEED = 2.4
// No piece is smaller than this share of its tile, so nothing comes off as a sliver.
const MIN_PIECE = 0.12
// Two cuts through one tile cross at least this steeply (degrees).
const MIN_CROSSING = 22
const ARC_STEPS = 5

const round = (value: number) => Math.round(value * 100) / 100
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const radians = (degrees: number) => (degrees * Math.PI) / 180
const wrap = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180
const angleOf = (center: number, [x, y]: Point) => (Math.atan2(y - center, x - center) * 180) / Math.PI

/** When the sweep reaches an angle, in ms; an angle just before the top counts as the very start. */
function sweepTime(angle: number): number {
  return clamp((angle - FIRST_DAY_ANGLE) / 360, 0, 1) * SHATTER_STAGGER
}

/** A tile of the wheel as a polygon, its arcs sampled finely enough to look round. */
export function sectorPolygon(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
  steps = ARC_STEPS,
): Point[] {
  if (![cx, cy, innerRadius, outerRadius, startAngle, endAngle].every(Number.isFinite) || innerRadius < 0 || outerRadius <= innerRadius) {
    throw new Error('A wheel tile needs finite angles and radii, with the outer radius past the inner one.')
  }
  const at = (radius: number, step: number): Point => {
    const angle = radians(startAngle + ((endAngle - startAngle) * step) / steps)
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]
  }
  const points: Point[] = []
  for (let step = 0; step <= steps; step += 1) points.push(at(outerRadius, step))
  for (let step = steps; step >= 0; step -= 1) points.push(at(innerRadius, step))
  return points
}

export function polygonArea(points: readonly Point[]): number {
  let twice = 0
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index]
    const [x2, y2] = points[(index + 1) % points.length]
    twice += x1 * y2 - x2 * y1
  }
  return Math.abs(twice) / 2
}

export function polygonCentroid(points: readonly Point[]): Point {
  let twice = 0
  let cx = 0
  let cy = 0
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index]
    const [x2, y2] = points[(index + 1) % points.length]
    const cross = x1 * y2 - x2 * y1
    twice += cross
    cx += (x1 + x2) * cross
    cy += (y1 + y2) * cross
  }
  if (Math.abs(twice) < 1e-9) {
    const sum = points.reduce(([sx, sy], [x, y]) => [sx + x, sy + y], [0, 0])
    return [sum[0] / points.length, sum[1] / points.length]
  }
  return [cx / (3 * twice), cy / (3 * twice)]
}

/**
 * Splits a polygon along a straight line into the parts either side of it.
 * Null when the line misses it, only touches it, or would leave it in more
 * than two pieces.
 */
export function splitPolygon(points: readonly Point[], point: Point, direction: Point): Split | null {
  const [px, py] = point
  const [dx, dy] = direction
  // A corner exactly on the line counts as just in front of it, so a line
  // through corners still splits cleanly rather than slipping between them.
  const side = ([x, y]: Point) => {
    const value = -(x - px) * dy + (y - py) * dx
    return Math.abs(value) < 1e-9 ? 1e-9 : value
  }
  const front: Point[] = []
  const back: Point[] = []
  const crossings: Point[] = []
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]
    const b = points[(index + 1) % points.length]
    const sa = side(a)
    const sb = side(b)
    if (sa > 0) front.push(a)
    else back.push(a)
    if ((sa > 0 && sb < 0) || (sa < 0 && sb > 0)) {
      const t = sa / (sa - sb)
      const crossing: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      front.push(crossing)
      back.push(crossing)
      crossings.push(crossing)
    }
  }
  if (crossings.length !== 2 || front.length < 3 || back.length < 3) return null
  // A line along an edge leaves nothing on one side.
  const whole = polygonArea(points)
  if (polygonArea(front) < whole * 1e-6 || polygonArea(back) < whole * 1e-6) return null
  return { sides: [front, back], chord: [crossings[0], crossings[1]] }
}

/**
 * A blade between two points, drawn clockwise, the way the sweep goes, and
 * set off when the sweep reaches its first end. `around` is an angle near
 * the blade, so its ends are measured on the same side of the top.
 */
function slashBetween(center: number, ends: readonly [Point, Point], around: number, travel: number): WheelSlash {
  const [first, second] = ends
  const angles = ends.map((end) => around + wrap(angleOf(center, end) - around))
  const [from, to] = angles[1] >= angles[0] ? [first, second] : [second, first]
  return {
    from: [round(from[0]), round(from[1])],
    to: [round(to[0]), round(to[1])],
    at: Math.round(Math.min(LAST_CUT, sweepTime(Math.min(...angles)))),
    travel: Math.round(travel),
  }
}

/**
 * The blades that rake the wheel as it sweeps away, clockwise from the top
 * and spread evenly over the days. Most cross the rings at a slant; the rest
 * run along them.
 */
export function wheelSlashes(
  center: number,
  innerRadius: number,
  outerRadius: number,
  random: () => number,
  count: number,
): WheelSlash[] {
  if (![center, innerRadius, outerRadius].every(Number.isFinite) || innerRadius < 0 || outerRadius <= innerRadius) {
    throw new Error('Wheel slashes need a finite centre and an outer radius past the inner one.')
  }
  const band = outerRadius - innerRadius
  const span = LAST_DAY_ANGLE - FIRST_DAY_ANGLE - 4
  const total = Math.max(0, Math.floor(count))
  const slashes: WheelSlash[] = []
  for (let index = 0; index < total; index += 1) {
    const anchorAngle = FIRST_DAY_ANGLE + 2 + span * ((index + 0.15 + 0.7 * random()) / total)
    const across = random() < (band > 40 ? 0.7 : 0.4)
    const sign = random() < 0.5 ? -1 : 1
    const lean = across ? 14 + random() * 36 : 6 + random() * 22
    const radius = across ? innerRadius + band * (0.4 + random() * 0.2) : innerRadius + band * (0.12 + random() * 0.76)
    const heading = radians(across ? anchorAngle + sign * lean : anchorAngle + 90 + sign * lean)
    const length = across ? (band + 22) / Math.cos(radians(lean)) : Math.min(60 + random() * 70, band * 2 + 40)
    const anchor: Point = [center + radius * Math.cos(radians(anchorAngle)), center + radius * Math.sin(radians(anchorAngle))]
    const half: Point = [(Math.cos(heading) * length) / 2, (Math.sin(heading) * length) / 2]
    slashes.push(slashBetween(
      center,
      [[anchor[0] - half[0], anchor[1] - half[1]], [anchor[0] + half[0], anchor[1] + half[1]]],
      anchorAngle,
      clamp(length / BLADE_SPEED, 32, 120),
    ))
  }
  return slashes
}

function normalized([x, y]: Point): Point {
  const length = Math.hypot(x, y) || 1
  return [x / length, y / length]
}

function lineOf(slash: WheelSlash): Line {
  return { point: slash.from, direction: normalized([slash.to[0] - slash.from[0], slash.to[1] - slash.from[1]]) }
}

/** `point` moved `distance` further away from `other`. */
function extend(point: Point, other: Point, distance: number): Point {
  const [dx, dy] = normalized([point[0] - other[0], point[1] - other[1]])
  return [point[0] + dx * distance, point[1] + dy * distance]
}

/**
 * How one piece leaves its tile: the piece above the cut slips down along it,
 * the one below gives a little the other way, then both drop and turn as
 * they fall.
 */
function shardMotion(piece: readonly Point[], primary: Line, secondary: Line | null, random: () => number): Shard {
  const centroid = polygonCentroid(piece)
  const [dx, dy] = primary.direction
  let normal: Point = [-dy, dx]
  if (normal[1] > 0 || (normal[1] === 0 && normal[0] > 0)) normal = [-normal[0], -normal[1]]
  const upper = (centroid[0] - primary.point[0]) * normal[0] + (centroid[1] - primary.point[1]) * normal[1] >= 0
  let downhill: Point = dy >= 0 ? [dx, dy] : [-dx, -dy]
  if (Math.abs(dy) < 0.18 && random() < 0.5) downhill = [-downhill[0], -downhill[1]]
  const slip = upper ? 4 + random() * 3.5 : -(0.8 + random() * 1.2)
  const part = upper ? 1 + random() * 1.1 : -(0.5 + random() * 0.7)
  let slideX = downhill[0] * slip + normal[0] * part
  let slideY = downhill[1] * slip + normal[1] * part
  if (secondary) {
    const [sx, sy] = secondary.direction
    const across: Point = [-sy, sx]
    const behind = (centroid[0] - secondary.point[0]) * across[0] + (centroid[1] - secondary.point[1]) * across[1] >= 0 ? 1 : -1
    const push = behind * (0.6 + random() * 0.8)
    slideX += across[0] * push
    slideY += across[1] * push
  }
  const drift = downhill[0] * (upper ? 4 + random() * 5 : -(1 + random() * 2)) + (random() - 0.5) * 2
  const drop = upper ? 17 + random() * 9 : 12 + random() * 7
  const lean = Math.sign(downhill[0]) || 1
  return {
    points: piece.map(([x, y]) => [round(x), round(y)] as const),
    pivot: [round(centroid[0]), round(centroid[1])],
    slide: [round(slideX), round(slideY)],
    fall: [round(slideX + drift), round(slideY + drop)],
    turn: round(upper ? lean * (5 + random() * 7) : -lean * (2 + random() * 3)),
  }
}

function crossingAngle(a: Line, b: Line): number {
  const dot = Math.abs(a.direction[0] * b.direction[0] + a.direction[1] * b.direction[1])
  return (Math.acos(Math.min(1, dot)) * 180) / Math.PI
}

/** Splits a piece along a line, but only into pieces big enough to see. */
function cleanSplit(piece: readonly Point[], line: Line, tileArea: number): Split | null {
  const split = splitPolygon(piece, line.point, line.direction)
  if (!split || split.sides.some((side) => polygonArea(side) < tileArea * MIN_PIECE)) return null
  return split
}

/**
 * Plans how each tile comes apart: split along the blades that pass through
 * it (two at most, so it falls in four pieces at most), as the first of them
 * reaches it. A tile no blade crossed gets a short cut of its own, made as
 * the sweep reaches its day.
 */
export function shatterTiles(
  center: number,
  tiles: readonly WheelTile[],
  slashes: readonly WheelSlash[],
  random: () => number,
): TileShatter[] {
  const lines = slashes.map(lineOf)
  const lengths = slashes.map((slash) => Math.hypot(slash.to[0] - slash.from[0], slash.to[1] - slash.from[1]))
  return tiles.map((tile) => {
    const area = polygonArea(tile.polygon)
    const middle = polygonCentroid(tile.polygon)
    const size = Math.max(...tile.polygon.map(([x, y]) => Math.hypot(x - middle[0], y - middle[1])))
    const crossings: Array<{ line: Line; time: number }> = []
    slashes.forEach((slash, index) => {
      const line = lines[index]
      const [dx, dy] = line.direction
      const along = (middle[0] - slash.from[0]) * dx + (middle[1] - slash.from[1]) * dy
      const off = Math.abs(-(middle[0] - slash.from[0]) * dy + (middle[1] - slash.from[1]) * dx)
      if (off > size || along < -size || along > lengths[index] + size) return
      const split = cleanSplit(tile.polygon, line, area)
      if (!split) return
      const [[ax, ay], [bx, by]] = split.chord
      const reach = (((ax + bx) / 2 - slash.from[0]) * dx + ((ay + by) / 2 - slash.from[1]) * dy) / lengths[index]
      // The blade must actually reach across this tile, not just its line.
      if (reach < -0.02 || reach > 1.02) return
      crossings.push({ line, time: slash.at + slash.travel * clamp(reach, 0, 1) })
    })
    crossings.sort((a, b) => a.time - b.time)

    let pieces: Point[][] = [[...tile.polygon]]
    const seams: Array<readonly [Point, Point]> = []
    const used: Array<{ line: Line; time: number }> = []
    for (const crossing of crossings) {
      if (used.length === 2) break
      if (used.length === 1 && crossingAngle(used[0].line, crossing.line) < MIN_CROSSING) continue
      const next: Point[][] = []
      const cut: Array<readonly [Point, Point]> = []
      for (const piece of pieces) {
        const split = cleanSplit(piece, crossing.line, area)
        if (split) {
          next.push(...split.sides)
          cut.push(split.chord)
        } else {
          next.push(piece)
        }
      }
      if (cut.length === 0) continue
      pieces = next
      seams.push(...cut)
      used.push(crossing)
    }

    let local: WheelSlash | null = null
    if (used.length === 0) {
      const sign = random() < 0.5 ? -1 : 1
      for (let attempt = 0; attempt < 8 && used.length === 0; attempt += 1) {
        const heading = radians(tile.angle + sign * (25 + random() * 35))
        const direction: Point = [Math.cos(heading), Math.sin(heading)]
        const shift = (random() - 0.5) * size * 0.3
        const point: Point = [middle[0] - direction[1] * shift, middle[1] + direction[0] * shift]
        const split = cleanSplit(tile.polygon, { point, direction }, area)
        if (!split) continue
        const [a, b] = split.chord
        // The blade starts and ends just beyond the tile's edges.
        local = slashBetween(center, [extend(a, b, 6), extend(b, a, 6)], tile.angle, 36)
        pieces = [...split.sides]
        seams.push(split.chord)
        used.push({ line: { point, direction }, time: local.at + local.travel / 2 })
      }
    }

    const primary = used[0]?.line ?? { point: middle, direction: [1, 0] as Point }
    const secondary = used[1]?.line ?? null
    return {
      polygon: tile.polygon.map(([x, y]) => [round(x), round(y)] as const),
      at: Math.round(Math.min(LAST_CUT, used[0]?.time ?? sweepTime(tile.angle))),
      shards: pieces.map((piece) => shardMotion(piece, primary, secondary, random)),
      seams: seams.map(([[ax, ay], [bx, by]]) => [[round(ax), round(ay)], [round(bx), round(by)]] as const),
      local,
    }
  })
}

// ——— Timing: where everything is, so many ms in ———

/** A CSS-style cubic Bézier easing curve. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const at = (a: number, b: number, t: number) => ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t
  const slope = (a: number, b: number, t: number) => 3 * (1 - 3 * b + 3 * a) * t * t + 2 * (3 * b - 6 * a) * t + 3 * a
  return (progress) => {
    if (progress <= 0) return 0
    if (progress >= 1) return 1
    let t = progress
    for (let step = 0; step < 6; step += 1) {
      const error = at(x1, x2, t) - progress
      const gradient = slope(x1, x2, t)
      if (Math.abs(error) < 1e-5 || Math.abs(gradient) < 1e-6) break
      t = clamp(t - error / gradient, 0, 1)
    }
    return at(y1, y2, t)
  }
}

// Cut, a beat, a clean slip along the cut, then the fall.
const HOLD = 0.15
const SLIP_END = 0.46
const FADE_FROM = 0.7
const slip = cubicBezier(0.32, 0, 0.18, 1)
const fall = cubicBezier(0.55, 0, 0.9, 0.5)
const streak = cubicBezier(0.3, 0, 0.7, 1)
/** How long a blade's streak takes to run its path, against how long the blade takes to cut. */
export const BLADE_STREAK = 1.35

export interface ShardPose {
  x: number
  y: number
  /** Degrees. */
  rotate: number
  opacity: number
}

/** Where a piece is `local` ms after its tile was cut. */
export function shardPose(shard: Shard, local: number): ShardPose {
  const progress = clamp(local / SHARD_DURATION, 0, 1)
  if (progress < HOLD) return { x: 0, y: 0, rotate: 0, opacity: 1 }
  if (progress < SLIP_END) {
    const amount = slip((progress - HOLD) / (SLIP_END - HOLD))
    return { x: shard.slide[0] * amount, y: shard.slide[1] * amount, rotate: shard.turn * 0.12 * amount, opacity: 1 }
  }
  const amount = fall((progress - SLIP_END) / (1 - SLIP_END))
  const opacity = progress < FADE_FROM
    ? 1 - 0.1 * ((progress - SLIP_END) / (FADE_FROM - SLIP_END))
    : 0.9 * (1 - ((progress - FADE_FROM) / (1 - FADE_FROM)) ** 1.6)
  return {
    x: shard.slide[0] + (shard.fall[0] - shard.slide[0]) * amount,
    y: shard.slide[1] + (shard.fall[1] - shard.slide[1]) * amount,
    rotate: shard.turn * (0.12 + 0.88 * amount),
    opacity: Math.max(0, opacity),
  }
}

export interface SeamStyle {
  /** How far from white-hot to blood red, 0 to 1. */
  heat: number
  width: number
  opacity: number
}

/** A cut's line `local` ms after it was made: a white hairline, opening red as the pieces part, then gone. */
export function seamStyle(local: number): SeamStyle | null {
  const progress = local / SHARD_DURATION
  if (progress < 0 || progress >= 0.62) return null
  if (progress < HOLD) return { heat: 0, width: 0.5 + 0.2 * (progress / HOLD), opacity: 1 }
  if (progress < 0.4) {
    const amount = (progress - HOLD) / (0.4 - HOLD)
    return { heat: amount * 0.75, width: 0.7 + 0.9 * amount, opacity: 1 - 0.1 * amount }
  }
  const amount = (progress - 0.4) / (0.62 - 0.4)
  return { heat: 0.75 + 0.25 * amount, width: 1.6 + 0.4 * amount, opacity: 0.9 * (1 - amount) }
}

/**
 * The stretch of a blade's path its streak of light covers `elapsed` ms into
 * the sweep, as fractions along it from `from` (tail first); null while it is
 * not on the path.
 */
export function bladeStreak(slash: WheelSlash, elapsed: number): readonly [number, number] | null {
  const progress = (elapsed - slash.at) / (slash.travel * BLADE_STREAK)
  if (progress <= 0 || progress >= 1) return null
  const tail = -0.32 + 1.34 * streak(progress)
  const head = tail + 0.3
  if (head <= 0 || tail >= 1) return null
  return [Math.max(0, tail), Math.min(1, head)]
}

/** When the last of the wheel has gone, in ms after the sweep begins. */
export function shatterEnd(tiles: readonly TileShatter[], slashes: readonly WheelSlash[]): number {
  let end = 0
  for (const tile of tiles) end = Math.max(end, tile.at + SHARD_DURATION)
  for (const slash of slashes) end = Math.max(end, slash.at + slash.travel * BLADE_STREAK)
  return end
}

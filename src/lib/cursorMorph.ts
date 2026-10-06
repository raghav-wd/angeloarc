export const CURSOR_MORPH_DURATION = 560
export const CURSOR_SHAPE_MORPH_DURATION = 280

export type CursorPoint = readonly [x: number, y: number]
export type CursorContour = readonly CursorPoint[]
/** One or more closed, clockwise outlines drawn as a single filled path. */
export type CursorShape = readonly CursorContour[]
export type CursorMode = 'pointer' | 'grab' | 'switch'

// Matching clockwise vertices let the original outline deform without swapping icons.
const triangle: CursorContour = [
  [3, 2.5], [7.1, 5.4], [10.3, 7.4], [13.8, 10.1],
  [17.2, 12.1], [22.7, 16.1], [14.2, 17.2], [11.3, 26.8],
  [9.1, 20.1], [8.2, 16.3], [6.5, 12.3], [5.5, 8.1],
]

const cross: CursorContour = [
  [-5, -2.5], [-2.5, -5], [3, 0.5], [8.5, -5],
  [11, -2.5], [5.5, 3], [11, 8.5], [8.5, 11],
  [3, 5.5], [-2.5, 11], [-5, 8.5], [0.5, 3],
]

function arc(cx: number, cy: number, radius: number, from: number, to: number, steps: number): CursorPoint[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = from + ((to - from) * index) / steps
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius] as const
  })
}

// A grabbing hand, drawn on a 24-unit grid: four knuckles across the top, the
// thumb tucked in on the left and a rounded palm. It is centred on the
// hotspot so the hand closes around whatever sits under the pointer.
const hand: CursorContour = [
  [6, 14],
  ...arc(8, 9, 2, Math.PI, Math.PI * 2, 4),
  [10, 9.9],
  ...arc(12, 8, 2, Math.PI, Math.PI * 2, 4),
  [14, 9.7],
  ...arc(16, 9, 2, Math.PI, Math.PI * 2, 4),
  [18, 11.6],
  ...arc(20, 11, 2, Math.PI, Math.PI * 2, 4),
  ...arc(14, 14, 8, 0, Math.PI / 2, 5),
  ...arc(10, 14, 8, Math.PI / 2, Math.PI * 0.86, 4),
  [3.5, 16.3],
  ...arc(3.3, 12.6, 2.1, Math.PI * 0.78, Math.PI * 2, 6),
].map(([x, y]) => [3 + (x - 12) * 1.12, 3 + (y - 15) * 1.12] as const)

// Two opposing arrows: this one goes there, that one comes here.
const switchOut: CursorContour = [
  [-5.5, -3.3], [6.2, -3.3], [6.2, -6], [11.6, -1.6], [6.2, 2.8], [6.2, 0.1], [-5.5, 0.1],
]
const switchBack: CursorContour = [
  [11.5, 5.9], [11.5, 9.3], [-0.2, 9.3], [-0.2, 12], [-5.6, 7.6], [-0.2, 3.2], [-0.2, 5.9],
]

export const CURSOR_MODE_SHAPES: Readonly<Record<CursorMode, CursorShape>> = {
  pointer: [triangle],
  grab: [hand],
  switch: [switchOut, switchBack],
}

function rounded(value: number): number {
  return Number(value.toFixed(3))
}

function isCollapsed(contour: CursorContour): boolean {
  const [x, y] = contour[0]
  return contour.every(([nextX, nextY]) => Math.abs(nextX - x) < 0.01 && Math.abs(nextY - y) < 0.01)
}

/** SVG path data for a shape; outlines that have shrunk to a point are left out. */
export function cursorShapePath(shape: CursorShape): string {
  return shape
    .filter((contour) => contour.length > 1 && !isCollapsed(contour))
    .map((contour) => contour
      .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${rounded(x)} ${rounded(y)}`)
      .join(' ') + ' Z')
    .join(' ')
}

/** The pointer triangle part of the way to the rejection cross, vertex by vertex. */
export function cursorMorphShape(progress: number): CursorShape {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new Error('Cursor morph progress must be between 0 and 1.')
  }
  return [triangle.map(([x, y], index) => {
    const [targetX, targetY] = cross[index]
    return [x + (targetX - x) * progress, y + (targetY - y) * progress] as const
  })]
}

export function cursorMorphPath(progress: number): string {
  return cursorShapePath(cursorMorphShape(progress))
}

export function cursorMorphProgress(elapsed: number, from = 0): number {
  if (!Number.isFinite(elapsed) || elapsed < 0 || !Number.isFinite(from) || from < 0 || from > 1) {
    throw new Error('Cursor morph timing and starting progress must be valid nonnegative values.')
  }
  if (elapsed < 180) {
    return from + (1 - from) * (1 - (1 - elapsed / 180) ** 3)
  }
  if (elapsed <= 320) return 1
  if (elapsed >= CURSOR_MORPH_DURATION) return 0
  const t = (elapsed - 320) / (CURSOR_MORPH_DURATION - 320)
  const eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2
  return 1 - eased
}

interface Walk {
  points: CursorContour
  /** Distance along the outline at each vertex. */
  stops: number[]
  length: number
}

function walk(points: CursorContour): Walk {
  const stops: number[] = []
  let length = 0
  points.forEach(([x, y], index) => {
    stops.push(length)
    const [nextX, nextY] = points[(index + 1) % points.length]
    length += Math.hypot(nextX - x, nextY - y)
  })
  return { points, stops, length }
}

function pointAt({ points, stops, length }: Walk, t: number): CursorPoint {
  if (length < 1e-9) return points[0]
  const distance = t * length
  let index = points.length - 1
  for (let next = 1; next < points.length; next += 1) {
    if (distance < stops[next]) {
      index = next - 1
      break
    }
  }
  const start = stops[index]
  const end = index === points.length - 1 ? length : stops[index + 1]
  const [x, y] = points[index]
  const [nextX, nextY] = points[(index + 1) % points.length]
  const amount = end - start < 1e-9 ? 0 : (distance - start) / (end - start)
  return [x + (nextX - x) * amount, y + (nextY - y) * amount]
}

function centroid(contour: CursorContour): CursorContour {
  const x = contour.reduce((sum, [pointX]) => sum + pointX, 0) / contour.length
  const y = contour.reduce((sum, [, pointY]) => sum + pointY, 0) / contour.length
  return [[x, y]]
}

// Both outlines are walked by the same fraction of their length. Every corner
// of either outline becomes a shared vertex, so each end of the morph is exact.
function align(from: CursorContour, to: CursorContour): [CursorPoint[], CursorPoint[]] {
  const source = walk(from)
  const target = walk(to)
  const fractions = [source, target]
    .flatMap(({ stops, length }) => (length < 1e-9 ? [0] : stops.map((stop) => stop / length)))
    .sort((a, b) => a - b)
    .filter((fraction, index, sorted) => index === 0 || fraction - sorted[index - 1] > 1e-6)
  return [fractions.map((fraction) => pointAt(source, fraction)), fractions.map((fraction) => pointAt(target, fraction))]
}

/**
 * Pairs every point of one shape with a point on another so the outline can
 * flow continuously between them. An outline without a partner grows out of,
 * or shrinks into, its own centre.
 */
export function createCursorMorph(from: CursorShape, to: CursorShape): (progress: number) => CursorShape {
  const pairs: Array<[CursorPoint[], CursorPoint[]]> = []
  for (let index = 0; index < Math.max(from.length, to.length); index += 1) {
    const source = from[index] ?? centroid(to[index])
    const target = to[index] ?? centroid(from[index])
    pairs.push(align(source, target))
  }
  return (progress) => {
    if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
      throw new Error('Cursor morph progress must be between 0 and 1.')
    }
    return pairs.map(([source, target]) => source.map(([x, y], index) => {
      const [targetX, targetY] = target[index]
      return [x + (targetX - x) * progress, y + (targetY - y) * progress] as const
    }))
  }
}

export function cursorShapeEase(progress: number): number {
  const t = Math.min(1, Math.max(0, progress))
  return 1 - (1 - t) ** 3
}

export const TRIANGLE_CURSOR_PATH = cursorMorphPath(0)
export const CROSS_CURSOR_PATH = cursorMorphPath(1)

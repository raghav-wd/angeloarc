// Paper balls settle around the middle of the page in recognisable shapes: a
// single ball sits dead centre, three make a triangle, seven make a hexagon.
// Rows are centred, so neighbouring rows of different lengths interlock the way
// real balls pack together.

export interface ClusterArea {
  width: number
  height: number
  /** Highest point (px) a ball may reach, below the page heading. */
  top: number
  /** Lowest point (px) a ball's caption may reach, above the page footer. */
  bottom: number
  /** Clear space (px) kept free at both sides for the edge controls. */
  inset: number
}

export interface ClusterPoint {
  x: number
  y: number
}

export interface ClusterLayout {
  shape: string
  positions: ClusterPoint[]
  center: ClusterPoint
  ball: number
  labelWidth: number
  scale: number
}

interface ClusterPattern {
  shape: string
  rows: number[][]
  designed: boolean
}

export const BALL_SIZE = 84
export const BALL_SPACING_X = 176
export const BALL_SPACING_Y = 158
export const LABEL_WIDTH = 150
export const LABEL_GAP = 12
export const LABEL_HEIGHT = 40
const MIN_SCALE = 0.42

function centeredRow(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index - (count - 1) / 2)
}

function rowsOf(counts: readonly number[]): number[][] {
  return counts.map(centeredRow)
}

const DESIGNED_PATTERNS: Readonly<Record<number, readonly Omit<ClusterPattern, 'designed'>[]>> = {
  1: [{ shape: 'center', rows: rowsOf([1]) }],
  2: [{ shape: 'pair', rows: rowsOf([2]) }, { shape: 'stack', rows: rowsOf([1, 1]) }],
  3: [{ shape: 'triangle', rows: rowsOf([1, 2]) }],
  4: [{ shape: 'diamond', rows: rowsOf([1, 2, 1]) }, { shape: 'square', rows: rowsOf([2, 2]) }],
  5: [{ shape: 'cross', rows: rowsOf([2, 1, 2]) }, { shape: 'house', rows: rowsOf([2, 3]) }],
  6: [{ shape: 'ring', rows: [[-0.5, 0.5], [-1, 1], [-0.5, 0.5]] }, { shape: 'pyramid', rows: rowsOf([1, 2, 3]) }],
  7: [{ shape: 'hexagon', rows: rowsOf([2, 3, 2]) }],
  8: [{ shape: 'hourglass', rows: rowsOf([3, 2, 3]) }],
  9: [{ shape: 'square', rows: rowsOf([3, 3, 3]) }],
  10: [{ shape: 'hexagon', rows: rowsOf([3, 4, 3]) }, { shape: 'tall-hexagon', rows: rowsOf([2, 3, 3, 2]) }],
  11: [{ shape: 'hourglass', rows: rowsOf([4, 3, 4]) }],
  12: [{ shape: 'grid', rows: rowsOf([4, 4, 4]) }, { shape: 'tall-grid', rows: rowsOf([3, 3, 3, 3]) }],
}

function gridPattern(count: number, columns: number): ClusterPattern {
  const counts: number[] = []
  for (let remaining = count; remaining > 0; remaining -= columns) counts.push(Math.min(columns, remaining))
  return { shape: `grid-${columns}`, rows: rowsOf(counts), designed: false }
}

export function clusterPatterns(count: number): ClusterPattern[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('A cluster needs a positive whole number of balls.')
  }
  const designed = (DESIGNED_PATTERNS[count] ?? []).map((pattern) => ({ ...pattern, designed: true }))
  const grids = [1, 2, 3, 4, 5, 6].filter((columns) => columns <= count).map((columns) => gridPattern(count, columns))
  return [...designed, ...grids]
}

function patternFit(pattern: ClusterPattern, availableWidth: number, availableHeight: number): number {
  const xs = pattern.rows.flat()
  const span = Math.max(...xs) - Math.min(...xs)
  const width = span * BALL_SPACING_X + LABEL_WIDTH
  const height = (pattern.rows.length - 1) * BALL_SPACING_Y + BALL_SIZE + LABEL_GAP + LABEL_HEIGHT
  return Math.min(1, availableWidth / width, availableHeight / height)
}

/** Places `count` balls around the centre of `area`, scaled down only when they would not fit. */
export function layoutCluster(count: number, area: ClusterArea): ClusterLayout {
  if (![area.width, area.height, area.top, area.bottom, area.inset].every(Number.isFinite)) {
    throw new Error('A cluster area needs finite measurements.')
  }
  const availableWidth = Math.max(1, area.width - area.inset * 2)
  const availableHeight = Math.max(1, area.bottom - area.top)
  let best: ClusterPattern | null = null
  let bestScore = -Infinity
  let bestFit = 1
  for (const pattern of clusterPatterns(count)) {
    const fit = patternFit(pattern, availableWidth, availableHeight)
    // Designed shapes win unless a plain grid lets the balls stay noticeably larger.
    const score = fit * (pattern.designed ? 1 : 0.9)
    if (score > bestScore + 1e-9) {
      best = pattern
      bestScore = score
      bestFit = fit
    }
  }
  if (!best) throw new Error('No cluster pattern is available.')

  const scale = Math.max(MIN_SCALE, bestFit)
  const spacingX = BALL_SPACING_X * scale
  const spacingY = BALL_SPACING_Y * scale
  const ball = BALL_SIZE * scale
  const captionDrop = (LABEL_GAP + LABEL_HEIGHT) * scale
  const center = { x: area.width / 2, y: (area.top + area.bottom) / 2 }
  // Centre the balls and their captions together, not just the balls.
  const firstRowY = center.y - captionDrop / 2 - ((best.rows.length - 1) * spacingY) / 2
  const positions = best.rows.flatMap((row, rowIndex) =>
    row.map((x) => ({ x: center.x + x * spacingX, y: firstRowY + rowIndex * spacingY })),
  )
  return {
    shape: best.shape,
    positions,
    center: { x: center.x, y: firstRowY + ((best.rows.length - 1) * spacingY) / 2 },
    ball,
    labelWidth: LABEL_WIDTH * scale,
    scale,
  }
}

export interface BallDrop {
  /** Milliseconds after the drop begins that this ball starts to fall. */
  start: number
  /** Where the ball first strikes the page before bouncing into place. */
  impact: ClusterPoint
  /** The ball's resting spot in the cluster. */
  rest: ClusterPoint
  /** Strength of the first impact, 0.8 to 1.2. */
  force: number
}

export const DROP_FALL_DURATION = 430
export const DROP_BOUNCE_DURATION = 380
export const DROP_MAX_STAGGER = 520

/**
 * Balls strike the page around their resting spots, scattered outwards, then
 * hop inwards to settle. The centre-most balls fall first.
 */
export function planDrop(
  layout: Pick<ClusterLayout, 'positions' | 'center' | 'ball'>,
  viewport: { width: number; height: number },
  random: () => number,
): BallDrop[] {
  const count = layout.positions.length
  if (count === 0) return []
  const margin = Math.max(24, layout.ball * 0.6)
  const order = layout.positions
    .map((point, index) => ({
      index,
      key: Math.hypot(point.x - layout.center.x, point.y - layout.center.y) + random() * layout.ball * 0.8,
    }))
    .sort((a, b) => a.key - b.key)
  const stagger = count === 1 ? 0 : Math.min(85, DROP_MAX_STAGGER / (count - 1))
  const drops: BallDrop[] = new Array(count)
  order.forEach(({ index }, rank) => {
    const rest = layout.positions[index]
    let angle = Math.atan2(rest.y - layout.center.y, rest.x - layout.center.x)
    if (Math.hypot(rest.x - layout.center.x, rest.y - layout.center.y) < 1) angle = random() * Math.PI * 2
    angle += (random() - 0.5) * 0.9
    const distance = layout.ball * (0.9 + random() * 1.25)
    drops[index] = {
      start: Math.round(rank * stagger),
      impact: {
        x: Math.min(viewport.width - margin, Math.max(margin, rest.x + Math.cos(angle) * distance)),
        y: Math.min(viewport.height - margin, Math.max(margin, rest.y + Math.sin(angle) * distance)),
      },
      rest,
      force: 0.8 + random() * 0.4,
    }
  })
  return drops
}

export function dropDuration(drops: readonly BallDrop[]): number {
  return drops.reduce((latest, drop) => Math.max(latest, drop.start + DROP_FALL_DURATION + DROP_BOUNCE_DURATION), 0)
}

/** How far a ball at `from` must roll along `angle` to leave the viewport completely. */
export function exitDistance(
  from: ClusterPoint,
  angle: number,
  viewport: { width: number; height: number },
  radius: number,
): number {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const limits: number[] = []
  if (dx > 1e-6) limits.push((viewport.width + radius - from.x) / dx)
  if (dx < -1e-6) limits.push((-radius - from.x) / dx)
  if (dy > 1e-6) limits.push((viewport.height + radius - from.y) / dy)
  if (dy < -1e-6) limits.push((-radius - from.y) / dy)
  return Math.max(0, Math.min(...limits)) + radius
}

/**
 * How far a group of balls must roll sideways, all together, so that every
 * one of them is off screen. Rolling the same distance keeps their spacing,
 * so the group travels as one. `direction` 1 rolls right; -1 measures how far
 * to the left a group must start to roll in from off screen.
 */
export function groupRollDistance(
  points: readonly ClusterPoint[],
  width: number,
  radius: number,
  direction: 1 | -1,
): number {
  if (points.length === 0) return 0
  const reach = points.map((point) => (direction > 0 ? width + radius - point.x : point.x + radius))
  return Math.max(0, ...reach) + radius
}

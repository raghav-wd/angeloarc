// Dismantle: the theme's cuts, blood, embers and burning paper. The geometry is
// pure and seeded so it can be tested; the spawners only touch the DOM in a browser.
const round = (value: number) => Number(value.toFixed(2))

/**
 * A cut shaped like the stroke of a blade, lying along the x axis around the
 * origin: pointed at both ends, fullest a little before the middle and fuller
 * on its leading edge.
 */
export function bladePath(length: number, width: number): string {
  if (!(length > 0) || !(width > 0)) throw new Error('A cut needs a positive length and width.')
  const half = length / 2
  return `M${round(-half)} 0Q${round(-half * 0.25)} ${round(-width * 1.4)} ${round(half)} 0Q${round(-half * 0.1)} ${round(width * 0.6)} ${round(-half)} 0Z`
}

export interface BackdropCut {
  /** Where the cut sits, as fractions of the page. */
  x: number
  y: number
  /** Sideways shift from that point in pixels, for cuts made side by side. */
  shift: number
  angle: number
  length: number
  width: number
  /** Seconds between glows, and how far into that cycle the cut starts. */
  period: number
  delay: number
}

/**
 * Old scars across the page: single cuts and little sets of two or three made
 * side by side, mostly rising, kept clear of the wheel in the middle. Each set
 * catches the light now and then on its own slow cycle.
 */
export function backdropCuts(random: () => number, count = 16): BackdropCut[] {
  const cuts: BackdropCut[] = []
  const total = Math.max(0, Math.floor(count))
  while (cuts.length < total) {
    let x = 0.5
    let y = 0.5
    for (let attempt = 0; attempt < 24; attempt += 1) {
      x = 0.03 + random() * 0.94
      y = 0.05 + random() * 0.9
      // Keep clear of the wheel, an ellipse round the middle of the page.
      if (((x - 0.5) / 0.27) ** 2 + ((y - 0.53) / 0.42) ** 2 > 1) break
    }
    const rising = random() < 0.72
    const angle = (rising ? -1 : 1) * (24 + random() * 36)
    const strokes = random() < 0.42 ? 1 : random() < 0.7 ? 2 : 3
    const length = 110 + random() * 220
    const period = 14 + random() * 14
    const delay = -random() * period
    const gap = 11 + random() * 9
    for (let stroke = 0; stroke < strokes && cuts.length < total; stroke += 1) {
      cuts.push({
        x: round(x),
        y: round(y),
        shift: round((stroke - (strokes - 1) / 2) * gap),
        angle: round(angle + (random() - 0.5) * 5),
        length: round(length * (1 - stroke * 0.14) * (0.9 + random() * 0.2)),
        width: round(1.4 + random() * 1.8),
        period: round(period),
        delay: round(delay - stroke * 0.09),
      })
    }
  }
  return cuts
}

export const SLASH_BURST_SHAPES = ['drop', 'spark', 'drop', 'shard', 'drop', 'spark'] as const

export type SlashBurstShape = (typeof SLASH_BURST_SHAPES)[number]

export interface SlashBurstPiece {
  dx: number
  dy: number
  rotate: number
  scale: number
  delay: number
  shape: SlashBurstShape
}

export interface SlashBurstCut {
  angle: number
  length: number
  delay: number
}

export const SLASH_BURST_SIZE = 10
const SLASH_BURST_LIFETIME = 1100

/** Two crossing cuts through a kept promise: the first falls to the left, the second answers it. */
export function slashBurstCuts(random: () => number): SlashBurstCut[] {
  const first = -(28 + random() * 26)
  const second = first + 72 + random() * 34
  return [
    { angle: round(first), length: round(46 + random() * 16), delay: 0 },
    { angle: round(second), length: round(38 + random() * 14), delay: 70 },
  ]
}

/**
 * Drops of blood, sparks and a sliver or two flung out along the cut, more
 * of them up than down, which then fall away.
 */
export function slashBurstPieces(count: number, random: () => number, along = -40): SlashBurstPiece[] {
  const total = Math.max(0, Math.floor(count))
  const axis = (along * Math.PI) / 180
  return Array.from({ length: total }, (_, index) => {
    const side = index % 2 === 0 ? 1 : -1
    const angle = axis + (side < 0 ? Math.PI : 0) + (random() - 0.5) * 1.3
    const distance = 18 + random() * 30
    return {
      dx: Math.round(Math.cos(angle) * distance),
      dy: Math.round(Math.sin(angle) * distance * 0.8 - 6),
      rotate: Math.round((angle * 180) / Math.PI),
      scale: Math.round((0.7 + random() * 0.6) * 100) / 100,
      delay: Math.round(20 + random() * 60),
      shape: SLASH_BURST_SHAPES[index % SLASH_BURST_SHAPES.length],
    }
  })
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** A promise kept, Dismantle style: two quick cuts, a flash and a spray of blood. */
export function spawnSlashBurst(x: number, y: number, random: () => number = Math.random): void {
  if (typeof document === 'undefined' || !Number.isFinite(x) || !Number.isFinite(y)) return
  if (reducedMotion()) return
  const burst = document.createElement('div')
  burst.className = 'slash-burst'
  burst.setAttribute('aria-hidden', 'true')
  burst.style.left = `${Math.round(x)}px`
  burst.style.top = `${Math.round(y)}px`
  const cuts = slashBurstCuts(random)
  for (const cut of cuts) {
    const element = document.createElement('i')
    element.className = 'slash-burst-cut'
    element.style.setProperty('--angle', `${cut.angle}deg`)
    element.style.setProperty('--length', `${cut.length}px`)
    element.style.setProperty('--delay', `${cut.delay}ms`)
    burst.append(element)
  }
  for (const piece of slashBurstPieces(SLASH_BURST_SIZE, random, cuts[0].angle)) {
    const element = document.createElement('i')
    element.className = `slash-burst-piece is-${piece.shape}`
    element.style.setProperty('--dx', String(piece.dx))
    element.style.setProperty('--dy', String(piece.dy))
    element.style.setProperty('--rotate', String(piece.rotate))
    element.style.setProperty('--scale', String(piece.scale))
    element.style.setProperty('--delay', `${piece.delay}ms`)
    burst.append(element)
  }
  document.body.append(burst)
  window.setTimeout(() => burst.remove(), SLASH_BURST_LIFETIME)
}

// ——— Fire ———

/**
 * How fiercely a note burns as it drops: a lick of flame high up that grows
 * as it nears the page, a flare as it hits, then dying back within a second.
 */
export function fireIntensity(sinceDrop: number, fallDuration: number): number {
  if (!Number.isFinite(sinceDrop) || sinceDrop < 0) return 0
  if (sinceDrop < fallDuration) {
    const progress = sinceDrop / Math.max(1, fallDuration)
    return Math.round((0.2 + 0.6 * progress * progress) * 1000) / 1000
  }
  const after = sinceDrop - fallDuration
  const value = Math.exp(-after / 340) * (1 + 0.55 * Math.exp(-after / 80))
  return value < 0.01 ? 0 : Math.round(value * 1000) / 1000
}

export interface BurnShape {
  harmonics: ReadonlyArray<readonly [frequency: number, amplitude: number, phase: number, drift: number]>
  /** The wobble of the charred band just outside the hole. */
  char: ReadonlyArray<readonly [frequency: number, phase: number]>
}

const BURN_HARMONICS = [
  [3, 0.13],
  [5, 0.085],
  [8, 0.055],
  [13, 0.04],
  [21, 0.026],
  [34, 0.016],
] as const

/** The ragged edge one burn hole will have, the same for the same seed. */
export function burnShape(random: () => number): BurnShape {
  return {
    harmonics: BURN_HARMONICS.map(([frequency, amplitude]) => [
      frequency,
      amplitude * (0.7 + random() * 0.6),
      random() * Math.PI * 2,
      (random() - 0.5) * 0.012,
    ] as const),
    char: [
      [4, random() * Math.PI * 2],
      [11, random() * Math.PI * 2],
    ],
  }
}

/** How far a hole of the given size reaches in one direction; its outline crawls as it grows. */
export function burnRadiusAt(shape: BurnShape, angle: number, radius: number): number {
  if (radius <= 0) return 0
  let wobble = 0
  for (const [frequency, amplitude, phase, drift] of shape.harmonics) {
    wobble += amplitude * Math.sin(frequency * angle + phase + radius * drift)
  }
  return Math.max(0, radius * (1 + wobble))
}

/**
 * The outline of a burn hole as SVG path data, optionally grown outwards by
 * `band` pixels for the charred and glowing rings round it. Every outline
 * winds the same way, so many of them in one path fill as their union.
 */
export function burnOutline(x: number, y: number, shape: BurnShape, radius: number, band = 0, steps = 84): string {
  if (radius <= 0 && band <= 0) return ''
  const points: string[] = []
  for (let step = 0; step < steps; step += 1) {
    const angle = (step / steps) * Math.PI * 2
    let reach = burnRadiusAt(shape, angle, radius)
    if (band > 0) {
      const [[f1, p1], [f2, p2]] = shape.char
      const ripple = 0.5 + 0.32 * Math.sin(f1 * angle + p1) + 0.18 * Math.sin(f2 * angle + p2)
      reach += band * (0.55 + ripple * 0.9)
    }
    points.push(`${round(x + Math.cos(angle) * reach)} ${round(y + Math.sin(angle) * reach)}`)
  }
  return `M${points.join('L')}Z`
}

// How long a fresh burn takes to eat its first bite, and how fast it creeps
// on afterwards (px per ms) until the whole page goes up.
export const BURN_IGNITE = 520
export const BURN_CREEP = 0.045

const easeOutCubic = (value: number) => 1 - (1 - value) ** 3
const easeInCubic = (value: number) => value ** 3

/**
 * How big one burn hole is `elapsed` ms into the burn: nothing until it
 * catches, a quick first bite, a slow creep, then swallowed up in the blaze
 * that takes the whole page (`sweep` running 0 to 1, out to `reach`).
 */
export function burnRadius(spot: { start: number; radius: number }, elapsed: number, sweep: number, reach: number): number {
  const local = elapsed - spot.start
  const bite = local <= 0 ? 0 : spot.radius * easeOutCubic(Math.min(1, local / BURN_IGNITE)) + Math.max(0, local - BURN_IGNITE) * BURN_CREEP
  return bite + reach * easeInCubic(Math.min(1, Math.max(0, sweep)))
}

export interface EmberPiece {
  dx: number
  dy: number
  size: number
  delay: number
  duration: number
}

/** Sparks thrown up and out as a burning note hits the page. */
export function emberPieces(count: number, random: () => number, spread = 1): EmberPiece[] {
  const total = Math.max(0, Math.floor(count))
  return Array.from({ length: total }, (_, index) => {
    const angle = -Math.PI / 2 + ((index / Math.max(1, total)) - 0.5) * Math.PI * 1.7 + (random() - 0.5) * 0.4
    const distance = (26 + random() * 46) * spread
    return {
      dx: Math.round(Math.cos(angle) * distance),
      dy: Math.round(Math.sin(angle) * distance - 10 * spread),
      size: Math.round((1.4 + random() * 2.2) * 10) / 10,
      delay: Math.round(random() * 70),
      duration: Math.round(520 + random() * 420),
    }
  })
}

/** A spray of embers where a burning note lands. */
export function spawnEmbers(x: number, y: number, size = 84, random: () => number = Math.random): void {
  if (typeof document === 'undefined' || !Number.isFinite(x) || !Number.isFinite(y)) return
  if (reducedMotion()) return
  const burst = document.createElement('div')
  burst.className = 'ember-burst'
  burst.setAttribute('aria-hidden', 'true')
  burst.style.left = `${Math.round(x)}px`
  burst.style.top = `${Math.round(y)}px`
  burst.style.setProperty('--size', `${Math.round(size)}px`)
  for (const piece of emberPieces(12, random, Math.max(0.6, size / 84))) {
    const ember = document.createElement('i')
    ember.className = 'ember-burst-piece'
    ember.style.setProperty('--dx', String(piece.dx))
    ember.style.setProperty('--dy', String(piece.dy))
    ember.style.setProperty('--ember', `${piece.size}px`)
    ember.style.setProperty('--delay', `${piece.delay}ms`)
    ember.style.setProperty('--duration', `${piece.duration}ms`)
    burst.append(ember)
  }
  document.body.append(burst)
  window.setTimeout(() => burst.remove(), 1200)
}

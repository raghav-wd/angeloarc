export const BERRY_BURST_SHAPES = ['seed', 'heart', 'petal', 'seed', 'sparkle', 'petal', 'seed', 'heart'] as const

export type BerryBurstShape = (typeof BERRY_BURST_SHAPES)[number]

export interface BerryBurstPiece {
  dx: number
  dy: number
  rotate: number
  scale: number
  delay: number
  shape: BerryBurstShape
}

export const BERRY_BURST_SIZE = 11
const BERRY_BURST_LIFETIME = 1100

// Seeds, petals and little hearts spring out all the way round, a touch more
// upwards than down, before they drift and fade.
export function berryBurstPieces(count: number, random: () => number): BerryBurstPiece[] {
  const total = Math.max(0, Math.floor(count))
  const turn = random() * Math.PI * 2
  return Array.from({ length: total }, (_, index) => {
    const angle = turn + (index / total) * Math.PI * 2 + (random() - 0.5) * 0.5
    const distance = 20 + random() * 26
    return {
      dx: Math.round(Math.cos(angle) * distance),
      dy: Math.round(Math.sin(angle) * distance * 0.85 - 7),
      rotate: Math.round((random() - 0.5) * 320),
      scale: Math.round((0.7 + random() * 0.5) * 100) / 100,
      delay: Math.round(random() * 50),
      shape: BERRY_BURST_SHAPES[index % BERRY_BURST_SHAPES.length],
    }
  })
}

/** A little shower of seeds and petals at a point on screen, once a promise is kept. */
export function spawnBerryBurst(x: number, y: number, random: () => number = Math.random): void {
  if (typeof document === 'undefined' || !Number.isFinite(x) || !Number.isFinite(y)) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const burst = document.createElement('div')
  burst.className = 'berry-burst'
  burst.setAttribute('aria-hidden', 'true')
  burst.style.left = `${Math.round(x)}px`
  burst.style.top = `${Math.round(y)}px`
  for (const piece of berryBurstPieces(BERRY_BURST_SIZE, random)) {
    const element = document.createElement('i')
    element.className = `berry-burst-piece is-${piece.shape}`
    element.style.setProperty('--dx', String(piece.dx))
    element.style.setProperty('--dy', String(piece.dy))
    element.style.setProperty('--rotate', String(piece.rotate))
    element.style.setProperty('--scale', String(piece.scale))
    element.style.setProperty('--delay', `${piece.delay}ms`)
    burst.append(element)
  }
  document.body.append(burst)
  window.setTimeout(() => burst.remove(), BERRY_BURST_LIFETIME)
}

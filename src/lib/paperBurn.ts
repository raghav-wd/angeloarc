// The homepage burning away like paper, for Dismantle's notes to self. Each
// burning note eats a ragged hole where it lands; the holes creep, then the
// whole page goes up. The page itself is hidden through a live SVG mask, and
// a canvas over it draws what a burning edge looks like: brown scorch, black
// char, a glowing line of embers and sparks lifting off it.
import { burnOutline, burnRadius, burnRadiusAt } from './dismantle.ts'
import type { BurnShape } from './dismantle.ts'

export interface BurnSpot {
  x: number
  y: number
  /** When it catches, in ms after the burn begins. */
  start: number
  /** The size of the first bite. */
  radius: number
  shape: BurnShape
}

export interface PaperBurn {
  /** Draws the burn as it stands `now`; true once the page is gone. */
  frame(now: number, viewport: { width: number; height: number }): boolean
  /** Takes the mask off the page and the fire off the canvas. */
  dispose(): void
}

interface Ember {
  x: number
  y: number
  vx: number
  vy: number
  born: number
  life: number
  size: number
}

const SVG = 'http://www.w3.org/2000/svg'
// Outermost first, each drawn over the last and the hole cut out at the end.
const RINGS = [
  { band: 30, colour: 'rgba(40, 14, 6, 0.5)' },
  { band: 16, colour: 'rgba(7, 2, 1, 0.94)' },
  { band: 7.5, colour: 'rgba(255, 66, 20, 0.96)' },
  { band: 2.8, colour: 'rgba(255, 218, 150, 1)' },
] as const
const MAX_EMBERS = 170
let burns = 0

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

export function createPaperBurn({
  layers,
  canvas,
  spots,
  origin,
  sweepStart,
  sweepDuration,
  random,
}: {
  layers: readonly HTMLElement[]
  canvas: HTMLCanvasElement | null
  spots: readonly BurnSpot[]
  origin: number
  sweepStart: number
  sweepDuration: number
  random: () => number
}): PaperBurn {
  burns += 1
  const id = `paper-burn-${burns}`
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.style.position = 'absolute'
  const mask = document.createElementNS(SVG, 'mask')
  mask.setAttribute('id', id)
  mask.setAttribute('maskUnits', 'userSpaceOnUse')
  mask.setAttribute('maskContentUnits', 'userSpaceOnUse')
  const paper = document.createElementNS(SVG, 'rect')
  paper.setAttribute('fill', 'white')
  const holes = document.createElementNS(SVG, 'path')
  holes.setAttribute('fill', 'black')
  mask.append(paper, holes)
  svg.append(mask)

  // Put on at the start of every frame, not once: React's development checks
  // unmount and remount effects straight away, which would otherwise leave
  // the fire drawing over a page that never burns.
  function attach() {
    if (!svg.isConnected) document.body.append(svg)
    for (const { style } of layers) {
      if (style.getPropertyValue('mask-image')) continue
      style.setProperty('-webkit-mask-image', `url(#${id})`)
      style.setProperty('mask-image', `url(#${id})`)
    }
  }

  const context = canvas?.getContext('2d') ?? null
  const embers: Ember[] = []
  let size = { width: 0, height: 0, ratio: 1 }
  let last = 0

  function fit(viewport: { width: number; height: number }) {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
    if (size.width === viewport.width && size.height === viewport.height && size.ratio === ratio) return
    size = { ...viewport, ratio }
    for (const node of [mask, paper]) {
      node.setAttribute('x', '0')
      node.setAttribute('y', '0')
      node.setAttribute('width', String(viewport.width))
      node.setAttribute('height', String(viewport.height))
    }
    if (canvas) {
      canvas.width = Math.round(viewport.width * ratio)
      canvas.height = Math.round(viewport.height * ratio)
    }
  }

  function outlines(radii: readonly number[], band: number, flicker: number): string {
    return spots
      .map((spot, index) => (radii[index] > 0 ? burnOutline(spot.x, spot.y, spot.shape, radii[index], band * flicker * (1 + radii[index] / 900)) : ''))
      .join('')
  }

  function frame(now: number, viewport: { width: number; height: number }): boolean {
    attach()
    fit(viewport)
    const elapsed = now - origin
    const sweep = clamp01((elapsed - sweepStart) / sweepDuration)
    const reach = Math.hypot(viewport.width, viewport.height) * 1.6
    const radii = spots.map((spot) => burnRadius(spot, elapsed, sweep, reach))
    holes.setAttribute('d', outlines(radii, 0, 1))
    const fade = clamp01((sweep - 0.72) / 0.28)
    for (const { style } of layers) style.opacity = String(1 - fade)

    if (context && canvas) {
      const dt = last ? Math.min(48, now - last) : 16
      last = now
      context.setTransform(size.ratio, 0, 0, size.ratio, 0, 0)
      context.clearRect(0, 0, viewport.width, viewport.height)
      const flicker = 0.88 + 0.24 * Math.sin(now / 37) * Math.sin(now / 91)
      context.globalCompositeOperation = 'source-over'
      for (const ring of RINGS) {
        context.fillStyle = ring.colour
        context.fill(new Path2D(outlines(radii, ring.band, flicker)))
      }
      context.globalCompositeOperation = 'destination-out'
      context.fill(new Path2D(outlines(radii, 0, 1)))

      // Sparks lift off the burning line and drift up as they die.
      if (sweep < 0.85) {
        const burning = spots.map((_, index) => index).filter((index) => radii[index] > 4)
        const spawn = burning.length === 0 ? 0 : Math.min(7, 2 + burning.length)
        for (let count = 0; count < spawn && embers.length < MAX_EMBERS; count += 1) {
          const index = burning[Math.floor(random() * burning.length)]
          const spot = spots[index]
          const angle = random() * Math.PI * 2
          const reachAt = burnRadiusAt(spot.shape, angle, radii[index])
          embers.push({
            x: spot.x + Math.cos(angle) * reachAt,
            y: spot.y + Math.sin(angle) * reachAt,
            vx: Math.cos(angle) * 0.03 + (random() - 0.5) * 0.04,
            vy: -0.05 - random() * 0.09,
            born: now,
            life: 380 + random() * 520,
            size: 0.8 + random() * 1.8,
          })
        }
      }
      context.globalCompositeOperation = 'lighter'
      for (let index = embers.length - 1; index >= 0; index -= 1) {
        const ember = embers[index]
        const age = (now - ember.born) / ember.life
        if (age >= 1) {
          embers.splice(index, 1)
          continue
        }
        ember.x += ember.vx * dt
        ember.y += ember.vy * dt
        ember.vy -= 0.00008 * dt
        const glow = 1 - age
        context.fillStyle = `rgba(255, ${Math.round(120 + 110 * glow)}, ${Math.round(60 * glow)}, ${(0.9 * glow).toFixed(3)})`
        context.beginPath()
        context.arc(ember.x, ember.y, ember.size * (0.6 + 0.4 * glow), 0, Math.PI * 2)
        context.fill()
      }
      context.globalCompositeOperation = 'source-over'
    }

    const done = elapsed >= sweepStart + sweepDuration
    if (done) context?.clearRect(0, 0, viewport.width, viewport.height)
    return done
  }

  function dispose() {
    for (const { style } of layers) {
      style.removeProperty('-webkit-mask-image')
      style.removeProperty('mask-image')
      style.removeProperty('opacity')
    }
    if (context && canvas) context.clearRect(0, 0, canvas.width, canvas.height)
    svg.remove()
  }

  return { frame, dispose }
}

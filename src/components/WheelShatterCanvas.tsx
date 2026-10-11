import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { bladeStreak, seamStyle, SHARD_DURATION, shardPose, shatterEnd } from '../lib/wheelShatter'
import type { Point, TileShatter, WheelSlash } from '../lib/wheelShatter'

// How the blades and the cuts they leave are lit.
const BLADE_GLOW = 'rgba(255, 42, 58, 0.34)'
const BLADE_CORE = [255, 241, 242] as const
const SEAM_HOT = [255, 255, 255] as const
const SEAM_RED = [255, 36, 51] as const
const SEAM_DEEP = [179, 18, 31] as const
// Patterns are drawn this many times finer than the wheel's own units, so they stay sharp.
const PATTERN_SCALE = 3

interface Look {
  fill: string | CanvasGradient | CanvasPattern
  /** The faint old cuts in kept tiles, laid over their blood. */
  texture: CanvasPattern | null
  stroke: string
  lineWidth: number
}

interface Piece {
  path: Path2D
  pivot: Point
  shard: TileShatter['shards'][number]
}

/** An outline in the wheel's own units, so the blood and its texture line up with the page. */
function outline(points: readonly Point[]): Path2D {
  const path = new Path2D()
  points.forEach(([x, y], index) => {
    if (index === 0) path.moveTo(x, y)
    else path.lineTo(x, y)
  })
  path.closePath()
  return path
}

function mix(from: readonly number[], to: readonly number[], amount: number): string {
  const [r, g, b] = from.map((channel, index) => Math.round(channel + (to[index] - channel) * amount))
  return `rgb(${r}, ${g}, ${b})`
}

/** A repeating tile drawn by `draw` in the wheel's units, as a canvas pattern rotated by `angle` degrees. */
function pattern(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  angle: number,
  draw: (tile: CanvasRenderingContext2D) => void,
): CanvasPattern | null {
  const tile = document.createElement('canvas')
  tile.width = Math.round(width * PATTERN_SCALE)
  tile.height = Math.round(height * PATTERN_SCALE)
  const tileContext = tile.getContext('2d')
  if (!tileContext) return null
  tileContext.scale(PATTERN_SCALE, PATTERN_SCALE)
  draw(tileContext)
  const result = context.createPattern(tile, 'repeat')
  // SVG pattern tiles start at the user-space origin and rotate about it, as here.
  result?.setTransform(new DOMMatrix().rotate(angle).scale(1 / PATTERN_SCALE))
  return result
}

/**
 * Reads how each tile looks right now, so its pieces look exactly like it:
 * plain colours straight from the page, and the theme's blood and "not yet"
 * patterns rebuilt from the colours in the wheel's own definitions.
 */
function readLooks(
  context: CanvasRenderingContext2D,
  svg: SVGSVGElement,
  tiles: number,
  days: number,
  geometry: { center: number; innerRadius: number; outerRadius: number },
  ids: { blood: string; unavailable: string },
): Look[] {
  const stop = (selector: string) => {
    const element = svg.querySelector(selector)
    return element ? getComputedStyle(element).stopColor : ''
  }
  const blood = context.createRadialGradient(geometry.center, geometry.center, 0, geometry.center, geometry.center, geometry.outerRadius)
  const core = Math.min(0.95, geometry.innerRadius / geometry.outerRadius)
  blood.addColorStop(core, stop(`#${ids.blood}-blood .blood-core`) || '#e3192a')
  blood.addColorStop(1, stop(`#${ids.blood}-blood .blood-rim`) || '#7c0a13')

  const cut = svg.querySelector(`#${ids.blood}-cuts .blood-cut`)
  const faintCut = svg.querySelector(`#${ids.blood}-cuts .blood-cut.is-faint`)
  const cutStyle = cut ? getComputedStyle(cut) : null
  const texture = cutStyle
    ? pattern(context, 34, 23, -38, (tile) => {
      tile.strokeStyle = cutStyle.stroke
      tile.lineWidth = Number.parseFloat(cutStyle.strokeWidth) || 0.6
      tile.lineCap = 'round'
      tile.globalAlpha = Number(cutStyle.opacity)
      tile.beginPath()
      tile.moveTo(2, 6.5)
      tile.lineTo(19, 6.1)
      tile.stroke()
      tile.globalAlpha = faintCut ? Number(getComputedStyle(faintCut).opacity) : 0.16
      tile.beginPath()
      tile.moveTo(17, 17.2)
      tile.lineTo(32, 16.9)
      tile.stroke()
    })
    : null

  const ground = svg.querySelector(`#${ids.unavailable} .unavailable-ground`)
  const zigzag = svg.querySelector(`#${ids.unavailable} .unavailable-zigzag`)
  const notYet = ground && zigzag
    ? pattern(context, 8, 6, 0, (tile) => {
      tile.fillStyle = getComputedStyle(ground).fill
      tile.fillRect(0, 0, 8, 6)
      const style = getComputedStyle(zigzag)
      tile.strokeStyle = style.stroke
      tile.lineWidth = Number.parseFloat(style.strokeWidth) || 0.8
      tile.beginPath()
      tile.moveTo(-2, 4)
      for (const [x, y] of [[0, 2], [2, 4], [4, 2], [6, 4], [8, 2], [10, 4]]) tile.lineTo(x, y)
      tile.stroke()
    })
    : null

  return Array.from({ length: tiles }, (_, index) => {
    const cell = svg.querySelector(`[data-cell="${Math.floor(index / days)}-${(index % days) + 1}"]`)
    const style = cell ? getComputedStyle(cell) : null
    const painted = style?.fill ?? 'transparent'
    const kept = Boolean(cell?.classList.contains('is-done'))
    let fill: Look['fill'] = painted
    if (painted.startsWith('url(')) fill = (kept ? blood : notYet) ?? 'transparent'
    return {
      fill,
      texture: kept && painted.startsWith('url(') ? texture : null,
      stroke: style?.stroke ?? 'transparent',
      lineWidth: Number.parseFloat(style?.strokeWidth ?? '') || 0.65,
    }
  })
}

/**
 * The wheel cut to pieces, painted on a canvas laid exactly over the tracker
 * while it sweeps away. Its tiles hide the moment this takes over, so what it
 * paints first is the wheel just as it was; then blades streak round the
 * rings, and each tile they cut slips apart along its cuts and falls away.
 */
export function WheelShatterCanvas({
  svg,
  size,
  center,
  innerRadius,
  outerRadius,
  days,
  tiles,
  slashes,
  bloodId,
  unavailableId,
}: {
  svg: RefObject<SVGSVGElement | null>
  size: number
  center: number
  innerRadius: number
  outerRadius: number
  days: number
  tiles: readonly TileShatter[]
  slashes: readonly WheelSlash[]
  bloodId: string
  unavailableId: string
}) {
  const canvas = useRef<HTMLCanvasElement>(null)

  // Painted before the browser shows the hidden tiles, so nothing blinks.
  useLayoutEffect(() => {
    const element = canvas.current
    const tracker = svg.current
    const context = element?.getContext('2d')
    if (!element || !tracker || !context) return
    const width = element.clientWidth
    const height = element.clientHeight
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    element.width = Math.round(width * ratio)
    element.height = Math.round(height * ratio)
    // The tracker fits its square view box into the same box, centred.
    const scale = Math.min(width, height) / size
    const offsetX = (width - size * scale) / 2
    const offsetY = (height - size * scale) / 2
    const base = new DOMMatrix([ratio * scale, 0, 0, ratio * scale, ratio * offsetX, ratio * offsetY])

    const looks = readLooks(context, tracker, tiles.length, days, { center, innerRadius, outerRadius }, { blood: bloodId, unavailable: unavailableId })
    const wholes = tiles.map((tile) => outline(tile.polygon))
    const pieces: Piece[][] = tiles.map((tile) => tile.shards.map((shard) => ({ path: outline(shard.points), pivot: shard.pivot, shard })))
    const rings = new Path2D()
    rings.arc(center, center, outerRadius + 8, (-91.5 * Math.PI) / 180, (181.5 * Math.PI) / 180)
    rings.arc(center, center, Math.max(1, innerRadius - 4), (181.5 * Math.PI) / 180, (-91.5 * Math.PI) / 180, true)
    rings.closePath()
    const end = shatterEnd(tiles, slashes)
    const start = performance.now()
    let frame = 0

    function paint(path: Path2D, look: Look) {
      context!.fillStyle = look.fill
      context!.fill(path)
      if (look.texture) {
        context!.fillStyle = look.texture
        context!.fill(path)
      }
      context!.strokeStyle = look.stroke
      context!.lineWidth = look.lineWidth
      context!.stroke(path)
    }

    function draw(elapsed: number) {
      context!.setTransform(1, 0, 0, 1, 0, 0)
      context!.clearRect(0, 0, element!.width, element!.height)
      context!.setTransform(base)
      context!.lineJoin = 'round'
      context!.lineCap = 'round'

      tiles.forEach((tile, index) => {
        const local = elapsed - tile.at
        if (local < 0) {
          paint(wholes[index], looks[index])
          return
        }
        if (local >= SHARD_DURATION) return
        for (const piece of pieces[index]) {
          const pose = shardPose(piece.shard, local)
          if (pose.opacity <= 0.005) continue
          // Turned about its own middle; its fills move with it.
          const [px, py] = piece.pivot
          context!.globalAlpha = pose.opacity
          context!.setTransform(base)
          context!.translate(px + pose.x, py + pose.y)
          context!.rotate((pose.rotate * Math.PI) / 180)
          context!.translate(-px, -py)
          paint(piece.path, looks[index])
        }
        context!.setTransform(base)
        const seam = seamStyle(local)
        if (!seam) {
          context!.globalAlpha = 1
          return
        }
        context!.globalAlpha = seam.opacity
        context!.strokeStyle = seam.heat < 0.75
          ? mix(SEAM_HOT, SEAM_RED, seam.heat / 0.75)
          : mix(SEAM_RED, SEAM_DEEP, (seam.heat - 0.75) / 0.25)
        context!.lineWidth = seam.width
        context!.beginPath()
        for (const [[ax, ay], [bx, by]] of tile.seams) {
          context!.moveTo(ax, ay)
          context!.lineTo(bx, by)
        }
        context!.stroke()
        context!.globalAlpha = 1
      })

      // Blades streak along their paths, only over the rings.
      context!.save()
      context!.clip(rings)
      for (const slash of slashes) {
        const span = bladeStreak(slash, elapsed)
        if (!span) continue
        const [tail, head] = span
        const dx = slash.to[0] - slash.from[0]
        const dy = slash.to[1] - slash.from[1]
        const tailX = slash.from[0] + dx * tail
        const tailY = slash.from[1] + dy * tail
        const headX = slash.from[0] + dx * head
        const headY = slash.from[1] + dy * head
        context!.globalCompositeOperation = 'lighter'
        context!.strokeStyle = BLADE_GLOW
        context!.lineWidth = 2.8
        context!.beginPath()
        context!.moveTo(tailX, tailY)
        context!.lineTo(headX, headY)
        context!.stroke()
        context!.globalCompositeOperation = 'source-over'
        const light = context!.createLinearGradient(tailX, tailY, headX, headY)
        light.addColorStop(0, `rgba(${BLADE_CORE.join(', ')}, 0)`)
        light.addColorStop(0.7, `rgba(${BLADE_CORE.join(', ')}, 0.75)`)
        light.addColorStop(1, `rgba(${BLADE_CORE.join(', ')}, 1)`)
        context!.strokeStyle = light
        context!.lineWidth = 0.8
        context!.beginPath()
        context!.moveTo(tailX, tailY)
        context!.lineTo(headX, headY)
        context!.stroke()
      }
      context!.restore()
    }

    draw(0)
    function tick(now: number) {
      const elapsed = now - start
      draw(elapsed)
      frame = elapsed < end ? requestAnimationFrame(tick) : 0
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [bloodId, center, days, innerRadius, outerRadius, size, slashes, svg, tiles, unavailableId])

  return <canvas ref={canvas} className="wheel-shatter-canvas" aria-hidden="true" />
}

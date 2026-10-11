import { useEffectEvent, useId, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { claimCursorGuide } from '../lib/cursorMode'
import type { CursorGuideHandle } from '../lib/cursorMode'
import {
  createRandom,
  ERASER_PACE,
  eraserStrokes,
  eraserWidth,
  PENCIL_PACE,
  planStrokes,
  scribbleStrokes,
  SLASH_PACE,
  slashEraserWidth,
  slashStrokes,
  strokeFrame,
  strokePath,
  strokeTurns,
} from '../lib/scribble'
import type { ScribbleLine, ScribblePoint, ScribbleStroke, StrokeFrame, StrokePace } from '../lib/scribble'

export type TaskTool = 'pencil' | 'eraser'

/** Keeps the cursor's tool in step with the task under it. */
export interface TaskToolHand {
  /** Keeps the cursor as this tool while it works, whatever it passes over. */
  hold(owner: object, tool: TaskTool): void
  drop(owner: object): void
  /** Looks again at the task under the pointer, after one has changed. */
  sync(): void
}

export interface ScribbleRequest {
  tool: TaskTool
  /** Where the mouse clicked, in viewport pixels; the cursor itself does the work from there. */
  from: { x: number; y: number } | null
  /** When the click happened, so a click that changed nothing is soon forgotten. */
  at: number
}

// Lines that come and go without a hand on them, as the list arrives or the
// day changes, are drawn and rubbed out a little quicker.
const QUICK_PENCIL: StrokePace = { base: 110, speed: 0.85 }
const QUICK_ERASER: StrokePace = { base: 80, speed: 1.6 }
const QUICK_SLASH: StrokePace = { base: 40, speed: 3.4 }
const REQUEST_WINDOW = 1000
const FADE_DURATION = 180
const SVG = 'http://www.w3.org/2000/svg'

/** How a kept task is crossed out: a pencilled zig-zag, or Dismantle's cuts. */
export type StrikeStyle = 'scribble' | 'slash'

interface Generation {
  root: SVGGElement
  inks: SVGPathElement[]
  rubs: SVGPathElement[]
  lines: ScribbleLine[]
  strokes: ScribbleStroke[]
  rubStrokes: ScribbleStroke[]
  seed: number
  frame: number
  /** Ends the running animation where it stands. */
  stop: (() => void) | null
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function element<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number>) {
  const node = document.createElementNS(SVG, name)
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value))
  return node
}

/** Shows the first `drawn` pixels of a path. */
function reveal(path: SVGPathElement, length: number, drawn: number) {
  if (drawn <= 0.01) {
    path.style.visibility = 'hidden'
    return
  }
  path.style.visibility = ''
  if (drawn >= length - 0.01) {
    path.style.strokeDasharray = ''
    path.style.strokeDashoffset = ''
    return
  }
  path.style.strokeDasharray = `${length} ${length + 40}`
  path.style.strokeDashoffset = String(length - drawn)
}

function sameLines(a: readonly ScribbleLine[], b: readonly ScribbleLine[]): boolean {
  return a.length === b.length && a.every((line, index) => {
    const other = b[index]
    return Math.abs(line.left - other.left) < 0.5 && Math.abs(line.right - other.right) < 0.5 &&
      Math.abs(line.top - other.top) < 0.5 && Math.abs(line.bottom - other.bottom) < 0.5
  })
}

// The pencil leans into each line as it draws and lifts a little between
// them; the eraser rocks with every rub.
function toolTilt(tool: TaskTool, frame: StrokeFrame): number {
  if (!frame.touching) return -5 * Math.sin(Math.PI * frame.leg)
  if (tool === 'pencil') return 6 * Math.sin(Math.PI * frame.leg) + 1.5 * frame.heading[1]
  return 9 * frame.heading[0]
}

interface Painter {
  show(done: boolean, seed: number, request: ScribbleRequest | null, enterDelay: number): void
  relayout(): void
  dispose(): void
}

function createPainter(
  svg: SVGSVGElement,
  label: HTMLElement,
  name: HTMLElement,
  maskBase: string,
  hand: TaskToolHand,
  style: StrikeStyle,
): Painter {
  const crumbs = element('g', { class: 'today-task-crumbs' })
  svg.append(crumbs)
  let current: Generation | null = null
  const leaving = new Set<Generation>()
  let made = 0
  let shownDone: boolean | null = null
  let shownSeed = 0
  const cutting = style === 'slash'

  // A name on one line is cut in two along the long cut: CSS shows its halves
  // slid apart once the blade is through.
  function aimSlice(generation: Generation) {
    const first = generation.strokes[0]
    const width = label.offsetWidth
    const height = label.offsetHeight
    if (!cutting || generation.lines.length !== 1 || !first || width <= 0 || height <= 0) {
      delete label.dataset.slice
      return
    }
    const [[x0, y0], [x1, y1]] = [first.points[0], first.points[first.points.length - 1]]
    const slope = (y1 - y0) / (x1 - x0 || 1)
    const at = (x: number) => ((y0 + slope * (x - x0)) / height) * 100
    label.style.setProperty('--cut-left', `${at(0).toFixed(2)}%`)
    label.style.setProperty('--cut-right', `${at(width).toFixed(2)}%`)
    label.dataset.slice = 'ready'
  }

  function slice(generation: Generation, through: boolean) {
    if (!cutting || current !== generation || label.dataset.slice === undefined) return
    label.dataset.slice = through ? 'cut' : 'ready'
  }

  function heal() {
    if (label.dataset.slice === 'cut') label.dataset.slice = 'ready'
  }

  function placement() {
    const box = label.getBoundingClientRect()
    const scale = label.offsetWidth > 0 && box.width > 0 ? box.width / label.offsetWidth : 1
    return { left: box.left, top: box.top, scale }
  }

  // One box per line the name wraps onto, in the label's own pixels.
  function measure(): ScribbleLine[] {
    const { left, top, scale } = placement()
    const lines: ScribbleLine[] = []
    for (const rect of Array.from(name.getClientRects())) {
      if (rect.width < 0.5 || rect.height < 0.5) continue
      const line = {
        left: (rect.left - left) / scale,
        right: (rect.right - left) / scale,
        top: (rect.top - top) / scale,
        bottom: (rect.bottom - top) / scale,
      }
      const same = lines.find((other) => Math.abs(other.top - line.top) < 1)
      if (same) {
        same.left = Math.min(same.left, line.left)
        same.right = Math.max(same.right, line.right)
      } else {
        lines.push(line)
      }
    }
    return lines.sort((a, b) => a.top - b.top)
  }

  function build(seed: number, lines = measure()): Generation {
    const id = `${maskBase}-${made}`
    made += 1
    const margin = 30
    const left = Math.min(0, ...lines.map((line) => line.left)) - margin
    const top = Math.min(0, ...lines.map((line) => line.top)) - margin
    const right = Math.max(0, ...lines.map((line) => line.right)) + margin
    const bottom = Math.max(0, ...lines.map((line) => line.bottom)) + margin
    const area = { x: left, y: top, width: right - left, height: bottom - top }
    const strokes = cutting ? slashStrokes(lines, seed) : scribbleStrokes(lines, seed)
    const rubStrokes = eraserStrokes(lines, seed)
    const mask = element('mask', { id, maskUnits: 'userSpaceOnUse', ...area })
    mask.append(element('rect', { ...area, fill: 'white' }))
    const rubs = rubStrokes.map((stroke, index) => {
      const width = cutting ? slashEraserWidth(lines[index]) : eraserWidth(lines[index])
      const rub = element('path', { class: 'today-task-rub', d: strokePath(stroke), 'stroke-width': width })
      reveal(rub, stroke.length, 0)
      return rub
    })
    mask.append(...rubs)
    const ink = element('g', { mask: `url(#${id})` })
    const inks = strokes.map((stroke) => {
      const path = element('path', { class: 'today-task-ink', d: strokePath(stroke) })
      reveal(path, stroke.length, 0)
      return path
    })
    ink.append(...inks)
    const root = element('g', {})
    root.append(mask, ink)
    svg.insertBefore(root, crumbs)
    return { root, inks, rubs, lines, strokes, rubStrokes, seed, frame: 0, stop: null }
  }

  function drawAll(generation: Generation) {
    generation.inks.forEach((path, index) => reveal(path, generation.strokes[index].length, generation.strokes[index].length))
    slice(generation, true)
  }

  function toLocal({ x, y }: { x: number; y: number }): ScribblePoint {
    const { left, top, scale } = placement()
    return [(x - left) / scale, (y - top) / scale]
  }

  function crumb(at: ScribblePoint, direction: number, random: () => number) {
    const dot = element('circle', {
      class: 'today-task-crumb',
      cx: at[0] + (random() - 0.5) * 3,
      cy: at[1] + 1 + random() * 2,
      r: 0.5 + random() * 0.65,
    })
    crumbs.append(dot)
    // Flicked off sideways, then dropping away.
    const dx = direction * (2 + random() * 7) + (random() - 0.5) * 3
    const dy = 6 + random() * 10
    const fall = dot.animate([
      { transform: 'translate(0, 0)', opacity: 0.95 },
      { transform: `translate(${dx * 0.65}px, ${dy * 0.22}px)`, opacity: 0.9, offset: 0.35 },
      { transform: `translate(${dx}px, ${dy}px)`, opacity: 0 },
    ], { duration: 520 + random() * 320, easing: 'cubic-bezier(0.25, 0.5, 0.45, 1)' })
    fall.onfinish = () => dot.remove()
    fall.oncancel = () => dot.remove()
  }

  function animate(
    generation: Generation,
    tool: TaskTool,
    pace: StrokePace,
    from: ScribblePoint | null,
    delay: number,
    finish: () => void,
  ) {
    const strokes = tool === 'pencil' ? generation.strokes : generation.rubStrokes
    const paths = tool === 'pencil' ? generation.inks : generation.rubs
    const plan = planStrokes(strokes, pace, from)
    let guide: CursorGuideHandle | null = from ? claimCursorGuide() : null
    const owner = {}
    if (guide) hand.hold(owner, tool)
    const turns = tool === 'eraser' ? strokes.map(strokeTurns) : []
    const passed = strokes.map(() => 0)
    const random = createRandom(generation.seed ^ 0x51ed27)
    let tilt = 0
    let start: number | null = null
    let through = false

    function letGo() {
      guide?.release()
      guide = null
      hand.drop(owner)
    }

    function step(now: number) {
      generation.frame = 0
      start ??= now + delay
      const elapsed = now - start
      if (elapsed < 0) {
        generation.frame = requestAnimationFrame(step)
        return
      }
      const frame = strokeFrame(plan, elapsed)
      // Read where the label is before drawing, so the frame never forces a second layout.
      const at = guide ? placement() : null
      frame.drawn.forEach((drawn, index) => reveal(paths[index], strokes[index].length, drawn))
      // The name falls apart the moment the long cut is all the way through.
      if (cutting && tool === 'pencil' && !through && frame.drawn[0] >= strokes[0].length - 0.01) {
        through = true
        slice(generation, true)
      }
      if (guide && at) {
        tilt += (toolTilt(tool, frame) - tilt) * 0.4
        const [x, y] = frame.point
        if (!guide.move({ x: at.left + x * at.scale, y: at.top + y * at.scale, tilt })) letGo()
      }
      // Crumbs come off the eraser each time it turns back, while it is in hand.
      if (guide && tool === 'eraser') {
        frame.drawn.forEach((drawn, index) => {
          while (passed[index] < turns[index].length && turns[index][passed[index]] <= drawn) {
            passed[index] += 1
            const count = random() < 0.45 ? 2 : 1
            for (let piece = 0; piece < count; piece += 1) crumb(frame.point, Math.sign(frame.heading[0]) || 1, random)
          }
        })
      }
      if (frame.done) {
        generation.stop = null
        letGo()
        finish()
        return
      }
      generation.frame = requestAnimationFrame(step)
    }

    generation.stop?.()
    generation.stop = () => {
      cancelAnimationFrame(generation.frame)
      generation.frame = 0
      generation.stop = null
      letGo()
    }
    generation.frame = requestAnimationFrame(step)
  }

  function fadeAway(generation: Generation, duration = FADE_DURATION) {
    generation.stop?.()
    leaving.add(generation)
    const fade = generation.root.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'ease-out', fill: 'forwards' })
    const remove = () => {
      generation.root.remove()
      leaving.delete(generation)
    }
    fade.onfinish = remove
    fade.oncancel = remove
  }

  function erase(generation: Generation, from: ScribblePoint | null) {
    leaving.add(generation)
    animate(generation, 'eraser', from ? ERASER_PACE : QUICK_ERASER, from, 0, () => fadeAway(generation, 140))
  }

  function relayout() {
    if (!current || current.stop) return
    const lines = measure()
    if (sameLines(lines, current.lines)) return
    const { seed } = current
    current.root.remove()
    current = lines.length > 0 ? build(seed, lines) : null
    if (current) {
      aimSlice(current)
      drawAll(current)
    }
  }

  function show(done: boolean, seed: number, request: ScribbleRequest | null, enterDelay: number) {
    const first = shownDone === null
    if (!first && done === shownDone && seed === shownSeed) return
    shownDone = done
    shownSeed = seed
    const reduced = prefersReducedMotion()
    const asked = request && request.tool === (done ? 'pencil' : 'eraser') &&
      performance.now() - request.at < REQUEST_WINDOW ? request : null
    const from = asked?.from && !reduced ? toLocal(asked.from) : null

    if (!done) {
      const generation = current
      current = null
      heal()
      if (!generation) return
      if (reduced) {
        generation.stop?.()
        generation.root.remove()
        return
      }
      // A line still being drawn is rubbed out from wherever it got to.
      erase(generation, from)
      return
    }

    if (current) {
      if (reduced) {
        current.stop?.()
        current.root.remove()
      } else {
        fadeAway(current)
      }
    }
    const lines = measure()
    if (lines.length === 0) {
      current = null
      return
    }
    const generation = build(seed + made, lines)
    current = generation
    aimSlice(generation)
    if (reduced) {
      drawAll(generation)
      return
    }
    const pace = cutting ? (from ? SLASH_PACE : QUICK_SLASH) : from ? PENCIL_PACE : QUICK_PENCIL
    animate(generation, 'pencil', pace, from, first ? enterDelay : 0, relayout)
  }

  function dispose() {
    current?.stop?.()
    current?.root.remove()
    current = null
    for (const generation of leaving) {
      generation.stop?.()
      generation.root.remove()
    }
    leaving.clear()
    for (const animation of crumbs.getAnimations({ subtree: true })) animation.cancel()
    crumbs.remove()
    delete label.dataset.slice
    label.style.removeProperty('--cut-left')
    label.style.removeProperty('--cut-right')
  }

  return { show, relayout, dispose }
}

/**
 * The hand-drawn zig-zag through a kept task's name, or in Dismantle the cuts
 * through it. With the mouse, the cursor itself scribbles it on as a pencil
 * and rubs it off as an eraser.
 */
export function TaskScribble({
  done,
  seed,
  name,
  takeRequest,
  enterDelay,
  hand,
  strike = 'scribble',
}: {
  done: boolean
  seed: number
  /** The name to cross out; the overlay covers the element it shares with it. */
  name: RefObject<HTMLElement | null>
  /** Picks up what the latest click asked for, if anything, and forgets it. */
  takeRequest: () => ScribbleRequest | null
  /** How long a kept task waits to draw its line as the list arrives. */
  enterDelay: number
  hand: TaskToolHand
  strike?: StrikeStyle
}) {
  const svg = useRef<SVGSVGElement>(null)
  const painter = useRef<Painter | null>(null)
  const maskBase = `scribble-${useId().replace(/[^\w-]/g, '')}`
  // A click leaves a request just before the task changes; the change picks it up.
  const present = useEffectEvent(() => {
    painter.current?.show(done, seed, takeRequest(), enterDelay)
    hand.sync()
  })

  useLayoutEffect(() => {
    const canvas = svg.current
    // A parent's ref is not attached yet while its children's layout effects run.
    const box = canvas?.parentElement
    const text = name.current
    if (!canvas || !box || !text) return
    const created = createPainter(canvas, box, text, maskBase, hand, strike)
    painter.current = created
    // A painter made afresh, for a theme picked meanwhile, shows the task as it stands.
    present()
    // A name that rewraps, or a font that arrives late, moves the line with it.
    const observer = new ResizeObserver(() => created.relayout())
    observer.observe(box)
    return () => {
      observer.disconnect()
      created.dispose()
      if (painter.current === created) painter.current = null
    }
  }, [hand, maskBase, name, strike])

  useLayoutEffect(() => {
    present()
  }, [done, seed])

  return <svg ref={svg} className="today-task-scribble" aria-hidden="true" focusable="false" />
}

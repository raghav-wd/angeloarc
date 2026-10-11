import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  createCursorMorph,
  CROSS_CURSOR_PATH,
  CROSS_CURSOR_SHAPE,
  CURSOR_HOTSPOT,
  CURSOR_MODE_SHAPES,
  CURSOR_MORPH_DURATION,
  CURSOR_SHAPE_MORPH_DURATION,
  CURSOR_TOOL_DETAILS,
  CURSOR_TOOL_MODES,
  cursorMorphPath,
  cursorMorphProgress,
  cursorMorphShape,
  cursorShapeEase,
  cursorShapePath,
  TRIANGLE_CURSOR_PATH,
} from '../lib/cursorMorph'
import type { CursorMode, CursorShape } from '../lib/cursorMorph'
import { getCursorGuide, getCursorMode, subscribeCursorGuide, subscribeCursorMode } from '../lib/cursorMode'
import type { CursorGuide } from '../lib/cursorMode'

export interface CursorFeedback {
  x: number
  y: number
  followPointer: boolean
}

export interface CursorRejection extends CursorFeedback {
  id: number
}

// The outline lands with a little give, as if the hand really closed.
const MODE_POPS: Partial<Record<CursorMode, Keyframe[]>> = {
  grab: [
    { transform: 'scale(0.78)' },
    { transform: 'scale(1.16)', offset: 0.5 },
    { transform: 'scale(0.96)', offset: 0.78 },
    { transform: 'scale(1)' },
  ],
  switch: [
    { transform: 'rotate(-150deg) scale(0.7)' },
    { transform: 'rotate(12deg) scale(1.12)', offset: 0.62 },
    { transform: 'rotate(0deg) scale(1)' },
  ],
  // Tools settle onto their working end, like a pencil set down on its point.
  pencil: [
    { transform: 'scale(0.84)' },
    { transform: 'scale(1.07)', offset: 0.55 },
    { transform: 'scale(1)' },
  ],
  eraser: [
    { transform: 'rotate(-10deg) scale(0.9)' },
    { transform: 'rotate(3deg) scale(1.06)', offset: 0.55 },
    { transform: 'rotate(0deg) scale(1)' },
  ],
}

const TOOLS = ['pencil', 'eraser'] as const

// The cursor glides onto a guide's path quickly, and back to the pointer a little more gently.
const GUIDE_CATCH = 120
const GUIDE_RETURN = 240

const HOLDING_MODES: ReadonlySet<CursorMode> = new Set(['grab', 'switch'])

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function CustomCursor({ rejection }: { rejection: CursorRejection | null }) {
  const cursor = useRef<HTMLDivElement>(null)
  const cursorPose = useRef<SVGGElement>(null)
  const cursorShape = useRef<SVGPathElement>(null)
  const cellFeedback = useRef<HTMLDivElement>(null)
  const cellShape = useRef<SVGPathElement>(null)
  const morphProgress = useRef(0)
  // The outline currently on screen, so any morph can start from wherever the last one stopped.
  const displayed = useRef<CursorShape>(CURSOR_MODE_SHAPES.pointer)
  const stopRejection = useRef<(() => void) | null>(null)
  const stopModeMorph = useRef<(() => void) | null>(null)
  // Where the pointer really is; a guide may be holding the cursor somewhere else.
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const follow = useRef<() => void>(() => {})

  useEffect(() => {
    if (!rejection) return
    const useCursor = rejection.followPointer &&
      window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const mode = getCursorMode()
    // A cursor that is holding something keeps its shape.
    if (useCursor && HOLDING_MODES.has(mode)) return
    const element = useCursor ? cursor.current : cellFeedback.current
    const shape = useCursor ? cursorShape.current : cellShape.current
    if (!element || !shape) return
    // A pencil or eraser says no the way the pointer does: it turns into the
    // cross for a moment and comes back as itself.
    const base = useCursor ? CURSOR_MODE_SHAPES[mode] : CURSOR_MODE_SHAPES.pointer
    const toCross = useCursor && mode !== 'pointer' ? createCursorMorph(base, CROSS_CURSOR_SHAPE) : null
    const shapeAt = (progress: number) => (toCross ? toCross(progress) : cursorMorphShape(progress))
    const pathAt = (progress: number) => (toCross ? cursorShapePath(toCross(progress)) : cursorMorphPath(progress))
    const basePath = toCross ? cursorShapePath(base) : TRIANGLE_CURSOR_PATH

    if (useCursor) {
      // The rejection takes the outline over from any change of tool still under way.
      stopModeMorph.current?.()
      displayed.current = base
      document.documentElement.classList.add('custom-cursor-ready')
      pointer.current = { x: rejection.x, y: rejection.y }
      follow.current()
      element.dataset.visible = 'true'
      element.dataset.blocked = 'true'
    } else {
      if (getCursorMode() === 'pointer') {
        cursorShape.current?.setAttribute('d', TRIANGLE_CURSOR_PATH)
        displayed.current = CURSOR_MODE_SHAPES.pointer
      }
      morphProgress.current = 0
      element.hidden = false
      element.style.left = `${rejection.x}px`
      element.style.top = `${rejection.y}px`
    }

    let frame = 0
    let timeout: ReturnType<typeof setTimeout> | undefined
    const from = morphProgress.current
    const start = performance.now()

    function finish() {
      morphProgress.current = 0
      shape?.setAttribute('d', basePath)
      if (useCursor) {
        displayed.current = base
        stopRejection.current = null
      }
      if (useCursor && element) delete element.dataset.blocked
      if (!useCursor && element) element.hidden = true
    }

    function animate(time: number) {
      const elapsed = Math.max(0, time - start)
      if (elapsed >= CURSOR_MORPH_DURATION) {
        finish()
        return
      }
      const progress = cursorMorphProgress(elapsed, from)
      if (useCursor) {
        morphProgress.current = progress
        displayed.current = shapeAt(progress)
      }
      shape?.setAttribute('d', pathAt(progress))
      frame = requestAnimationFrame(animate)
    }

    if (prefersReducedMotion()) {
      shape.setAttribute('d', toCross ? pathAt(1) : CROSS_CURSOR_PATH)
      if (useCursor) {
        morphProgress.current = 1
        displayed.current = shapeAt(1)
      }
      timeout = setTimeout(finish, CURSOR_MORPH_DURATION)
    } else {
      shape.setAttribute('d', pathAt(from))
      frame = requestAnimationFrame(animate)
    }

    // A cursor mode taking over the outline ends the rejection where it stands.
    function stop() {
      cancelAnimationFrame(frame)
      clearTimeout(timeout)
      morphProgress.current = 0
      delete element?.dataset.blocked
      if (stopRejection.current === stop) stopRejection.current = null
    }
    if (useCursor) stopRejection.current = stop

    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timeout)
      if (useCursor) {
        delete element.dataset.blocked
        if (stopRejection.current === stop) stopRejection.current = null
      } else {
        element.hidden = true
      }
    }
  }, [rejection])

  // Picking something up turns the pointer into a hand; hovering a place to
  // swap with turns the hand into arrows; the task list hands over a pencil,
  // or an eraser over what is already crossed out. Each morph starts from the
  // outline on screen, so a quick change of mind never jumps.
  useEffect(() => {
    let frame = 0

    function morphTo(mode: CursorMode) {
      const element = cursor.current
      const shape = cursorShape.current
      if (!element || !shape) return
      cancelAnimationFrame(frame)
      frame = 0
      stopRejection.current?.()
      const previous = element.dataset.mode as CursorMode | undefined
      element.dataset.mode = mode
      const target = CURSOR_MODE_SHAPES[mode]
      if (prefersReducedMotion()) {
        displayed.current = target
        shape.setAttribute('d', cursorShapePath(target))
        return
      }
      // A tool leans the other way from the arrow, so it swings round its point into place.
      const swing = CURSOR_TOOL_MODES.has(mode) || (previous !== undefined && CURSOR_TOOL_MODES.has(previous))
      const morph = createCursorMorph(displayed.current, target, swing ? { pivot: CURSOR_HOTSPOT } : undefined)
      const start = performance.now()
      const pop = MODE_POPS[mode]
      if (pop) cursorPose.current?.animate(pop, { duration: 380, easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)' })
      const step = (now: number) => {
        const progress = Math.min(1, Math.max(0, (now - start) / CURSOR_SHAPE_MORPH_DURATION))
        displayed.current = progress >= 1 ? target : morph(cursorShapeEase(progress))
        shape.setAttribute('d', cursorShapePath(displayed.current))
        frame = progress < 1 ? requestAnimationFrame(step) : 0
      }
      frame = requestAnimationFrame(step)
    }

    const unsubscribe = subscribeCursorMode(morphTo)
    stopModeMorph.current = () => {
      cancelAnimationFrame(frame)
      frame = 0
    }
    if (getCursorMode() !== 'pointer') morphTo(getCursorMode())
    return () => {
      unsubscribe()
      cancelAnimationFrame(frame)
      stopModeMorph.current = null
    }
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(hover: hover) and (pointer: fine)')
    let frame = 0
    // The guide being followed, or 0 while the cursor follows the pointer.
    let owner = 0
    let shown: CursorGuide | null = null
    let glide: { from: CursorGuide; start: number; duration: number } | null = null

    function goal(): CursorGuide | null {
      const guide = owner ? getCursorGuide() : null
      if (guide) return guide
      return pointer.current ? { ...pointer.current, tilt: 0 } : null
    }

    function place(pose: CursorGuide) {
      const element = cursor.current
      if (!element) return
      shown = pose
      const tilt = Math.abs(pose.tilt) > 0.01 ? ` rotate(${pose.tilt.toFixed(2)}deg)` : ''
      element.style.transform = `translate3d(${pose.x - 3}px, ${pose.y - 3}px, 0)${tilt}`
    }

    function render(now: number) {
      frame = 0
      const target = goal()
      if (!target) return
      if (!glide) {
        place(target)
        return
      }
      const t = Math.min(1, Math.max(0, (now - glide.start) / glide.duration))
      const eased = 1 - (1 - t) ** 3
      place({
        x: glide.from.x + (target.x - glide.from.x) * eased,
        y: glide.from.y + (target.y - glide.from.y) * eased,
        tilt: glide.from.tilt + (target.tilt - glide.from.tilt) * eased,
      })
      if (t < 1) frame = requestAnimationFrame(render)
      else glide = null
    }

    function startGlide(duration: number) {
      glide = shown && !prefersReducedMotion() ? { from: shown, start: performance.now(), duration } : null
      cancelAnimationFrame(frame)
      frame = 0
      render(performance.now())
    }

    // While a guide holds the cursor or it is gliding home, the pointer only
    // moves the place it will glide back to.
    follow.current = () => {
      if (owner || glide) {
        if (!frame && glide) frame = requestAnimationFrame(render)
        return
      }
      const target = goal()
      if (target) place(target)
    }

    function guided(guide: CursorGuide | null, claim: number) {
      if (guide) {
        if (claim !== owner) {
          owner = claim
          startGlide(GUIDE_CATCH)
        } else if (!glide) {
          place(guide)
        }
      } else if (owner) {
        // Only the newest guide can let go, so nothing is guiding the cursor any more.
        owner = 0
        startGlide(GUIDE_RETURN)
      }
    }

    function move(event: PointerEvent) {
      const element = cursor.current
      if (!element || !media.matches || event.pointerType === 'touch') return
      const target = event.target
      const overInput = target instanceof Element && !!target.closest('input, textarea')
      const interactiveElement = target instanceof Element
        ? target.closest('button, [role="button"], a')
        : null
      const interactive = Boolean(interactiveElement && interactiveElement.getAttribute('aria-disabled') !== 'true')

      document.documentElement.classList.add('custom-cursor-ready')
      pointer.current = { x: event.clientX, y: event.clientY }
      follow.current()
      element.dataset.visible = String(!overInput)
      element.dataset.interactive = String(interactive)
    }

    function hide() {
      if (cursor.current) cursor.current.dataset.visible = 'false'
    }

    function leave(event: PointerEvent) {
      if (!event.relatedTarget) hide()
    }

    function down() {
      if (cursor.current) cursor.current.dataset.pressed = 'true'
    }

    function up() {
      if (cursor.current) cursor.current.dataset.pressed = 'false'
    }

    const unsubscribe = subscribeCursorGuide(guided)
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerdown', down, { passive: true })
    window.addEventListener('pointerup', up, { passive: true })
    window.addEventListener('pointercancel', up, { passive: true })
    window.addEventListener('blur', hide)
    document.addEventListener('pointerout', leave)

    return () => {
      unsubscribe()
      cancelAnimationFrame(frame)
      follow.current = () => {}
      document.documentElement.classList.remove('custom-cursor-ready')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      window.removeEventListener('blur', hide)
      document.removeEventListener('pointerout', leave)
    }
  }, [])

  return createPortal(
    <>
      <div ref={cursor} className="custom-cursor" data-mode="pointer" aria-hidden="true">
        <svg width="27" height="31" viewBox="0 0 27 31">
          <g ref={cursorPose} className="cursor-pose">
            <path
              ref={cursorShape}
              className="cursor-shape"
              d={TRIANGLE_CURSOR_PATH}
              fill="white"
              stroke="#202020"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            {TOOLS.map((tool) => {
              const { fill, lines, marks } = CURSOR_TOOL_DETAILS[tool]
              return (
                <g key={tool} className={`cursor-detail cursor-detail-${tool}`}>
                  <path d={fill} fill="#202020" />
                  {lines && <path d={lines} fill="none" stroke="#202020" strokeWidth="1.05" strokeLinecap="round" />}
                  {marks && <path d={marks} fill="none" stroke="white" strokeWidth="1" strokeLinecap="round" />}
                </g>
              )
            })}
          </g>
        </svg>
      </div>
      <div ref={cellFeedback} className="blocked-cell-feedback" hidden aria-hidden="true">
        <svg width="36" height="40" viewBox="-9 -9 36 40">
          <path
            ref={cellShape}
            d={TRIANGLE_CURSOR_PATH}
            fill="white"
            stroke="#202020"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </>,
    document.body,
  )
}

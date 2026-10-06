import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  createCursorMorph,
  CROSS_CURSOR_PATH,
  CURSOR_MODE_SHAPES,
  CURSOR_MORPH_DURATION,
  CURSOR_SHAPE_MORPH_DURATION,
  cursorMorphPath,
  cursorMorphProgress,
  cursorMorphShape,
  cursorShapeEase,
  cursorShapePath,
  TRIANGLE_CURSOR_PATH,
} from '../lib/cursorMorph'
import type { CursorMode, CursorShape } from '../lib/cursorMorph'
import { getCursorMode, subscribeCursorMode } from '../lib/cursorMode'

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

  useEffect(() => {
    if (!rejection) return
    const useCursor = rejection.followPointer &&
      window.matchMedia('(hover: hover) and (pointer: fine)').matches
    // A cursor that is holding something keeps its shape.
    if (useCursor && getCursorMode() !== 'pointer') return
    const element = useCursor ? cursor.current : cellFeedback.current
    const shape = useCursor ? cursorShape.current : cellShape.current
    if (!element || !shape) return

    if (useCursor) {
      document.documentElement.classList.add('custom-cursor-ready')
      element.style.transform = `translate3d(${rejection.x - 3}px, ${rejection.y - 3}px, 0)`
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
      shape?.setAttribute('d', TRIANGLE_CURSOR_PATH)
      if (useCursor) {
        displayed.current = CURSOR_MODE_SHAPES.pointer
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
        displayed.current = cursorMorphShape(progress)
      }
      shape?.setAttribute('d', cursorMorphPath(progress))
      frame = requestAnimationFrame(animate)
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      shape.setAttribute('d', CROSS_CURSOR_PATH)
      if (useCursor) {
        morphProgress.current = 1
        displayed.current = cursorMorphShape(1)
      }
      timeout = setTimeout(finish, CURSOR_MORPH_DURATION)
    } else {
      shape.setAttribute('d', cursorMorphPath(from))
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
  // swap with turns the hand into arrows. Each morph starts from the outline
  // on screen, so a quick change of mind never jumps.
  useEffect(() => {
    let frame = 0

    function morphTo(mode: CursorMode) {
      const element = cursor.current
      const shape = cursorShape.current
      if (!element || !shape) return
      cancelAnimationFrame(frame)
      frame = 0
      stopRejection.current?.()
      element.dataset.mode = mode
      const target = CURSOR_MODE_SHAPES[mode]
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        displayed.current = target
        shape.setAttribute('d', cursorShapePath(target))
        return
      }
      const morph = createCursorMorph(displayed.current, target)
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
    if (getCursorMode() !== 'pointer') morphTo(getCursorMode())
    return () => {
      unsubscribe()
      cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(hover: hover) and (pointer: fine)')

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
      element.style.transform = `translate3d(${event.clientX - 3}px, ${event.clientY - 3}px, 0)`
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

    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerdown', down, { passive: true })
    window.addEventListener('pointerup', up, { passive: true })
    window.addEventListener('pointercancel', up, { passive: true })
    window.addEventListener('blur', hide)
    document.addEventListener('pointerout', leave)

    return () => {
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

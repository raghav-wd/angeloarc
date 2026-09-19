import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { CROSS_CURSOR_PATH, CURSOR_MORPH_DURATION, cursorMorphPath, cursorMorphProgress, TRIANGLE_CURSOR_PATH } from '../lib/cursorMorph'

export interface CursorFeedback {
  x: number
  y: number
  followPointer: boolean
}

export interface CursorRejection extends CursorFeedback {
  id: number
}

export function CustomCursor({ rejection }: { rejection: CursorRejection | null }) {
  const cursor = useRef<HTMLDivElement>(null)
  const cursorShape = useRef<SVGPathElement>(null)
  const cellFeedback = useRef<HTMLDivElement>(null)
  const cellShape = useRef<SVGPathElement>(null)
  const morphProgress = useRef(0)

  useEffect(() => {
    if (!rejection) return
    const useCursor = rejection.followPointer &&
      window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const element = useCursor ? cursor.current : cellFeedback.current
    const shape = useCursor ? cursorShape.current : cellShape.current
    if (!element || !shape) return

    if (useCursor) {
      document.documentElement.classList.add('custom-cursor-ready')
      element.style.transform = `translate3d(${rejection.x - 3}px, ${rejection.y - 3}px, 0)`
      element.dataset.visible = 'true'
      element.dataset.blocked = 'true'
    } else {
      cursorShape.current?.setAttribute('d', TRIANGLE_CURSOR_PATH)
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
      if (useCursor) morphProgress.current = progress
      shape?.setAttribute('d', cursorMorphPath(progress))
      frame = requestAnimationFrame(animate)
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      shape.setAttribute('d', CROSS_CURSOR_PATH)
      if (useCursor) morphProgress.current = 1
      timeout = setTimeout(finish, CURSOR_MORPH_DURATION)
    } else {
      shape.setAttribute('d', cursorMorphPath(from))
      frame = requestAnimationFrame(animate)
    }

    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timeout)
      if (useCursor) delete element.dataset.blocked
      else element.hidden = true
    }
  }, [rejection])

  useEffect(() => {
    const media = window.matchMedia('(hover: hover) and (pointer: fine)')

    function move(event: PointerEvent) {
      const element = cursor.current
      if (!element || !media.matches || event.pointerType === 'touch') return
      const target = event.target
      const overInput = target instanceof Element && !!target.closest('input, textarea')
      const interactive =
        target instanceof Element && !!target.closest('button, [role="button"], a')

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
      <div ref={cursor} className="custom-cursor" aria-hidden="true">
        <svg width="27" height="31" viewBox="0 0 27 31">
          <path
            ref={cursorShape}
            className="cursor-shape"
            d={TRIANGLE_CURSOR_PATH}
            fill="white"
            stroke="#202020"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
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

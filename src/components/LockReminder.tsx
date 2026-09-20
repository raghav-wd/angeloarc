import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { LockKeyhole } from 'lucide-react'

const MOBILE_DEVICE_QUERY = '(max-width: 600px), (hover: none) and (pointer: coarse)'

interface LockReminderProps {
  paused: boolean
  visible: boolean
  onVisibilityChange: (visible: boolean) => void
}

export function LockReminder({ paused, visible, onVisibilityChange }: LockReminderProps) {
  const icon = useRef<SVGSVGElement>(null)
  const changeVisibility = useEffectEvent(onVisibilityChange)
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_DEVICE_QUERY).matches)
  const active = visible && !paused && !mobile

  useEffect(() => {
    const query = window.matchMedia(MOBILE_DEVICE_QUERY)
    function handleChange(event: MediaQueryListEvent) {
      setMobile(event.matches)
      if (event.matches) changeVisibility(false)
    }

    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    if (paused || mobile) return
    let touchStartY = 0
    let timeout: ReturnType<typeof setTimeout> | undefined
    let vibration: Animation | undefined

    function remind() {
      changeVisibility(true)
      clearTimeout(timeout)
      timeout = setTimeout(() => changeVisibility(false), 3400)

      if (
        icon.current &&
        vibration?.playState !== 'running' &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        vibration = icon.current.animate([
          { transform: 'translateX(0) rotate(0deg)' },
          { transform: 'translateX(-2px) rotate(-7deg)' },
          { transform: 'translateX(2px) rotate(7deg)' },
          { transform: 'translateX(-2px) rotate(-6deg)' },
          { transform: 'translateX(2px) rotate(6deg)' },
          { transform: 'translateX(-1.5px) rotate(-4deg)' },
          { transform: 'translateX(1.5px) rotate(4deg)' },
          { transform: 'translateX(-1px) rotate(-2deg)' },
          { transform: 'translateX(1px) rotate(2deg)' },
          { transform: 'translateX(0) rotate(0deg)' },
        ], { duration: 440, easing: 'ease-in-out' })
      }
    }

    function wheel(event: WheelEvent) {
      if (event.ctrlKey || Math.abs(event.deltaY) < 4) return
      event.preventDefault()
      remind()
    }

    function touchStart(event: TouchEvent) {
      touchStartY = event.touches[0]?.clientY ?? 0
    }

    function touchMove(event: TouchEvent) {
      if (event.touches.length !== 1) return
      if (Math.abs((event.touches[0]?.clientY ?? touchStartY) - touchStartY) > 18) {
        event.preventDefault()
        remind()
      }
    }

    function keyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return
      const target = event.target
      if (
        target instanceof Element &&
        target.closest('button, input, textarea, [role="button"], [role="dialog"]')
      ) return
      if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) {
        event.preventDefault()
        remind()
      }
    }

    window.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('touchstart', touchStart, { passive: true })
    window.addEventListener('touchmove', touchMove, { passive: false })
    window.addEventListener('keydown', keyDown)
    return () => {
      window.removeEventListener('wheel', wheel)
      window.removeEventListener('touchstart', touchStart)
      window.removeEventListener('touchmove', touchMove)
      window.removeEventListener('keydown', keyDown)
      clearTimeout(timeout)
      vibration?.cancel()
    }
  }, [mobile, paused])

  if (mobile) return null

  return (
    <>
      <aside className={`lock-reminder ${active ? 'is-visible' : ''}`} aria-hidden="true">
        <LockKeyhole ref={icon} className="lock-reminder-icon" size={23} strokeWidth={1.4} />
        <p>Looks like you&apos;re locked in.</p>
        <span>You can&apos;t scroll away<br />from this routine.</span>
      </aside>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {active ? "Looks like you're locked in. You can't scroll away from this routine." : ''}
      </div>
    </>
  )
}

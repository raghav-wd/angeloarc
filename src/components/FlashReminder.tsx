import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { buildFlashTimeline, fillNoise, FLASH_PALETTES, flashWordAt } from '../lib/flashReminder'
import type { CSSProperties } from 'react'
import './FlashReminder.css'

const LEAVE_DURATION = 240
const REDUCED_MOTION_HOLD = 2600
const NOISE_FRAME_INTERVAL = 66

interface FlashReminderProps {
  message: string
  onClose: () => void
}

export function FlashReminder({ message, onClose }: FlashReminderProps) {
  const overlay = useRef<HTMLDivElement>(null)
  const noiseCanvas = useRef<HTMLCanvasElement>(null)
  const close = useEffectEvent(onClose)
  const timeline = useMemo(() => buildFlashTimeline(message), [message])
  const [leaving, setLeaving] = useState(false)
  const [wordIndex, setWordIndex] = useState(0)
  const [mode] = useState<'flash' | 'still'>(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'still' : 'flash',
  )

  function dismiss() {
    setLeaving(true)
  }

  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => close(), LEAVE_DURATION)
    return () => clearTimeout(timer)
  }, [leaving])

  useEffect(() => {
    if (mode === 'still') {
      const hold = setTimeout(dismiss, REDUCED_MOTION_HOLD)
      return () => clearTimeout(hold)
    }
    const started = performance.now()
    let frame = 0
    function tick() {
      const word = flashWordAt(timeline, Math.max(0, performance.now() - started))
      if (!word) {
        dismiss()
        return
      }
      setWordIndex(timeline.indexOf(word))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [mode, timeline])

  useEffect(() => {
    const canvas = noiseCanvas.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    let grain: ImageData

    const draw = () => {
      fillNoise(grain.data, Math.random)
      context.putImageData(grain, 0, 0)
    }

    const resize = () => {
      canvas.width = Math.max(2, Math.floor(window.innerWidth / 2))
      canvas.height = Math.max(2, Math.floor(window.innerHeight / 2))
      grain = context.createImageData(canvas.width, canvas.height)
      draw()
    }

    resize()
    const interval = mode === 'flash' ? setInterval(draw, NOISE_FRAME_INTERVAL) : undefined
    window.addEventListener('resize', resize)
    return () => {
      clearInterval(interval)
      window.removeEventListener('resize', resize)
    }
  }, [mode])

  useEffect(() => {
    overlay.current?.focus({ preventScroll: true })
    function keyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      dismiss()
    }
    window.addEventListener('keydown', keyDown)
    return () => window.removeEventListener('keydown', keyDown)
  }, [])

  const word = timeline[wordIndex]
  const palette = mode === 'still' ? FLASH_PALETTES.black : word
  const grit = `flash-grit-${wordIndex}`

  return (
    <div
      ref={overlay}
      className={`flash-reminder ${leaving ? 'is-leaving' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Reminder: ${message}`}
      tabIndex={-1}
      onPointerDown={dismiss}
      style={{
        '--flash-bg': palette.background,
        '--flash-ink': palette.ink,
        '--flash-stretch': word.stretch,
      } as CSSProperties}
    >
      <canvas ref={noiseCanvas} className="flash-noise" aria-hidden="true" />
      <div className="flash-vignette" aria-hidden="true" />
      {mode === 'flash' ? (
        <svg key={wordIndex} className="flash-stage" aria-hidden="true">
          <defs>
            <filter id={grit} x="-30%" y="-60%" width="160%" height="220%" colorInterpolationFilters="sRGB">
              <feGaussianBlur in="SourceAlpha" stdDeviation="1.2" result="soft" />
              <feComponentTransfer in="soft" result="ink">
                <feFuncA type="linear" slope="24" intercept="-6" />
              </feComponentTransfer>
              <feTurbulence type="fractalNoise" baseFrequency="0.22 0.4" numOctaves="3" seed={19 + wordIndex * 7} result="pores" />
              <feColorMatrix in="pores" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  4.5 4.5 4.5 0 -4.6" result="poreMask" />
              <feComposite in="ink" in2="poreMask" operator="in" result="body" />
              <feGaussianBlur in="SourceAlpha" stdDeviation="8" result="halo" />
              <feComponentTransfer in="halo" result="fringe">
                <feFuncA type="linear" slope="7" intercept="-0.8" />
              </feComponentTransfer>
              <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed={41 + wordIndex * 5} result="grain" />
              <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  8 8 8 0 -13.6" result="specks" />
              <feComposite in="fringe" in2="specks" operator="in" result="dust" />
              <feMerge result="assembled">
                <feMergeNode in="dust" />
                <feMergeNode in="body" />
              </feMerge>
              <feTurbulence type="fractalNoise" baseFrequency="0.009 0.05" numOctaves="2" seed={3 + wordIndex * 11} result="warp" />
              <feDisplacementMap in="assembled" in2="warp" xChannelSelector="R" yChannelSelector="G" scale={Math.round(6 + word.fontSizeVw * 0.3)} result="shape" />
              <feFlood floodColor={word.ink} result="paint" />
              <feComposite in="paint" in2="shape" operator="in" />
            </filter>
          </defs>
          <text
            x="50%"
            y="50%"
            textAnchor="middle"
            dominantBaseline="central"
            filter={`url(#${grit})`}
            style={{ fontSize: `min(${word.fontSizeVw}vw, ${Math.round(word.fontSizeVw * 1.15)}vh)` }}
          >
            {word.text}
          </text>
        </svg>
      ) : (
        <p className="flash-still">{message}</p>
      )}
      <span className="flash-caption" aria-hidden="true">ANGELO — NO EXCUSES</span>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import cheer from '../../assets/anri/cheer.webp'
import excited from '../../assets/anri/excited.webp'
import point from '../../assets/anri/point.webp'
import thinking from '../../assets/anri/thinking.webp'
import tired from '../../assets/anri/tired.webp'
import wave from '../../assets/anri/wave.webp'
import writing from '../../assets/anri/writing.webp'
import { Emphasis, FilledHeart } from './Doodles'

export type AnriPose = 'tired' | 'thinking' | 'excited' | 'writing' | 'cheer' | 'wave' | 'point'

const ART: Record<AnriPose, string> = { tired, thinking, excited, writing, cheer, wave, point }
const POKE_HOLD = 2200
const HEART_LIFE = 1300

interface FloatingHeart {
  id: number
  x: number
  drift: number
  delay: number
}

interface AnriMascotProps {
  pose: AnriPose
  // Every pose this Anri may switch to, stacked up front so swaps never wait on a download.
  poses: readonly AnriPose[]
  bubble?: string | null
  bubbleSide?: 'left' | 'right'
  pokeLines: readonly string[]
  className?: string
  style?: CSSProperties
}

export function AnriMascot({ pose, poses, bubble, bubbleSide = 'left', pokeLines, className = '', style }: AnriMascotProps) {
  const figure = useRef<HTMLSpanElement>(null)
  const pokes = useRef(0)
  const [poke, setPoke] = useState<{ id: number; line: string } | null>(null)
  const [hearts, setHearts] = useState<readonly FloatingHeart[]>([])

  useEffect(() => {
    if (!poke) return
    const timer = setTimeout(() => setPoke(null), POKE_HOLD)
    return () => clearTimeout(timer)
  }, [poke])

  useEffect(() => {
    if (hearts.length === 0) return
    const timer = setTimeout(() => setHearts([]), HEART_LIFE)
    return () => clearTimeout(timer)
  }, [hearts])

  function boop() {
    const id = pokes.current
    pokes.current += 1
    if (pokeLines.length > 0) setPoke({ id, line: pokeLines[id % pokeLines.length] })
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    figure.current?.getAnimations().forEach((animation) => animation.cancel())
    // A squash, a little hop, and a wobbly landing.
    figure.current?.animate([
      { transform: 'translateY(0) scale(1, 1)' },
      { transform: 'translateY(1.5%) scale(1.07, 0.9)', offset: 0.16 },
      { transform: 'translateY(-11%) scale(0.95, 1.06)', offset: 0.44 },
      { transform: 'translateY(0) scale(1.05, 0.95)', offset: 0.72 },
      { transform: 'translateY(0) scale(0.99, 1.01)', offset: 0.86 },
      { transform: 'translateY(0) scale(1, 1)' },
    ], { duration: 680, easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)' })
    setHearts((current) => [
      ...current,
      ...[0, 1, 2].map((index) => ({
        id: id * 3 + index,
        x: 22 + index * 22 + Math.random() * 12,
        drift: Math.round((Math.random() - 0.5) * 46),
        delay: index * 90,
      })),
    ])
  }

  const shownBubble = poke?.line ?? bubble ?? null

  return (
    <div className={`anri ${className}`} style={style}>
      <button type="button" className="anri-button" onClick={boop} aria-label="Poke Anri, the ANGELO mascot">
        <span className="anri-bob">
          <span ref={figure} className="anri-figure">
            {poses.map((name) => (
              <img
                key={name}
                className={`anri-art ${name === pose ? 'is-shown' : ''}`}
                src={ART[name]}
                alt=""
                draggable={false}
                decoding="async"
              />
            ))}
          </span>
        </span>
      </button>
      <span key={pose} className="anri-puff" aria-hidden="true"><Emphasis /></span>
      {shownBubble && (
        <span key={poke ? `poke-${poke.id}` : shownBubble} className={`anri-bubble is-${bubbleSide}`} aria-hidden="true">
          {shownBubble}
        </span>
      )}
      <span className="anri-hearts" aria-hidden="true">
        {hearts.map((heart) => (
          <FilledHeart
            key={heart.id}
            className="anri-heart"
            style={{ '--x': `${heart.x}%`, '--drift': `${heart.drift}px`, '--delay': `${heart.delay}ms` } as CSSProperties}
          />
        ))}
      </span>
    </div>
  )
}

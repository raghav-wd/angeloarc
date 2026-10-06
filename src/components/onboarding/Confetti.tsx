import type { CSSProperties } from 'react'
import type { ConfettiPiece, ConfettiShape } from '../../lib/onboarding'

const SHAPE_PATHS: Record<ConfettiShape, string> = {
  star: 'M20 3.5L24.4 14.8 36.6 15.6 27.2 23.3 30.4 35.4 20 28.7 9.4 35.6 12.7 23.4 3.2 15.4 15.4 14.6Z',
  heart: 'M20 34C6 24 2 14 8 8 13 3 19 6 20 12 21 6 28 3 33 8 39 14 34 24 20 34Z',
  sparkle: 'M20 2C21 14 26 19 38 20 26 21 21 26 20 38 19 26 14 21 2 20 14 19 19 14 20 2Z',
  dot: 'M20 9A11 11 0 1 1 19.9 9Z',
  squiggle: 'M3 26C9 14 15 34 21 22S33 12 37 18',
}

export interface ConfettiBurst {
  id: number
  x: number
  y: number
  pieces: readonly ConfettiPiece[]
}

export function Confetti({ bursts }: { bursts: readonly ConfettiBurst[] }) {
  return (
    <div className="ob-confetti" aria-hidden="true">
      {bursts.map((burst) => burst.pieces.map((piece, index) => (
        <svg
          key={`${burst.id}-${index}`}
          className={`ob-confetti-piece is-${piece.shape} is-${piece.tone}`}
          viewBox="0 0 40 40"
          style={{
            left: burst.x,
            top: burst.y,
            '--dx': `${piece.dx}px`,
            '--dy': `${piece.dy}px`,
            '--rotate': `${piece.rotate}deg`,
            '--scale': piece.scale,
            '--delay': `${piece.delay}ms`,
          } as CSSProperties}
        >
          <path d={SHAPE_PATHS[piece.shape]} />
        </svg>
      )))}
    </div>
  )
}

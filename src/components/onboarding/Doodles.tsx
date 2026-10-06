import type { CSSProperties } from 'react'

interface DoodleProps {
  className?: string
  style?: CSSProperties
}

function classes(base: string, extra?: string) {
  return extra ? `${base} ${extra}` : base
}

// Each stroke measures 1, so `.ob-draw` can draw it on with a dash offset.
export function Squiggle({ className, style }: DoodleProps) {
  return (
    <svg className={classes('ob-doodle', className)} style={style} viewBox="0 0 300 26" aria-hidden="true">
      <path
        className="ob-draw"
        pathLength={1}
        strokeWidth={3.4}
        d="M3 15C13 3 21 23 33 12S51 2 60 15 76 25 90 9 104 1 116 16 133 22 141 11 158 4 170 17 190 23 199 7 214 5 226 15 244 21 254 10 274 4 297 13"
      />
    </svg>
  )
}

export function Swoosh({ className, style }: DoodleProps) {
  return (
    <svg className={classes('ob-doodle', className)} style={style} viewBox="0 0 160 22" aria-hidden="true">
      <path className="ob-draw" pathLength={1} strokeWidth={3} d="M4 12C40 5 92 3 156 8C112 10 64 13 34 18" />
    </svg>
  )
}

export function CurlyArrow({ className, style }: DoodleProps) {
  return (
    <svg className={classes('ob-doodle', className)} style={style} viewBox="0 0 120 90" aria-hidden="true">
      <path className="ob-draw" pathLength={1} strokeWidth={2.4} d="M8 82C12 54 34 40 52 50C66 58 56 76 44 68C30 58 56 26 106 18" />
      <path className="ob-draw ob-draw-late" pathLength={1} strokeWidth={2.4} d="M90 8L108 17L94 32" />
    </svg>
  )
}

export function Arrow({ className, style }: DoodleProps) {
  return (
    <svg className={classes('ob-doodle', className)} style={style} viewBox="0 0 120 60" aria-hidden="true">
      <path className="ob-draw" pathLength={1} strokeWidth={2.4} d="M6 50C30 18 70 8 110 20" />
      <path className="ob-draw ob-draw-late" pathLength={1} strokeWidth={2.4} d="M95 8L111 20L94 31" />
    </svg>
  )
}

export function LoopArrow({ className, style }: DoodleProps) {
  return (
    <svg className={classes('ob-doodle', className)} style={style} viewBox="0 0 96 64" aria-hidden="true">
      <path className="ob-draw" pathLength={1} strokeWidth={2.2} d="M4 44C16 10 44 6 52 24C58 38 40 46 36 32C32 18 60 10 88 24" />
      <path className="ob-draw ob-draw-late" pathLength={1} strokeWidth={2.2} d="M75 13L89 24L73 32" />
    </svg>
  )
}

export function Star({ className, style }: DoodleProps) {
  return (
    <svg className={classes('ob-doodle', className)} style={style} viewBox="0 0 40 40" aria-hidden="true">
      <path
        className="ob-draw"
        pathLength={1}
        strokeWidth={2}
        d="M20 3.5L24.4 14.8 36.6 15.6 27.2 23.3 30.4 35.4 20 28.7 9.4 35.6 12.7 23.4 3.2 15.4 15.4 14.6Z"
      />
    </svg>
  )
}

export function Sparkle({ className, style }: DoodleProps) {
  return (
    <svg className={classes('ob-doodle', className)} style={style} viewBox="0 0 32 32" aria-hidden="true">
      <path className="ob-draw" pathLength={1} strokeWidth={1.9} d="M16 2C17 11 21 15 30 16 21 17 17 21 16 30 15 21 11 17 2 16 11 15 15 11 16 2Z" />
    </svg>
  )
}

export function Spiral({ className, style }: DoodleProps) {
  return (
    <svg className={classes('ob-doodle', className)} style={style} viewBox="0 0 64 64" aria-hidden="true">
      <path
        className="ob-draw"
        pathLength={1}
        strokeWidth={2}
        d="M31 31C31 27 37 27 37 32 37 39 26 39 25 31 24 21 41 19 43 31 45 45 21 47 18 32 15 16 43 10 50 28 56 46 34 60 16 52"
      />
    </svg>
  )
}

export function Heart({ className, style }: DoodleProps) {
  return (
    <svg className={classes('ob-doodle', className)} style={style} viewBox="0 0 40 40" aria-hidden="true">
      <path className="ob-draw" pathLength={1} strokeWidth={2} d="M20 34C6 24 2 14 8 8 13 3 19 6 20 12 21 6 28 3 33 8 39 14 34 24 20 34Z" />
    </svg>
  )
}

export function QuestionMark({ className, style }: DoodleProps) {
  return (
    <svg className={classes('ob-doodle', className)} style={style} viewBox="0 0 30 40" aria-hidden="true">
      <path className="ob-draw" pathLength={1} strokeWidth={2.6} d="M7 13C7 4 23 3 23 12 23 18 15 18 15 26" />
      <circle className="ob-dot" cx="15" cy="33.5" r="2" />
    </svg>
  )
}

export function Emphasis({ className, style }: DoodleProps) {
  return (
    <svg className={classes('ob-doodle', className)} style={style} viewBox="0 0 30 30" aria-hidden="true">
      <path className="ob-draw" pathLength={1} strokeWidth={2.6} d="M3 17L10.5 15.5" />
      <path className="ob-draw" pathLength={1} strokeWidth={2.6} d="M6.5 7L12.5 11.5" />
      <path className="ob-draw" pathLength={1} strokeWidth={2.6} d="M15.5 2.5L17 10" />
    </svg>
  )
}

export function PaperPlane({ className, style }: DoodleProps) {
  return (
    <svg className={classes('ob-doodle', className)} style={style} viewBox="0 0 130 74" aria-hidden="true">
      <path className="ob-trail" strokeWidth={1.8} d="M4 68C22 48 38 64 54 50 62 43 66 36 74 30" />
      <path className="ob-draw" pathLength={1} strokeWidth={2} d="M74 30L126 6 100 46 90 32ZM90 32L126 6M90 32 88 44 96 38" />
    </svg>
  )
}

export function RoughCircle({ className, style }: DoodleProps) {
  return (
    <svg className={classes('ob-doodle', className)} style={style} viewBox="0 0 40 40" aria-hidden="true">
      <path className="ob-draw" pathLength={1} strokeWidth={1.8} d="M21 4C31 4 37 11 36 21 35 31 27 37 18 36 9 35 3 28 4 19 5 10 12 4 23 5.5" />
    </svg>
  )
}

export function DoubleUnderline({ className, style }: DoodleProps) {
  return (
    <svg className={classes('ob-doodle', className)} style={style} viewBox="0 0 140 22" aria-hidden="true">
      <path className="ob-draw" pathLength={1} strokeWidth={2.6} d="M4 9C40 4 100 3 136 7" />
      <path className="ob-draw ob-draw-late" pathLength={1} strokeWidth={2.2} d="M12 17C50 12 94 12 126 15" />
    </svg>
  )
}

// The ANGELO mark, redrawn with a highlighter and a quick pencil pass on top.
export function ArcHalo({ className, style }: DoodleProps) {
  return (
    <svg className={classes('ob-doodle ob-halo', className)} style={style} viewBox="0 0 200 200" aria-hidden="true">
      <path className="ob-draw ob-halo-marker" pathLength={1} d="M100 21A79 79 0 1 1 21 100H86" />
      <path className="ob-draw ob-halo-pencil" pathLength={1} strokeWidth={1.6} d="M98 17C142 15 182 50 181 99 180 146 143 183 99 182 52 181 17 146 18 103L84 101" />
    </svg>
  )
}

export function Checkbox({ checked }: { checked: boolean }) {
  return (
    <svg className={`ob-doodle ob-checkbox ${checked ? 'is-checked' : ''}`} viewBox="0 0 30 30" aria-hidden="true">
      <path
        className="ob-draw ob-checkbox-box"
        pathLength={1}
        strokeWidth={2}
        d="M5 6C11 4.6 18 4.2 25.4 5.2 25.9 11.6 25.6 18.4 25 25.2 17.6 25.9 10.6 25.6 4.8 24.8 4.2 18.4 4 11.8 5 6Z"
      />
      <path className="ob-checkbox-tick" pathLength={1} strokeWidth={3} d="M8 15.5L13.5 21 28 3" />
    </svg>
  )
}

export function StrikeThrough() {
  return (
    <svg className="ob-doodle ob-strike" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true">
      <path pathLength={1} strokeWidth={2.2} d="M1 7C30 3.5 70 8.5 99 5" />
    </svg>
  )
}

export function FilledHeart({ className, style }: DoodleProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 34C6 24 2 14 8 8 13 3 19 6 20 12 21 6 28 3 33 8 39 14 34 24 20 34Z" />
    </svg>
  )
}

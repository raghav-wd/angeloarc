// Pieces of the Dismantle theme drawn in the tracker's own SVG.
import { bladePath } from '../lib/dismantle'

/**
 * Fills for kept promises: fresh blood that darkens towards the rim of the
 * wheel, crossed by faint old cuts. The score gets the same blood, with the
 * glint of a blade edge running over it now and then.
 */
export function BloodPatterns({
  id,
  center,
  innerRadius,
  outerRadius,
  size,
}: {
  id: string
  center: number
  innerRadius: number
  outerRadius: number
  size: number
}) {
  const core = Math.min(0.95, innerRadius / outerRadius)
  const glinting = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const scoreY = center - 24
  return (
    <>
      <radialGradient id={`${id}-blood`} gradientUnits="userSpaceOnUse" cx={center} cy={center} r={outerRadius}>
        <stop offset={core} className="blood-core" />
        <stop offset="1" className="blood-rim" />
      </radialGradient>
      <radialGradient id={`${id}-blood-hover`} gradientUnits="userSpaceOnUse" cx={center} cy={center} r={outerRadius}>
        <stop offset={core} className="blood-core is-hover" />
        <stop offset="1" className="blood-rim is-hover" />
      </radialGradient>
      <pattern id={`${id}-cuts`} width="34" height="23" patternUnits="userSpaceOnUse" patternTransform="rotate(-38)">
        <path className="blood-cut" d="M2 6.5 L19 6.1" />
        <path className="blood-cut is-faint" d="M17 17.2 L32 16.9" />
      </pattern>
      <pattern id={`${id}-fill`} width={size} height={size} patternUnits="userSpaceOnUse">
        <rect width={size} height={size} fill={`url(#${id}-blood)`} />
        <rect width={size} height={size} fill={`url(#${id}-cuts)`} />
      </pattern>
      <pattern id={`${id}-fill-hover`} width={size} height={size} patternUnits="userSpaceOnUse">
        <rect width={size} height={size} fill={`url(#${id}-blood-hover)`} />
        <rect width={size} height={size} fill={`url(#${id}-cuts)`} />
      </pattern>
      <linearGradient id={`${id}-score-blood`} gradientUnits="userSpaceOnUse" x1={center - 50} y1={scoreY - 40} x2={center + 50} y2={scoreY + 40}>
        <stop offset="0" className="score-blood-light" />
        <stop offset="0.55" className="score-blood-mid" />
        <stop offset="1" className="score-blood-deep" />
      </linearGradient>
      <linearGradient id={`${id}-glint`} gradientUnits="userSpaceOnUse" x1={center - 200} y1={scoreY - 60} x2={center - 140} y2={scoreY + 40}>
        <stop offset="0" className="score-glint is-clear" />
        <stop offset="0.5" className="score-glint" />
        <stop offset="1" className="score-glint is-clear" />
        {glinting && (
          <>
            <animate attributeName="x1" values={`${center - 200};${center - 200};${center + 140}`} keyTimes="0;0.72;1" dur="6.5s" repeatCount="indefinite" />
            <animate attributeName="x2" values={`${center - 140};${center - 140};${center + 200}`} keyTimes="0;0.72;1" dur="6.5s" repeatCount="indefinite" />
          </>
        )}
      </linearGradient>
      <pattern id={`${id}-score`} width={size} height={size} patternUnits="userSpaceOnUse">
        <rect width={size} height={size} fill={`url(#${id}-score-blood)`} />
        <rect width={size} height={size} fill={`url(#${id}-glint)`} />
      </pattern>
    </>
  )
}

/** Two fresh cuts, side by side, where the other themes put a spark or a blossom. */
export function CleaveMark({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden="true">
      <g className="cleave-mark">
        <g transform="translate(-3.2 -1.6) rotate(-56)">
          <path className="cleave-cut" d={bladePath(22, 3.1)} />
          <path className="cleave-cut-core" d={bladePath(16, 0.9)} />
        </g>
        <g transform="translate(4.4 2.2) rotate(-56)">
          <path className="cleave-cut" d={bladePath(15, 2.4)} />
          <path className="cleave-cut-core" d={bladePath(10, 0.7)} />
        </g>
      </g>
    </g>
  )
}

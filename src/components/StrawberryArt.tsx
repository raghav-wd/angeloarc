// Hand-drawn pieces of the strawberry theme, drawn in the tracker's own SVG.

const GOO_SPLINE = '0.45 0 0.55 1;0.45 0 0.55 1'

/**
 * Fills for kept promises: berry flesh that deepens from the middle of the
 * wheel outwards, like a halved strawberry, with a few seeds sitting in little
 * dimples. One continuous fill means a streak reads as one berry. The score
 * gets glossy, slowly flowing berry syrup of its own.
 */
export function BerryPatterns({
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
  const flowing = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const scoreY = center - 24
  return (
    <>
      <radialGradient id={`${id}-flesh`} gradientUnits="userSpaceOnUse" cx={center} cy={center} r={outerRadius}>
        <stop offset={core} className="berry-flesh-core" />
        <stop offset="1" className="berry-flesh-skin" />
      </radialGradient>
      <radialGradient id={`${id}-flesh-hover`} gradientUnits="userSpaceOnUse" cx={center} cy={center} r={outerRadius}>
        <stop offset={core} className="berry-flesh-core is-hover" />
        <stop offset="1" className="berry-flesh-skin is-hover" />
      </radialGradient>
      <pattern id={`${id}-seeds`} width="21" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(-16)">
        <ellipse className="berry-dimple" cx="5" cy="4.8" rx="1.2" ry="1.55" />
        <ellipse className="berry-dimple" cx="15.5" cy="13.8" rx="1.2" ry="1.55" />
        <ellipse className="berry-seed" cx="5" cy="4.5" rx="0.62" ry="1.02" />
        <ellipse className="berry-seed" cx="15.5" cy="13.5" rx="0.62" ry="1.02" />
      </pattern>
      <pattern id={`${id}-fill`} width={size} height={size} patternUnits="userSpaceOnUse">
        <rect width={size} height={size} fill={`url(#${id}-flesh)`} />
        <rect width={size} height={size} fill={`url(#${id}-seeds)`} />
      </pattern>
      <pattern id={`${id}-fill-hover`} width={size} height={size} patternUnits="userSpaceOnUse">
        <rect width={size} height={size} fill={`url(#${id}-flesh-hover)`} />
        <rect width={size} height={size} fill={`url(#${id}-seeds)`} />
      </pattern>
      <linearGradient id={`${id}-syrup`} gradientUnits="userSpaceOnUse" x1={center - 60} y1={scoreY - 40} x2={center + 60} y2={scoreY + 40}>
        <stop offset="0" className="berry-syrup-light" />
        <stop offset="0.55" className="berry-syrup-mid" />
        <stop offset="1" className="berry-syrup-deep" />
      </linearGradient>
      <radialGradient id={`${id}-gloss`} gradientUnits="userSpaceOnUse" cx={center - 22} cy={scoreY - 10} r="30">
        <stop offset="0" className="berry-gloss" />
        <stop offset="1" className="berry-gloss is-clear" />
        {flowing && (
          <>
            <animate attributeName="cx" values={`${center - 30};${center + 26};${center - 30}`} dur="8s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines={GOO_SPLINE} />
            <animate attributeName="cy" values={`${scoreY - 18};${scoreY + 10};${scoreY - 18}`} dur="11s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines={GOO_SPLINE} />
          </>
        )}
      </radialGradient>
      <radialGradient id={`${id}-goo`} gradientUnits="userSpaceOnUse" cx={center + 24} cy={scoreY + 14} r="34">
        <stop offset="0" className="berry-goo" />
        <stop offset="1" className="berry-goo is-clear" />
        {flowing && (
          <>
            <animate attributeName="cx" values={`${center + 28};${center - 24};${center + 28}`} dur="10s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines={GOO_SPLINE} />
            <animate attributeName="cy" values={`${scoreY + 16};${scoreY - 12};${scoreY + 16}`} dur="7s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines={GOO_SPLINE} />
          </>
        )}
      </radialGradient>
      <pattern id={`${id}-score-seeds`} width="24" height="20" patternUnits="userSpaceOnUse" patternTransform="rotate(-12)">
        <ellipse className="berry-seed" cx="5" cy="5" rx="0.9" ry="1.45" />
        <ellipse className="berry-seed" cx="17" cy="15" rx="0.9" ry="1.45" />
      </pattern>
      <pattern id={`${id}-score`} width={size} height={size} patternUnits="userSpaceOnUse">
        <rect width={size} height={size} fill={`url(#${id}-syrup)`} />
        <rect width={size} height={size} fill={`url(#${id}-goo)`} />
        <rect width={size} height={size} fill={`url(#${id}-gloss)`} />
        <rect width={size} height={size} fill={`url(#${id}-score-seeds)`} />
      </pattern>
    </>
  )
}

const PETAL_ANGLES = [-90, -18, 54, 126, 198]

/** A strawberry blossom: five round white petals around a sunny middle. */
export function Blossom({ x, y, scale = 1, className = '' }: { x: number; y: number; scale?: number; className?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden="true">
      <g className={`blossom ${className}`}>
        {PETAL_ANGLES.map((angle) => {
          const radians = (angle * Math.PI) / 180
          return (
            <circle
              key={angle}
              className="blossom-petal"
              cx={Math.round(Math.cos(radians) * 400) / 100}
              cy={Math.round(Math.sin(radians) * 400) / 100}
              r="3.35"
            />
          )
        })}
        <circle className="blossom-heart" r="2.15" />
        {PETAL_ANGLES.map((angle) => {
          const radians = ((angle + 36) * Math.PI) / 180
          return (
            <circle
              key={`stamen-${angle}`}
              className="blossom-stamen"
              cx={Math.round(Math.cos(radians) * 270) / 100}
              cy={Math.round(Math.sin(radians) * 270) / 100}
              r="0.42"
            />
          )
        })}
      </g>
    </g>
  )
}

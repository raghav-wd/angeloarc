import type { CSSProperties } from 'react'
import { annularSectorPath, onboardingConsistency, polarPoint, weekArcSpans } from '../../lib/onboarding'

const CENTER = 100
const RINGS = [
  { inner: 72, outer: 86 },
  { inner: 55, outer: 69 },
  { inner: 38, outer: 52 },
] as const
const DAYS = weekArcSpans()
const [TODAY_START, TODAY_END] = DAYS[0]

// A one-week version of the tracker wheel: a ring per action, a cell per day.
export function WeekArc({ done }: { done: readonly boolean[] }) {
  const percent = onboardingConsistency(done)
  const complete = done.length > 0 && done.every(Boolean)
  const [todayX, todayY] = polarPoint(CENTER, CENTER, 104, (TODAY_START + TODAY_END) / 2 + 6)

  return (
    <svg
      className={`ob-week ${complete ? 'is-complete' : ''}`}
      viewBox="-12 -18 224 226"
      role="img"
      aria-label={`Day one of seven: ${percent}% of today's actions done.`}
    >
      <path
        className="ob-week-today-glow"
        d={annularSectorPath(CENTER, CENTER, RINGS[2].inner - 4, RINGS[0].outer + 4, TODAY_START - 1.5, TODAY_END + 1.5)}
      />
      {RINGS.map((ring, ringIndex) => (
        <g key={ringIndex}>
          {DAYS.map(([start, end], day) => (
            <path
              key={day}
              className={[
                'ob-week-cell',
                day === 0 ? 'is-today' : 'is-ahead',
                day === 0 && done[ringIndex] ? 'is-done' : '',
              ].join(' ')}
              d={annularSectorPath(CENTER, CENTER, ring.inner, ring.outer, start, end)}
              style={{ '--cell': ringIndex * DAYS.length + day, '--ahead': day } as CSSProperties}
            />
          ))}
          <text className="ob-week-ring-label" x={CENTER - 6} y={CENTER - (ring.inner + ring.outer) / 2 + 2.5} textAnchor="end">
            {`0${ringIndex + 1}`}
          </text>
        </g>
      ))}
      {DAYS.map(([start, end], day) => {
        if (day === 0) return null
        const [x, y] = polarPoint(CENTER, CENTER, 96, (start + end) / 2)
        return (
          <text key={day} className="ob-week-day" x={x} y={y + 3} textAnchor="middle">{day + 1}</text>
        )
      })}
      <text className="ob-week-today" x={todayX} y={todayY} textAnchor="middle">today</text>
      <text className="ob-week-percent" x={CENTER} y={CENTER + 7} textAnchor="middle">
        {percent}
        <tspan className="ob-week-percent-sign" dx="1" dy="-9">%</tspan>
      </text>
      <text className="ob-week-caption" x={CENTER} y={CENTER + 21} textAnchor="middle">
        {complete ? 'DAY 1 DONE' : 'TODAY'}
      </text>
    </svg>
  )
}

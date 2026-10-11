import { useId } from 'react'
import { Check } from 'lucide-react'
import dismantleArt from '../assets/dismantle/anri-peek.webp'
import berryArt from '../assets/strawberry/berry.webp'
import { switchTheme, useTheme } from '../hooks/useTheme'
import { THEMES } from '../lib/theme'
import type { ThemeDefinition } from '../lib/theme'
import { annularSectorPath } from '../lib/tracker'

// The wheel in miniature: two habits over twelve days, most of them kept.
const PREVIEW_KEPT = [
  [true, true, true, false, true, true, true, true, false, false, false, false],
  [true, true, false, true, true, true, false, true, true, false, false, false],
]
const PREVIEW_CENTER = 30
const PREVIEW_STEP = 360 / 12
const PREVIEW_GAP = 3.4

function ThemePreview({ theme }: { theme: ThemeDefinition }) {
  const patternId = `theme-fill-${useId().replaceAll(':', '')}`
  const { preview } = theme
  const patterned = Boolean(preview.seed || preview.slash)
  return (
    <svg className="theme-option-art" viewBox="0 0 60 60" aria-hidden="true">
      {preview.seed && (
        <defs>
          <pattern id={patternId} width="5.2" height="4.6" patternUnits="userSpaceOnUse" patternTransform="rotate(-16)">
            <rect width="5.2" height="4.6" fill={preview.done} />
            <ellipse cx="1.3" cy="1.15" rx="0.4" ry="0.64" fill={preview.seed} />
            <ellipse cx="3.9" cy="3.45" rx="0.4" ry="0.64" fill={preview.seed} />
          </pattern>
        </defs>
      )}
      {!preview.seed && preview.slash && (
        <defs>
          <pattern id={patternId} width="6" height="4.2" patternUnits="userSpaceOnUse" patternTransform="rotate(-40)">
            <rect width="6" height="4.2" fill={preview.done} />
            <rect x="0.4" y="1.8" width="3.6" height="0.36" fill={preview.slash} opacity="0.75" />
          </pattern>
        </defs>
      )}
      <rect className="theme-option-paper" width="60" height="60" rx="13" fill={preview.paper} />
      {PREVIEW_KEPT.map((ring, ringIndex) => {
        const outer = 25 - ringIndex * 8
        return ring.map((kept, day) => {
          const start = -90 + day * PREVIEW_STEP + PREVIEW_GAP / 2
          return (
            <path
              key={`${ringIndex}-${day}`}
              d={annularSectorPath(PREVIEW_CENTER, PREVIEW_CENTER, outer - 7, outer, start, start + PREVIEW_STEP - PREVIEW_GAP)}
              fill={kept ? (patterned ? `url(#${patternId})` : preview.done) : preview.cell}
              stroke={kept ? preview.done : preview.line}
              strokeWidth="0.55"
            />
          )
        })
      })}
      <circle cx={PREVIEW_CENTER} cy={PREVIEW_CENTER} r="2.4" fill={preview.done} />
    </svg>
  )
}

/** Picks the look of the whole app; the new one spreads out from the swatch. */
export function ThemePicker() {
  const theme = useTheme()
  return (
    <section className="settings-section theme-section" aria-labelledby="theme-heading">
      <div className="section-heading">
        <h3 id="theme-heading">Your theme</h3>
      </div>
      <div className="theme-options" role="radiogroup" aria-labelledby="theme-heading">
        {THEMES.map((option) => {
          const selected = option.id === theme
          return (
            <label key={option.id} className={`theme-option theme-option-${option.id} ${selected ? 'is-selected' : ''}`}>
              <input
                className="sr-only"
                type="radio"
                name="angelo-theme"
                value={option.id}
                checked={selected}
                onChange={(event) => {
                  const card = event.currentTarget.parentElement?.getBoundingClientRect()
                  switchTheme(option.id, card && { x: card.left + card.width / 2, y: card.top + card.height / 2 })
                }}
              />
              <ThemePreview theme={option} />
              <span className="theme-option-copy">
                <strong>{option.name}</strong>
                <small>{option.caption}</small>
              </span>
              <span className="theme-option-check" aria-hidden="true"><Check size={10} strokeWidth={2.4} /></span>
              {option.id === 'strawberry' && (
                <img className="theme-option-sticker" src={berryArt} alt="" draggable={false} decoding="async" />
              )}
              {option.id === 'dismantle' && (
                <img className="theme-option-sticker" src={dismantleArt} alt="" draggable={false} decoding="async" />
              )}
            </label>
          )
        })}
      </div>
      <p className="field-help">A look for this device. Your routine and progress stay just as they are.</p>
    </section>
  )
}

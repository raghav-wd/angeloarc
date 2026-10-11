import { useEffect, useMemo, useRef } from 'react'
import type { CSSProperties } from 'react'
import anriArt from '../assets/dismantle/anri-domain.webp'
import marksArt from '../assets/dismantle/anri-domain-marks.webp'
import shrineArt from '../assets/dismantle/shrine.webp'
import { backdropCuts, bladePath } from '../lib/dismantle'
import type { BackdropCut } from '../lib/dismantle'
import { createRandom } from '../lib/paperMesh'

// Now and then a new cut is made somewhere on the page, then scars over.
const FRESH_CUT_EVERY: readonly [number, number] = [14000, 26000]
const FRESH_CUT_LIFE = 7000
const SVG = 'http://www.w3.org/2000/svg'

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function scarStyle(cut: BackdropCut): Record<string, string> {
  return {
    left: `${cut.x * 100}%`,
    top: `${cut.y * 100}%`,
    width: `${cut.length}px`,
    height: `${cut.width * 3}px`,
    '--angle': `${cut.angle}deg`,
    '--shift': `${cut.shift}px`,
    '--period': `${cut.period}s`,
    '--delay': `${cut.delay}s`,
  }
}

function scarViewBox(cut: BackdropCut): string {
  return `${-cut.length / 2} ${-cut.width * 1.5} ${cut.length} ${cut.width * 3}`
}

function Scar({ cut }: { cut: BackdropCut }) {
  const blade = bladePath(cut.length, cut.width)
  return (
    <span className="domain-scar" style={scarStyle(cut) as CSSProperties}>
      <svg viewBox={scarViewBox(cut)} preserveAspectRatio="none">
        <path className="domain-scar-mark" d={blade} />
        <path className="domain-scar-glow" d={blade} />
      </svg>
    </span>
  )
}

/** A cut made just now, built by hand since it lives only a few seconds. */
function freshScar(cut: BackdropCut): HTMLElement {
  const scar = document.createElement('span')
  scar.className = 'domain-scar is-fresh'
  for (const [property, value] of Object.entries(scarStyle(cut))) scar.style.setProperty(property, value)
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', scarViewBox(cut))
  svg.setAttribute('preserveAspectRatio', 'none')
  for (const part of ['mark', 'glow']) {
    const path = document.createElementNS(SVG, 'path')
    path.setAttribute('class', `domain-scar-${part}`)
    path.setAttribute('d', bladePath(cut.length, cut.width))
    svg.append(path)
  }
  scar.append(svg)
  return scar
}

/**
 * Anri's domain, behind the Dismantle page: faint old cuts across the dark
 * that catch the light now and then, and a shrine under a blood moon. Anri
 * herself, hands in the sign, only steps out in front of it on the settings
 * and account pages, the markings on her face flaring as she arrives.
 */
export function DismantleBackdrop() {
  const cuts = useMemo(() => backdropCuts(createRandom('dismantle-scars'), 12), [])
  const freshCuts = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (prefersReducedMotion()) return
    const random = createRandom(`fresh:${Date.now()}`)
    const made = new Set<HTMLElement>()
    let timer = 0

    function cut() {
      const layer = freshCuts.current
      if (!layer || document.hidden) return
      const scar = freshScar({ ...backdropCuts(random, 1)[0], shift: 0 })
      layer.append(scar)
      made.add(scar)
      window.setTimeout(() => {
        scar.remove()
        made.delete(scar)
      }, FRESH_CUT_LIFE)
    }

    function schedule() {
      const [least, most] = FRESH_CUT_EVERY
      timer = window.setTimeout(() => {
        cut()
        schedule()
      }, least + random() * (most - least))
    }

    schedule()
    return () => {
      window.clearTimeout(timer)
      for (const scar of made) scar.remove()
    }
  }, [])

  return (
    <div className="dismantle-backdrop" aria-hidden="true">
      <div className="domain-aura">
        <div className="domain-aura-flare" />
      </div>
      <div className="domain-scars">
        {cuts.map((cut, index) => <Scar key={index} cut={cut} />)}
        <div ref={freshCuts} className="domain-fresh-cuts" />
      </div>
      <div className="domain-stage">
        <img className="domain-shrine" src={shrineArt} alt="" draggable={false} decoding="async" />
        <div className="domain-caster">
          <div className="domain-caster-body">
            <img className="domain-anri" src={anriArt} alt="" draggable={false} decoding="async" />
            <img className="domain-anri-marks" src={marksArt} alt="" draggable={false} decoding="async" />
          </div>
        </div>
      </div>
    </div>
  )
}

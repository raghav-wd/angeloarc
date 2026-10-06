import { useId } from 'react'
import type { CSSProperties, Ref } from 'react'
import { BIN_DRAWING } from '../lib/paperGesture'
import type { BinPlacement } from '../lib/paperGesture'

interface PaperBinProps {
  placement: BinPlacement
  shown: boolean
  undo: { label: string; disabled: boolean; onUndo: () => void } | null
  /** The inside of the bin, drawn under the paper balls. */
  backRef: Ref<HTMLDivElement>
  /** The front wall and rim, drawn over a ball that drops in. */
  frontRef: Ref<HTMLDivElement>
}

const { width, height, mouthX, mouthY, mouthRx, mouthRy, baseY, baseRx, baseRy } = BIN_DRAWING
const left = mouthX - mouthRx
const right = mouthX + mouthRx
const baseLeft = mouthX - baseRx
const baseRight = mouthX + baseRx
const WALL = `M${left} ${mouthY} L${baseLeft} ${baseY} A${baseRx} ${baseRy} 0 0 0 ${baseRight} ${baseY} L${right} ${mouthY} A${mouthRx} ${mouthRy} 0 0 1 ${left} ${mouthY} Z`
const OUTLINE = `M${left} ${mouthY} L${baseLeft} ${baseY} A${baseRx} ${baseRy} 0 0 0 ${baseRight} ${baseY} L${right} ${mouthY}`
const RIM_FRONT = `M${left} ${mouthY} A${mouthRx} ${mouthRy} 0 0 0 ${right} ${mouthY}`
const RIM_BACK = `M${left} ${mouthY} A${mouthRx} ${mouthRy} 0 0 1 ${right} ${mouthY}`
const LIP = `M${left + 1.4} ${mouthY + 4.2} A${mouthRx - 1.4} ${mouthRy - 0.6} 0 0 0 ${right - 1.4} ${mouthY + 4.2}`
// Slats round the front of the basket, converging towards the base.
const RIBS = [0.16, 0.3, 0.43, 0.57, 0.7, 0.84].map((turn) => {
  const cos = Math.cos(Math.PI * turn)
  const sin = Math.sin(Math.PI * turn)
  const top = [mouthX + cos * (mouthRx - 1.4), mouthY + 4.2 + sin * (mouthRy - 0.6)]
  const bottom = [mouthX + cos * baseRx, baseY + sin * baseRy]
  return `M${top[0].toFixed(2)} ${top[1].toFixed(2)} L${bottom[0].toFixed(2)} ${bottom[1].toFixed(2)}`
}).join(' ')

/**
 * A waste-paper basket in two layers, so a ball can drop between its back
 * and front walls and disappear inside.
 */
export function PaperBin({ placement, shown, undo, backRef, frontRef }: PaperBinProps) {
  const id = useId().replace(/:/g, '')
  const style = {
    left: placement.x - mouthX * placement.scale,
    top: placement.y - mouthY * placement.scale,
    width: width * placement.scale,
    height: height * placement.scale,
  } as CSSProperties
  const state = shown ? 'true' : 'false'

  return (
    <>
      <div ref={backRef} className="paper-bin-layer is-back" data-shown={state} style={style} aria-hidden="true">
        <div className="paper-bin-wobble">
          <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" overflow="visible">
            <defs>
              <linearGradient id={`${id}-inside`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#e7e7e3" />
                <stop offset="0.6" stopColor="#cacac5" />
                <stop offset="1" stopColor="#a4a49f" />
              </linearGradient>
              <radialGradient id={`${id}-ground`}>
                <stop offset="0" stopColor="#000" stopOpacity="0.2" />
                <stop offset="0.65" stopColor="#000" stopOpacity="0.07" />
                <stop offset="1" stopColor="#000" stopOpacity="0" />
              </radialGradient>
            </defs>
            <ellipse cx={mouthX + 6} cy={baseY + 4} rx={baseRx + 16} ry={baseRy + 5} fill={`url(#${id}-ground)`} />
            <ellipse cx={mouthX} cy={mouthY} rx={mouthRx} ry={mouthRy} fill={`url(#${id}-inside)`} />
            <ellipse className="paper-bin-mouth-shade" cx={mouthX} cy={mouthY + 2} rx={mouthRx - 6} ry={mouthRy - 3} />
            <path className="paper-bin-line" d={RIM_BACK} />
          </svg>
        </div>
      </div>
      <div ref={frontRef} className="paper-bin-layer is-front" data-shown={state} style={style}>
        <div className="paper-bin-wobble">
          <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" overflow="visible" aria-hidden="true">
            <defs>
              <linearGradient id={`${id}-wall`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#f3f3f0" />
                <stop offset="0.36" stopColor="#ffffff" />
                <stop offset="1" stopColor="#d9d9d5" />
              </linearGradient>
            </defs>
            <path d={WALL} fill={`url(#${id}-wall)`} />
            <path className="paper-bin-ribs" d={RIBS} />
            <path className="paper-bin-lip" d={LIP} />
            <path className="paper-bin-line" d={OUTLINE} />
            <path className="paper-bin-line" d={RIM_FRONT} />
            <path className="paper-bin-poof" d="M38 3 L31 -8 M56 -2 L56 -15 M74 3 L81 -8" />
          </svg>
        </div>
        <div className="paper-bin-caption" aria-hidden={!shown} inert={!shown}>
          {undo ? (
            <>
              <span>Thrown away</span>
              <button
                type="button"
                className="paper-bin-undo"
                onClick={undo.onUndo}
                disabled={undo.disabled}
                aria-label={`Undo: put “${undo.label}” back`}
              >
                Undo
              </button>
            </>
          ) : (
            <>
              <span className="paper-bin-hint">Toss it here</span>
              <span className="paper-bin-armed-hint">Let go</span>
            </>
          )}
        </div>
      </div>
    </>
  )
}

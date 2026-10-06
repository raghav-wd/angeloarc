export type HapticPattern = 'pickup' | 'tick' | 'bump' | 'swap' | 'thud'

// Short pulses read as texture rather than buzzing; two-part patterns land
// like something with weight settling.
const PATTERNS: Readonly<Record<HapticPattern, number | number[]>> = {
  pickup: 14,
  tick: 7,
  bump: 11,
  swap: [9, 45, 16],
  thud: [16, 34, 26],
}

let switchLabel: HTMLLabelElement | null = null

// Safari has no vibration API, but iOS 18 and later tick whenever a switch
// control flips, so an invisible one stands in for it.
function tickSwitch() {
  if (typeof document === 'undefined') return
  if (!switchLabel) {
    const label = document.createElement('label')
    const input = document.createElement('input')
    label.setAttribute('aria-hidden', 'true')
    label.style.display = 'none'
    label.addEventListener('click', (event) => event.stopPropagation())
    input.type = 'checkbox'
    input.tabIndex = -1
    input.setAttribute('switch', '')
    label.append(input)
    document.body.append(label)
    switchLabel = label
  }
  switchLabel.click()
}

/** A small physical cue for touch and pen gestures; mice and keyboards get none. */
export function haptic(pattern: HapticPattern, pointerType: string | null | undefined): void {
  if (pointerType !== 'touch' && pointerType !== 'pen') return
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(PATTERNS[pattern])
      return
    }
    tickSwitch()
  } catch {
    // Haptics are a nicety; a browser that refuses them changes nothing.
  }
}

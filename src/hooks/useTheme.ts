import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { createThemeStore, themeDefinition, themeStorage } from '../lib/theme.ts'
import type { ThemeId, ThemeStore } from '../lib/theme.ts'

const REVEAL_DURATION = 760
const CUT_DURATION = 900
// The angle Dismantle cuts the old look open along, in degrees from the x axis.
const CUT_ANGLE = -32

let switches = 0

/**
 * A band along a line through (x, y) at `angle`, `half` pixels either side of
 * it and long enough to cross any screen: Dismantle opens the page like a cut.
 */
function cutBand(x: number, y: number, half: number, reach: number): string {
  const radians = (CUT_ANGLE * Math.PI) / 180
  const along = [Math.cos(radians) * reach, Math.sin(radians) * reach]
  const across = [-Math.sin(radians) * half, Math.cos(radians) * half]
  const corner = (sideways: number, outwards: number) =>
    `${(x + along[0] * sideways + across[0] * outwards).toFixed(1)}px ${(y + along[1] * sideways + across[1] * outwards).toFixed(1)}px`
  return `polygon(${corner(-1, -1)}, ${corner(1, -1)}, ${corner(1, 1)}, ${corner(-1, 1)})`
}

function applyToDocument(theme: ThemeId) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeDefinition(theme).themeColor)
}

let store: ThemeStore | null = null

/** The page's one theme store, created (and painted on) at first use. */
export function themeStore(): ThemeStore {
  store ??= createThemeStore({
    storage: themeStorage(),
    apply: applyToDocument,
    events: typeof window === 'undefined' ? null : window,
  })
  return store
}

export function useTheme(): ThemeId {
  const current = themeStore()
  return useSyncExternalStore(current.subscribe, current.getSnapshot)
}

/**
 * Switches theme. Where the browser can, the new look spreads out in a circle
 * from `origin` (normally the swatch that was picked) over the old one;
 * Dismantle instead cuts the old look open along a line through it.
 */
export function switchTheme(theme: ThemeId, origin?: { x: number; y: number }): void {
  const current = themeStore()
  if (theme === current.getSnapshot()) return
  const root = document.documentElement
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced || typeof document.startViewTransition !== 'function') {
    current.setTheme(theme)
    return
  }

  const x = origin?.x ?? window.innerWidth / 2
  const y = origin?.y ?? window.innerHeight / 2
  const cutting = theme === 'dismantle'
  root.classList.add('is-theme-switching')
  const ticket = ++switches
  const transition = document.startViewTransition(() => {
    flushSync(() => current.setTheme(theme))
    // The blade's line is drawn on the new look itself, which stays live while
    // it is revealed, so it shows first through the hairline and then fades.
    if (cutting) {
      root.style.setProperty('--theme-cut-x', `${x}px`)
      root.style.setProperty('--theme-cut-y', `${y}px`)
      root.style.setProperty('--theme-cut-angle', `${CUT_ANGLE}deg`)
      root.classList.add('is-theme-cutting')
    }
  })
  // A quick second pick skips this transition; only the latest one tidies up.
  const settle = () => {
    if (ticket !== switches) return
    root.classList.remove('is-theme-switching', 'is-theme-cutting')
    for (const property of ['--theme-cut-x', '--theme-cut-y', '--theme-cut-angle']) root.style.removeProperty(property)
  }
  void transition.finished.then(settle, settle)
  void transition.ready.then(() => {
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
    if (cutting) {
      // A hairline cut flashes across the page, then splits it open.
      const reach = Math.hypot(window.innerWidth, window.innerHeight) * 1.5
      root.animate(
        { clipPath: [cutBand(x, y, 0, reach), cutBand(x, y, 2, reach), cutBand(x, y, 4, reach), cutBand(x, y, reach, reach)], offset: [0, 0.14, 0.3, 1] },
        { duration: CUT_DURATION, easing: 'cubic-bezier(0.6, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
      )
      root.animate(
        { filter: ['brightness(1)', 'brightness(1.5)', 'brightness(0.5)'], offset: [0, 0.2, 1] },
        { duration: CUT_DURATION, easing: 'ease-in', pseudoElement: '::view-transition-old(root)' },
      )
      return
    }
    root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: REVEAL_DURATION, easing: 'cubic-bezier(0.45, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
    )
  }, () => {
    // A transition the browser skipped has already applied the theme.
  })
}

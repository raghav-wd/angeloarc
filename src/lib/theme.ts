import { FLASH_PALETTES } from './flashReminder.ts'
import type { FlashPalette } from './flashReminder.ts'
import { PAPER_INK } from './paperMesh.ts'
import type { PaperInk } from './paperMesh.ts'
import { DEFAULT_TITLE } from './tracker.ts'

export const THEME_STORAGE_KEY = 'angelo-theme-v1'

export type ThemeId = 'monochrome' | 'strawberry' | 'dismantle'

export interface ThemePreview {
  paper: string
  line: string
  cell: string
  done: string
  ink: string
  seed?: string
  /** Cuts drawn through the kept cells of the swatch. */
  slash?: string
}

/** The homepage's own words, which a theme can give its own voice. */
export interface ThemeCopy {
  /** Shown instead of the stock routine title, for as long as the routine keeps it. */
  title: string
  eyebrow: string
  subtitle: string
  intentionLead: string
  intentionEmphasis: string
  intentionCaption: string
  todayHeading: string
  todayLines: readonly [string, string]
  otherHeading: string
  otherLines: readonly [string, string]
  legendDone: string
  legendUndone: string
  legendUnavailable: string
  footerGuide: string
  footerSignoff: string
  monthCaption: string
  notesTitleLead: string
  notesEyebrow: string
  notesSubtitle: string
  notesSignoff: string
  ritualsHeading: string
  scoreLabel: string
  dayNoteHint: string
}

export const MONOCHROME_COPY: ThemeCopy = {
  title: DEFAULT_TITLE,
  eyebrow: 'A LITTLE BETTER, EVERY DAY.',
  subtitle: 'Less thinking. More showing up.',
  intentionLead: 'Not perfect.',
  intentionEmphasis: 'Just consistent.',
  intentionCaption: "THAT'S THE WHOLE IDEA.",
  todayHeading: 'TODAY IS A GOOD DAY',
  todayLines: ['A small step today.', 'A different you tomorrow.'],
  otherHeading: 'ONE DAY AT A TIME',
  otherLines: ['A little intention.', 'A whole lot of possibility.'],
  legendDone: 'Done',
  legendUndone: 'Not yet',
  legendUnavailable: 'Not available',
  footerGuide: 'Click a cell. Keep a promise.',
  footerSignoff: 'Little by little, a little becomes a lot.',
  monthCaption: 'A NEW DAY. ANOTHER CHANCE.',
  notesTitleLead: 'Notes to',
  notesEyebrow: 'WORDS TO LIVE BY.',
  notesSubtitle: 'Principles, goals and quotes worth keeping close.',
  notesSignoff: 'Keep what keeps you going.',
  ritualsHeading: 'THE DAILY RITUALS',
  scoreLabel: 'CONSISTENCY',
  dayNoteHint: "SEE TODAY'S TASKS",
}

export interface ThemeDefinition {
  id: ThemeId
  name: string
  caption: string
  /** The browser chrome colour while the theme is showing. */
  themeColor: string
  preview: ThemePreview
  /** Colours the crumpled notes to self are painted in. */
  paperInk: PaperInk
  /** The flash reminder's dark, light and warm cards. */
  flash: Readonly<Record<keyof typeof FLASH_PALETTES, FlashPalette>>
  copy: ThemeCopy
}

export const THEMES: readonly ThemeDefinition[] = [
  {
    id: 'monochrome',
    name: 'Monochrome',
    caption: 'Ink on paper.',
    themeColor: '#fafafa',
    preview: { paper: '#fafafa', line: '#c4c4c4', cell: '#ffffff', done: '#2c2c2c', ink: '#202020' },
    paperInk: PAPER_INK,
    flash: FLASH_PALETTES,
    copy: MONOCHROME_COPY,
  },
  {
    id: 'strawberry',
    name: 'Strawberry',
    caption: 'Blush, berries & seeds.',
    themeColor: '#fff3f5',
    preview: { paper: '#fff3f5', line: '#f1b9c8', cell: '#fffafb', done: '#e8506f', ink: '#5b2337', seed: '#ffe7a3' },
    paperInk: { paper: [255, 240, 244], shadow: [196, 112, 138], edge: [236, 160, 182] },
    flash: {
      black: { background: '#3b0f1f', ink: '#ffe3eb' },
      white: { background: '#fff0f3', ink: '#5b1a32' },
      brown: { background: '#c9395a', ink: '#fff4f7' },
    },
    copy: {
      ...MONOCHROME_COPY,
      title: 'Soft Girl Grind',
      eyebrow: 'A LITTLE SWEETER, EVERY DAY.',
      subtitle: 'Berry serious about showing up.',
      intentionLead: 'Cute, but',
      intentionEmphasis: 'consistent.',
      intentionCaption: "THAT'S THE WHOLE VIBE.",
      todayHeading: 'TODAY IS A SWEET DAY',
      todayLines: ['A small step today.', 'A sweeter you tomorrow.'],
      otherHeading: 'ONE BERRY AT A TIME',
      otherLines: ['A little intention.', 'A whole lot of sweetness.'],
      legendDone: 'Picked',
      legendUnavailable: 'Not in season',
      footerGuide: 'Tap a cell. Pick a berry.',
      footerSignoff: 'Berry by berry, a little becomes a lot.',
      monthCaption: 'SOFT DAYS. STRONG HABITS.',
      notesTitleLead: 'Love notes to',
    },
  },
  {
    id: 'dismantle',
    name: 'Dismantle',
    caption: 'Blood, blades & black.',
    themeColor: '#000000',
    preview: { paper: '#000000', line: '#4a121a', cell: '#120b0c', done: '#b3121f', ink: '#efe4e4', slash: '#ff8a8e' },
    // Bone-white paper that blushes red in its creases.
    paperInk: { paper: [232, 223, 213], shadow: [84, 16, 22], edge: [156, 44, 50] },
    flash: {
      black: { background: '#0a0506', ink: '#f4e4e4' },
      white: { background: '#ece3dc', ink: '#1c0a0d' },
      brown: { background: '#8c0b16', ink: '#fdeced' },
    },
    copy: {
      ...MONOCHROME_COPY,
      title: 'Malevolent Grind',
      eyebrow: 'EXPAND YOUR DOMAIN. EVERY DAY.',
      subtitle: 'Dismantle every excuse. Cleave through the day.',
      intentionLead: 'No mercy.',
      intentionEmphasis: 'Only progress.',
      intentionCaption: 'KNOW YOUR PLACE. AT THE TOP.',
      todayHeading: 'TODAY, YOU DOMINATE',
      todayLines: ['Cut one excuse down today.', 'Reign over tomorrow.'],
      otherHeading: 'ONE CUT AT A TIME',
      otherLines: ['A little cursed energy.', 'A whole domain of progress.'],
      legendDone: 'Dismantled',
      legendUndone: 'Still standing',
      legendUnavailable: 'Sealed',
      footerGuide: 'Click a cell. Make the cut.',
      footerSignoff: 'Slash by slash, a little becomes a reign.',
      monthCaption: 'NO MERCY. NO DAYS OFF.',
      notesTitleLead: 'Binding vows to',
      notesEyebrow: 'VOWS THAT BIND.',
      notesSubtitle: 'Principles, goals and quotes, sworn as binding vows.',
      notesSignoff: 'A vow kept is power gained.',
      ritualsHeading: 'CURSED TECHNIQUES',
      scoreLabel: 'DOMINANCE',
      dayNoteHint: "SEE TODAY'S HIT LIST",
    },
  },
]

export const DEFAULT_THEME: ThemeId = 'monochrome'

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEMES.some((theme) => theme.id === value)
}

export function parseTheme(value: unknown): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME
}

export function themeDefinition(theme: ThemeId): ThemeDefinition {
  return THEMES.find((definition) => definition.id === theme) ?? THEMES[0]
}

/**
 * The routine title as a theme shows it: a title someone wrote is theirs and
 * never changes, but the stock one takes on the theme's own stock title.
 */
export function presentTitle(title: string, theme: ThemeId): string {
  return title.trim() === DEFAULT_TITLE ? themeDefinition(theme).copy.title : title
}

/**
 * The other way round, for saving what the title field shows: the theme's
 * stock title is saved as the stock title, so it never leaks into another
 * theme or onto a public profile.
 */
export function storedTitle(shown: string, theme: ThemeId): string {
  const title = shown.trim()
  return title === themeDefinition(theme).copy.title ? DEFAULT_TITLE : title
}

export interface ThemeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function themeStorage(): ThemeStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readStoredTheme(storage: ThemeStorage | null): ThemeId {
  if (!storage) return DEFAULT_THEME
  try {
    return parseTheme(storage.getItem(THEME_STORAGE_KEY))
  } catch {
    return DEFAULT_THEME
  }
}

// Only an explicit choice is written. The welcome guide treats any stored
// ANGELO key as a sign of a returning visitor, so nothing is saved on load.
export function storeTheme(storage: ThemeStorage | null, theme: ThemeId): boolean {
  if (!storage) return false
  try {
    storage.setItem(THEME_STORAGE_KEY, theme)
    return true
  } catch {
    return false
  }
}

export interface ThemeEvents {
  addEventListener(type: 'storage', listener: (event: Event) => void): void
  removeEventListener(type: 'storage', listener: (event: Event) => void): void
}

export interface ThemeStore {
  getSnapshot: () => ThemeId
  subscribe: (listener: () => void) => () => void
  setTheme: (theme: ThemeId) => void
}

/**
 * Holds the chosen theme for the whole page. `apply` paints it onto the
 * document; another tab choosing a theme is picked up through `events`.
 */
export function createThemeStore({
  storage,
  apply,
  events,
}: {
  storage: ThemeStorage | null
  apply: (theme: ThemeId) => void
  events?: ThemeEvents | null
}): ThemeStore {
  let theme = readStoredTheme(storage)
  const listeners = new Set<() => void>()

  const change = (next: ThemeId) => {
    if (next === theme) return
    theme = next
    apply(theme)
    for (const listener of listeners) listener()
  }

  const handleStorage = (event: Event) => {
    const key = (event as Partial<StorageEvent>).key
    // A null key means the other tab cleared storage altogether.
    if (key !== THEME_STORAGE_KEY && key !== null) return
    change(readStoredTheme(storage))
  }

  apply(theme)

  return {
    getSnapshot: () => theme,
    subscribe: (listener) => {
      listeners.add(listener)
      if (listeners.size === 1) events?.addEventListener('storage', handleStorage)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) events?.removeEventListener('storage', handleStorage)
      }
    },
    setTheme: (next) => {
      if (!isThemeId(next)) throw new Error(`"${String(next)}" is not an ANGELO theme.`)
      if (next === theme) return
      storeTheme(storage, next)
      change(next)
    },
  }
}

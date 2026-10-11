import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BERRY_BURST_SHAPES, berryBurstPieces, spawnBerryBurst } from '../src/lib/berryBurst.ts'
import { FLASH_PALETTES } from '../src/lib/flashReminder.ts'
import { shouldShowOnboarding } from '../src/lib/onboarding.ts'
import { PAPER_INK } from '../src/lib/paperMesh.ts'
import {
  createThemeStore,
  DEFAULT_THEME,
  isThemeId,
  MONOCHROME_COPY,
  parseTheme,
  presentTitle,
  readStoredTheme,
  storedTitle,
  storeTheme,
  THEME_STORAGE_KEY,
  themeDefinition,
  THEMES,
} from '../src/lib/theme.ts'
import type { ThemeId } from '../src/lib/theme.ts'
import { DEFAULT_TITLE } from '../src/lib/tracker.ts'

class MemoryStorage {
  readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

class BrokenStorage extends MemoryStorage {
  override getItem(): string | null {
    throw new Error('SecurityError')
  }

  override setItem(): void {
    throw new Error('QuotaExceededError')
  }
}

function storageEvent(key: string | null): Event {
  return Object.assign(new Event('storage'), { key })
}

function seededRandom(seed: number): () => number {
  let value = seed
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

describe('the theme catalogue', () => {
  it('starts on monochrome and offers strawberry and dismantle', () => {
    assert.equal(DEFAULT_THEME, 'monochrome')
    assert.deepEqual(THEMES.map((theme) => theme.id), ['monochrome', 'strawberry', 'dismantle'])
  })

  it('keeps the monochrome paper and flash colours exactly as they were', () => {
    const monochrome = themeDefinition('monochrome')
    assert.equal(monochrome.paperInk, PAPER_INK)
    assert.equal(monochrome.flash, FLASH_PALETTES)
  })

  it('gives every theme a full set of flash cards, a preview and a browser colour', () => {
    for (const theme of THEMES) {
      assert.deepEqual(Object.keys(theme.flash).sort(), Object.keys(FLASH_PALETTES).sort(), theme.id)
      assert.match(theme.themeColor, /^#[0-9a-f]{6}$/i, theme.id)
      assert.ok(theme.name && theme.caption, theme.id)
      for (const channel of [...theme.paperInk.paper, ...theme.paperInk.shadow]) {
        assert.ok(Number.isInteger(channel) && channel >= 0 && channel <= 255, theme.id)
      }
    }
  })

  it('sprinkles seeds only on the strawberry preview', () => {
    assert.equal(themeDefinition('monochrome').preview.seed, undefined)
    assert.ok(themeDefinition('strawberry').preview.seed)
    assert.equal(themeDefinition('dismantle').preview.seed, undefined)
  })

  it('cuts slashes only through the dismantle preview, drawn dark for a dark page', () => {
    assert.equal(themeDefinition('monochrome').preview.slash, undefined)
    assert.equal(themeDefinition('strawberry').preview.slash, undefined)
    const dismantle = themeDefinition('dismantle')
    assert.match(dismantle.preview.slash ?? '', /^#[0-9a-f]{6}$/i)
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    assert.ok(luminance(dismantle.themeColor) < 0.05)
    assert.ok(luminance(dismantle.preview.paper) < luminance(dismantle.preview.ink))
  })
})

describe('what each theme says', () => {
  it('keeps the monochrome words exactly as they were', () => {
    const copy = themeDefinition('monochrome').copy
    assert.equal(copy, MONOCHROME_COPY)
    assert.equal(copy.title, DEFAULT_TITLE)
    assert.equal(copy.subtitle, 'Less thinking. More showing up.')
    assert.equal(copy.intentionCaption, "THAT'S THE WHOLE IDEA.")
    assert.deepEqual(copy.todayLines, ['A small step today.', 'A different you tomorrow.'])
    assert.equal(copy.ritualsHeading, 'THE DAILY RITUALS')
    assert.equal(copy.scoreLabel, 'CONSISTENCY')
    assert.equal(copy.notesEyebrow, 'WORDS TO LIVE BY.')
    assert.equal(copy.notesSubtitle, 'Principles, goals and quotes worth keeping close.')
    assert.equal(copy.notesSignoff, 'Keep what keeps you going.')
    assert.equal(copy.dayNoteHint, "SEE TODAY'S TASKS")
  })

  it('gives strawberry its own voice for every line', () => {
    const copy = themeDefinition('strawberry').copy
    assert.equal(copy.title, 'Soft Girl Grind')
    for (const [key, value] of Object.entries(copy)) {
      const lines = Array.isArray(value) ? value : [value]
      assert.ok(lines.every((line) => typeof line === 'string' && line.trim()), key)
    }
  })

  it('gives dismantle a voice of its own for every single line', () => {
    const copy = themeDefinition('dismantle').copy
    assert.equal(copy.title, 'Malevolent Grind')
    assert.equal(copy.legendDone, 'Dismantled')
    assert.equal(copy.notesTitleLead, 'Binding vows to')
    for (const [key, value] of Object.entries(copy)) {
      const lines = Array.isArray(value) ? value : [value]
      assert.ok(lines.every((line) => typeof line === 'string' && line.trim()), key)
      assert.notDeepEqual(value, MONOCHROME_COPY[key as keyof typeof MONOCHROME_COPY], key)
    }
  })

  it('shows the stock title in the theme’s words, but never rewrites a title someone chose', () => {
    assert.equal(presentTitle(DEFAULT_TITLE, 'strawberry'), 'Soft Girl Grind')
    assert.equal(presentTitle(` ${DEFAULT_TITLE} `, 'strawberry'), 'Soft Girl Grind')
    assert.equal(presentTitle(DEFAULT_TITLE, 'monochrome'), DEFAULT_TITLE)
    assert.equal(presentTitle('Marathon Season', 'strawberry'), 'Marathon Season')
    assert.equal(presentTitle('no excuses grind', 'strawberry'), 'no excuses grind')
    assert.equal(presentTitle('', 'strawberry'), '')
    assert.equal(presentTitle(DEFAULT_TITLE, 'dismantle'), 'Malevolent Grind')
    assert.equal(presentTitle('Marathon Season', 'dismantle'), 'Marathon Season')
  })

  it('saves the theme’s stock title as the stock title, so it never leaks elsewhere', () => {
    assert.equal(storedTitle('Soft Girl Grind', 'strawberry'), DEFAULT_TITLE)
    assert.equal(storedTitle('  Soft Girl Grind ', 'strawberry'), DEFAULT_TITLE)
    assert.equal(storedTitle('Soft Girl Grind!', 'strawberry'), 'Soft Girl Grind!')
    assert.equal(storedTitle(' Pilates Princess ', 'strawberry'), 'Pilates Princess')
    assert.equal(storedTitle(DEFAULT_TITLE, 'strawberry'), DEFAULT_TITLE)
    assert.equal(storedTitle('Soft Girl Grind', 'monochrome'), 'Soft Girl Grind')
    assert.equal(storedTitle('   ', 'strawberry'), '')
    assert.equal(storedTitle('Malevolent Grind', 'dismantle'), DEFAULT_TITLE)
    assert.equal(storedTitle('Malevolent Grind', 'strawberry'), 'Malevolent Grind')
    for (const theme of THEMES) {
      assert.equal(storedTitle(presentTitle(DEFAULT_TITLE, theme.id), theme.id), DEFAULT_TITLE, theme.id)
    }
  })
})

describe('reading a stored theme', () => {
  it('recognises only known themes', () => {
    assert.equal(isThemeId('strawberry'), true)
    assert.equal(isThemeId('monochrome'), true)
    assert.equal(isThemeId('dismantle'), true)
    for (const value of ['Strawberry', 'Dismantle', 'dark', '', null, undefined, 1, {}]) {
      assert.equal(isThemeId(value), false, String(value))
      assert.equal(parseTheme(value), DEFAULT_THEME, String(value))
    }
  })

  it('falls back to monochrome when nothing, garbage or no storage is there', () => {
    assert.equal(readStoredTheme(null), DEFAULT_THEME)
    assert.equal(readStoredTheme(new MemoryStorage()), DEFAULT_THEME)
    const storage = new MemoryStorage()
    storage.setItem(THEME_STORAGE_KEY, 'neon')
    assert.equal(readStoredTheme(storage), DEFAULT_THEME)
    assert.equal(readStoredTheme(new BrokenStorage()), DEFAULT_THEME)
  })

  it('remembers a choice, and reports when the browser refuses to', () => {
    const storage = new MemoryStorage()
    assert.equal(storeTheme(storage, 'strawberry'), true)
    assert.equal(readStoredTheme(storage), 'strawberry')
    assert.equal(storeTheme(new BrokenStorage(), 'strawberry'), false)
    assert.equal(storeTheme(null, 'strawberry'), false)
  })
})

describe('the theme store', () => {
  it('paints the stored theme straight away without writing anything', () => {
    const storage = new MemoryStorage()
    const applied: ThemeId[] = []
    const store = createThemeStore({ storage, apply: (theme) => applied.push(theme) })
    assert.equal(store.getSnapshot(), 'monochrome')
    assert.deepEqual(applied, ['monochrome'])
    assert.equal(storage.length, 0)
    // A first visit still counts as new, so the welcome guide is not skipped.
    assert.equal(shouldShowOnboarding(storage), true)
  })

  it('switches, saves and tells subscribers once per change', () => {
    const storage = new MemoryStorage()
    const applied: ThemeId[] = []
    const store = createThemeStore({ storage, apply: (theme) => applied.push(theme) })
    let notified = 0
    store.subscribe(() => { notified += 1 })
    store.setTheme('strawberry')
    store.setTheme('strawberry')
    assert.equal(store.getSnapshot(), 'strawberry')
    assert.equal(storage.getItem(THEME_STORAGE_KEY), 'strawberry')
    assert.deepEqual(applied, ['monochrome', 'strawberry'])
    assert.equal(notified, 1)
  })

  it('still switches for this visit when storage is unavailable', () => {
    const store = createThemeStore({ storage: new BrokenStorage(), apply: () => {} })
    store.setTheme('strawberry')
    assert.equal(store.getSnapshot(), 'strawberry')
  })

  it('refuses a theme that does not exist', () => {
    const store = createThemeStore({ storage: new MemoryStorage(), apply: () => {} })
    assert.throws(() => store.setTheme('neon' as ThemeId), /not an ANGELO theme/)
    assert.equal(store.getSnapshot(), 'monochrome')
  })

  it('follows a choice made in another tab while anyone is listening', () => {
    const storage = new MemoryStorage()
    const events = new EventTarget()
    const applied: ThemeId[] = []
    const store = createThemeStore({ storage, apply: (theme) => applied.push(theme), events })
    let notified = 0
    const unsubscribe = store.subscribe(() => { notified += 1 })

    storage.setItem(THEME_STORAGE_KEY, 'strawberry')
    events.dispatchEvent(storageEvent('angelo-routine-v1'))
    assert.equal(store.getSnapshot(), 'monochrome')
    events.dispatchEvent(storageEvent(THEME_STORAGE_KEY))
    assert.equal(store.getSnapshot(), 'strawberry')
    assert.equal(notified, 1)

    // Clearing storage elsewhere sends a null key and returns to the default.
    storage.values.clear()
    events.dispatchEvent(storageEvent(null))
    assert.equal(store.getSnapshot(), 'monochrome')
    assert.deepEqual(applied, ['monochrome', 'strawberry', 'monochrome'])

    unsubscribe()
    storage.setItem(THEME_STORAGE_KEY, 'strawberry')
    events.dispatchEvent(storageEvent(THEME_STORAGE_KEY))
    assert.equal(store.getSnapshot(), 'monochrome')
  })
})

describe('the strawberry check-in burst', () => {
  it('scatters the asked-for number of pieces through every shape', () => {
    const pieces = berryBurstPieces(11, seededRandom(7))
    assert.equal(pieces.length, 11)
    assert.deepEqual(new Set(pieces.map((piece) => piece.shape)), new Set(BERRY_BURST_SHAPES))
  })

  it('stays close to the cell and starts promptly', () => {
    for (const piece of berryBurstPieces(40, seededRandom(3))) {
      const distance = Math.hypot(piece.dx, piece.dy)
      assert.ok(distance >= 8 && distance <= 54, `distance ${distance}`)
      assert.ok(piece.delay >= 0 && piece.delay <= 50)
      assert.ok(piece.scale >= 0.7 && piece.scale <= 1.2)
      assert.ok(Math.abs(piece.rotate) <= 160)
    }
  })

  it('is the same burst for the same dice', () => {
    assert.deepEqual(berryBurstPieces(9, seededRandom(42)), berryBurstPieces(9, seededRandom(42)))
  })

  it('treats odd counts gently', () => {
    assert.deepEqual(berryBurstPieces(0, Math.random), [])
    assert.deepEqual(berryBurstPieces(-3, Math.random), [])
    assert.equal(berryBurstPieces(4.8, Math.random).length, 4)
  })

  it('does nothing where there is no page to draw on', () => {
    assert.doesNotThrow(() => spawnBerryBurst(10, 10))
  })
})

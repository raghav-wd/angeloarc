export const FLASH_REMINDER_MESSAGE = 'No excuses, just do it.'

export interface FlashPalette {
  background: string
  ink: string
}

export const FLASH_PALETTES: Record<'black' | 'white' | 'brown', FlashPalette> = {
  black: { background: '#0d0b09', ink: '#f2ead9' },
  white: { background: '#f3efe7', ink: '#16100a' },
  brown: { background: '#452a19', ink: '#f5ecdb' },
}

export interface FlashWord {
  text: string
  palette: keyof typeof FLASH_PALETTES
  background: string
  ink: string
  start: number
  duration: number
  fontSizeVw: number
  stretch: number
}

// Alternating dark and light keeps every cut a hard flash; repeating the cycle
// means adjacent words never share a background, whatever the sentence length.
const PALETTE_CYCLE = ['black', 'white', 'brown', 'white'] as const

// Words hold at least 520ms so no one-second window ever sees more than two
// opposing background flashes (WCAG 2.3.1), with a longer beat on the last word.
const MIN_WORD_DURATION = 520
const LAST_WORD_DURATION = 870

// The crescendo target in vw, capped so wide words still fit the viewport at
// the condensed glyph width (~0.54em per character after scaleX).
const FIRST_WORD_SIZE = 10
const LAST_WORD_SIZE = 44
const FIT_CAP = 174

export function buildFlashTimeline(message: string): FlashWord[] {
  if (typeof message !== 'string' || !message.trim()) {
    throw new Error('A flash reminder message must contain at least one word.')
  }
  const words = message.trim().toUpperCase().split(/\s+/)
  const lastIndex = words.length - 1
  let start = 0
  return words.map((text, index) => {
    const progress = lastIndex === 0 ? 1 : index / lastIndex
    const palette = PALETTE_CYCLE[index % PALETTE_CYCLE.length]
    const duration = index === lastIndex
      ? LAST_WORD_DURATION
      : Math.min(MIN_WORD_DURATION + Math.max(0, text.length - 5) * 25, 720)
    const target = FIRST_WORD_SIZE + (LAST_WORD_SIZE - FIRST_WORD_SIZE) * progress ** 1.15
    const word: FlashWord = {
      text,
      palette,
      ...FLASH_PALETTES[palette],
      start,
      duration,
      fontSizeVw: Math.round(Math.min(target, FIT_CAP / text.length) * 10) / 10,
      stretch: Math.round((1.32 + 0.32 * progress) * 100) / 100,
    }
    start += duration
    return word
  })
}

export const FLASH_WORDS: readonly FlashWord[] = buildFlashTimeline(FLASH_REMINDER_MESSAGE)

export function flashDuration(words: readonly FlashWord[]): number {
  return words.reduce((total, word) => total + word.duration, 0)
}

export const FLASH_REMINDER_DURATION = flashDuration(FLASH_WORDS)

export function flashWordAt(words: readonly FlashWord[], elapsed: number): FlashWord | null {
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    throw new Error('Flash reminder timing must be a nonnegative finite number.')
  }
  if (elapsed >= flashDuration(words)) return null
  return words.find((word) => elapsed < word.start + word.duration) ?? null
}

export function pickReminder(reminders: readonly string[], random: () => number): string {
  const usable = reminders.filter((reminder) => reminder.trim())
  if (usable.length === 0) return FLASH_REMINDER_MESSAGE
  const roll = random()
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
    throw new Error('Reminder selection needs a random number in [0, 1).')
  }
  return usable[Math.floor(roll * usable.length)]
}

export const NOISE_SPECKLE_CHANCE = 0.07

// Salt-and-pepper television static, written into an RGBA buffer the canvas
// scales up: mostly faint dust with occasional hard speckles.
export function fillNoise(pixels: Uint8ClampedArray, random: () => number, intensity = 1): Uint8ClampedArray {
  if (pixels.length === 0 || pixels.length % 4 !== 0) {
    throw new Error('Noise buffer must hold whole RGBA pixels.')
  }
  if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1) {
    throw new Error('Noise intensity must be between 0 and 1.')
  }
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const tone = random() < 0.48 ? 0 : 255
    const speckle = random() < NOISE_SPECKLE_CHANCE
    const strength = random()
    pixels[offset] = tone
    pixels[offset + 1] = tone
    pixels[offset + 2] = tone
    pixels[offset + 3] = (speckle ? 135 + strength * 110 : strength * 30) * intensity
  }
  return pixels
}

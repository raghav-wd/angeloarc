export const ONBOARDING_STORAGE_KEY = 'angelo-onboarding-v1'
const APP_STORAGE_PREFIX = 'angelo-'

export const ONBOARDING_STEPS = 3

export type OnboardingProgress = 'started' | 'done'

export interface OnboardingStorage {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function onboardingStorage(): OnboardingStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

// A visitor is new when this browser holds no ANGELO data at all, so people
// who used the app before the guide existed are left alone. A guide that was
// shown but never finished or skipped comes back on the next visit. Without
// readable storage nothing can be remembered, so the guide stays out of the
// way rather than greeting the same person on every load.
export function shouldShowOnboarding(storage: OnboardingStorage | null): boolean {
  if (!storage) return false
  try {
    const progress = storage.getItem(ONBOARDING_STORAGE_KEY)
    if (progress === 'done') return false
    if (progress === 'started') return true
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key && key !== ONBOARDING_STORAGE_KEY && key.startsWith(APP_STORAGE_PREFIX)) return false
    }
    return true
  } catch {
    return false
  }
}

export function recordOnboardingProgress(storage: OnboardingStorage | null, progress: OnboardingProgress): void {
  if (!storage) return
  try {
    if (progress === 'started' && storage.getItem(ONBOARDING_STORAGE_KEY) === 'done') return
    storage.setItem(ONBOARDING_STORAGE_KEY, progress)
  } catch {
    // The guide simply is not remembered when the browser refuses to store it.
  }
}

export function clampOnboardingStep(step: number): number {
  if (!Number.isFinite(step)) return 0
  return Math.min(ONBOARDING_STEPS - 1, Math.max(0, Math.trunc(step)))
}

export const CONFETTI_SHAPES = ['star', 'heart', 'sparkle', 'dot', 'squiggle'] as const
export const CONFETTI_TONES = ['ink', 'yellow', 'coral', 'paper'] as const

export type ConfettiShape = (typeof CONFETTI_SHAPES)[number]
export type ConfettiTone = (typeof CONFETTI_TONES)[number]

export interface ConfettiPiece {
  dx: number
  dy: number
  rotate: number
  scale: number
  delay: number
  shape: ConfettiShape
  tone: ConfettiTone
}

// Doodles fly out all the way round, leaning upwards, before gravity takes them.
export function confettiPieces(count: number, random: () => number): ConfettiPiece[] {
  const total = Math.max(0, Math.floor(count))
  return Array.from({ length: total }, (_, index) => {
    const angle = (index / total) * Math.PI * 2 + (random() - 0.5) * 0.7
    const distance = 70 + random() * 130
    return {
      dx: Math.round(Math.cos(angle) * distance),
      dy: Math.round(Math.sin(angle) * distance * 0.75 - 36),
      rotate: Math.round((random() - 0.5) * 560),
      scale: Math.round((0.55 + random() * 0.65) * 100) / 100,
      delay: Math.round(random() * 110),
      shape: CONFETTI_SHAPES[index % CONFETTI_SHAPES.length],
      tone: CONFETTI_TONES[(index * 3 + 1) % CONFETTI_TONES.length],
    }
  })
}

// Today's share of the demo list, as the week arc's centre shows it.
export function onboardingConsistency(done: readonly boolean[]): number {
  if (done.length === 0) return 0
  return Math.round((done.filter(Boolean).length / done.length) * 100)
}

const roundTo = (value: number) => Math.round(value * 100) / 100

// Angles run clockwise from twelve o'clock, like the tracker wheel.
export function polarPoint(cx: number, cy: number, radius: number, degrees: number): [number, number] {
  const radians = (degrees * Math.PI) / 180
  return [roundTo(cx + radius * Math.sin(radians)), roundTo(cy - radius * Math.cos(radians))]
}

// The week arc opens like the ANGELO mark: from twelve o'clock round to nine.
export function weekArcSpans(days = 7, sweep = 270, gap = 3): Array<[number, number]> {
  const step = sweep / days
  return Array.from({ length: days }, (_, day) => [
    roundTo(day * step + gap / 2),
    roundTo((day + 1) * step - gap / 2),
  ])
}

export function annularSectorPath(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startDegrees: number,
  endDegrees: number,
): string {
  const largeArc = endDegrees - startDegrees > 180 ? 1 : 0
  const [outerStartX, outerStartY] = polarPoint(cx, cy, outerRadius, startDegrees)
  const [outerEndX, outerEndY] = polarPoint(cx, cy, outerRadius, endDegrees)
  const [innerEndX, innerEndY] = polarPoint(cx, cy, innerRadius, endDegrees)
  const [innerStartX, innerStartY] = polarPoint(cx, cy, innerRadius, startDegrees)
  return [
    `M${outerStartX} ${outerStartY}`,
    `A${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEndX} ${outerEndY}`,
    `L${innerEndX} ${innerEndY}`,
    `A${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStartX} ${innerStartY}`,
    'Z',
  ].join('')
}

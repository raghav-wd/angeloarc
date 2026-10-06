export const CHECKBOX_MORPH_DURATION = 420

export type CheckboxPoint = readonly [x: number, y: number]

// One open stroke on a 20-unit grid. The box starts at its top-left corner and
// runs down, across, up and back along the top, so every side has a part in
// the tick: the left side tips into the short stroke, the bottom shrinks into
// the elbow, the right side swings out into the long stroke and the top folds
// away into its tip.
const box: readonly CheckboxPoint[] = [[3.5, 3.5], [3.5, 16.5], [16.5, 16.5], [16.5, 3.5], [3.5, 3.5]]
const tick: readonly CheckboxPoint[] = [[4.4, 10.4], [8.2, 14.2], [8.2, 14.2], [15.8, 5.6], [15.8, 5.6]]

function rounded(value: number): number {
  return Number(value.toFixed(3))
}

function validProgress(progress: number): boolean {
  return Number.isFinite(progress) && progress >= 0 && progress <= 1
}

/** The box part of the way to the tick, vertex by vertex. */
export function checkboxMorphPoints(progress: number): CheckboxPoint[] {
  if (!validProgress(progress)) {
    throw new Error('Checkbox morph progress must be between 0 and 1.')
  }
  return box.map(([x, y], index) => {
    const [tickX, tickY] = tick[index]
    return [x + (tickX - x) * progress, y + (tickY - y) * progress] as const
  })
}

export function checkboxMorphPath(progress: number): string {
  return checkboxMorphPoints(progress)
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${rounded(x)} ${rounded(y)}`)
    .join(' ')
}

export function checkboxMorphEase(progress: number): number {
  const t = Math.min(1, Math.max(0, progress))
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2
}

/**
 * Where a morph that set off from `from` towards `to` stands after `elapsed`
 * milliseconds. Turning back part-way only covers the distance already
 * travelled, at the same pace, so a quick change of mind never jumps.
 */
export function checkboxMorphProgress(elapsed: number, from: number, to: number): number {
  if (!Number.isFinite(elapsed) || elapsed < 0 || !validProgress(from) || !validProgress(to)) {
    throw new Error('Checkbox morph timing must be nonnegative and progress must be between 0 and 1.')
  }
  const duration = CHECKBOX_MORPH_DURATION * Math.abs(to - from)
  if (elapsed >= duration) return to
  return from + (to - from) * checkboxMorphEase(elapsed / duration)
}

export const BOX_PATH = checkboxMorphPath(0)
export const TICK_PATH = checkboxMorphPath(1)

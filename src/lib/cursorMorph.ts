export const CURSOR_MORPH_DURATION = 560

// Matching clockwise vertices let the original outline deform without swapping icons.
const triangle = [
  [3, 2.5], [7.1, 5.4], [10.3, 7.4], [13.8, 10.1],
  [17.2, 12.1], [22.7, 16.1], [14.2, 17.2], [11.3, 26.8],
  [9.1, 20.1], [8.2, 16.3], [6.5, 12.3], [5.5, 8.1],
] as const

const cross = [
  [-5, -2.5], [-2.5, -5], [3, 0.5], [8.5, -5],
  [11, -2.5], [5.5, 3], [11, 8.5], [8.5, 11],
  [3, 5.5], [-2.5, 11], [-5, 8.5], [0.5, 3],
] as const

export function cursorMorphPath(progress: number): string {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new Error('Cursor morph progress must be between 0 and 1.')
  }
  return triangle.map(([x, y], index) => {
    const [targetX, targetY] = cross[index]
    const nextX = Number((x + (targetX - x) * progress).toFixed(3))
    const nextY = Number((y + (targetY - y) * progress).toFixed(3))
    return `${index === 0 ? 'M' : 'L'}${nextX} ${nextY}`
  }).join(' ') + ' Z'
}

export function cursorMorphProgress(elapsed: number, from = 0): number {
  if (!Number.isFinite(elapsed) || elapsed < 0 || !Number.isFinite(from) || from < 0 || from > 1) {
    throw new Error('Cursor morph timing and starting progress must be valid nonnegative values.')
  }
  if (elapsed < 180) {
    return from + (1 - from) * (1 - (1 - elapsed / 180) ** 3)
  }
  if (elapsed <= 320) return 1
  if (elapsed >= CURSOR_MORPH_DURATION) return 0
  const t = (elapsed - 320) / (CURSOR_MORPH_DURATION - 320)
  const eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2
  return 1 - eased
}

export const TRIANGLE_CURSOR_PATH = cursorMorphPath(0)
export const CROSS_CURSOR_PATH = cursorMorphPath(1)

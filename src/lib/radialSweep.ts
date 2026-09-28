// Radial sweep choreography for trading the homepage tracker for an inline panel.
// Every participant joins one clockwise revolution that starts, like day one of
// the tracker, at the top of the wheel.

export const SWEEP_STAGGER = 880
export const SWEEP_OUT_DURATION = 1180
export const SWEEP_IN_DURATION = 1300
export const PANEL_EXIT_DURATION = 220

export function sweepProgress(angleDeg: number): number {
  if (!Number.isFinite(angleDeg)) {
    throw new Error('Sweep angle must be a finite number of degrees.')
  }
  return ((((angleDeg + 90) % 360) + 360) % 360) / 360
}

// Where the page copy sits around the wheel: top, then right, then bottom,
// then left, expressed as fractions of the same revolution the cells follow.
export const TEXT_SWEEP = {
  heroHeading: 0,
  dayNote: 0.24,
  flashTrigger: 0.38,
  footerSignoff: 0.44,
  monthNavigation: 0.5,
  footerGuide: 0.58,
  intentionNote: 0.66,
  emptyTracker: 0.25,
  consistencyScore: 0.82,
  ritualsHeading: 0.97,
} as const

// Habit names fill the wheel's empty upper-left quadrant, so after the last
// day cell the sweep climbs them bottom to top before finishing at the heading.
export function habitLabelProgress(index: number, count: number): number {
  if (!Number.isInteger(index) || !Number.isInteger(count) || count < 1 || index < 0 || index >= count) {
    throw new Error('Habit label sweep needs a valid index within the habit count.')
  }
  if (count === 1) return 0.87
  return 0.78 + 0.16 * ((count - 1 - index) / (count - 1))
}

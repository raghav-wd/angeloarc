import type { CursorMode } from './cursorMorph.ts'

let mode: CursorMode = 'pointer'
const listeners = new Set<(mode: CursorMode) => void>()

export function getCursorMode(): CursorMode {
  return mode
}

/** Asks the custom cursor to morph into another outline. Touch screens have no cursor and ignore it. */
export function setCursorMode(next: CursorMode): void {
  if (next === mode) return
  mode = next
  for (const listener of listeners) listener(next)
}

export function subscribeCursorMode(listener: (mode: CursorMode) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Where a guide holds the cursor's hotspot, in viewport pixels, and how far it leans, in degrees. */
export interface CursorGuide {
  x: number
  y: number
  tilt: number
}

export interface CursorGuideHandle {
  /** Moves the cursor; false once a later guide has taken over or this one let go. */
  move(guide: CursorGuide): boolean
  /** Hands the cursor back to the pointer, unless a later guide has taken over. */
  release(): void
}

type GuideListener = (guide: CursorGuide | null, owner: number) => void

let guideOwner = 0
let guide: CursorGuide | null = null
const guideListeners = new Set<GuideListener>()

function validGuide(next: CursorGuide): boolean {
  return Number.isFinite(next.x) && Number.isFinite(next.y) && Number.isFinite(next.tilt)
}

/**
 * Borrows the cursor so it can act something out, such as a pencil drawing a
 * line. The newest guide always wins; the pointer gets the cursor back when
 * the guide lets go.
 */
export function claimCursorGuide(): CursorGuideHandle {
  guideOwner += 1
  const owner = guideOwner
  return {
    move(next) {
      if (owner !== guideOwner) return false
      if (!validGuide(next)) throw new Error('A cursor guide needs a finite position and tilt.')
      guide = { x: next.x, y: next.y, tilt: next.tilt }
      for (const listener of guideListeners) listener(guide, owner)
      return true
    },
    release() {
      if (owner !== guideOwner) return
      // A spent handle can never steer again, even before anyone else claims.
      guideOwner += 1
      const held = guide !== null
      guide = null
      if (held) for (const listener of guideListeners) listener(null, owner)
    },
  }
}

export function getCursorGuide(): CursorGuide | null {
  return guide
}

/** Hears every guided position, with the claim it belongs to, and null when the pointer takes over again. */
export function subscribeCursorGuide(listener: GuideListener): () => void {
  guideListeners.add(listener)
  return () => {
    guideListeners.delete(listener)
  }
}

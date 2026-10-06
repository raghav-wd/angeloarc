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

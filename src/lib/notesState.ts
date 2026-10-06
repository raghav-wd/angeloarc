import type { NotesState } from './api.ts'
import {
  emptyDailyNotes,
  mergeDailyNotes,
  parseStoredDailyNotes,
  serializeDailyNotes,
} from './dailyNotes.ts'
import {
  createStarterPaperNotes,
  mergePaperNotes,
  parseStoredPaperNotes,
  serializePaperNotes,
} from './paperNotes.ts'
import type { DailyNotes } from './dailyNotes.ts'
import type { PaperNotes } from './paperNotes.ts'

export const NOTES_STATE_VERSION = 1 as const
// Kept in step with backend/src/notes.ts. This leaves enough room for the
// largest valid tracker when both are sent together during signup.
export const MAX_CLOUD_NOTES_BYTES = 88 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).length === fields.length
    && fields.every((field) => Object.hasOwn(value, field))
}

/** Validates and freezes a notes payload received from the private API. */
export function parseNotesState(value: unknown): NotesState {
  if (!isRecord(value) || !hasExactFields(value, ['version', 'dailyNotes', 'paperNotes'])) {
    throw new Error('Cloud notes must contain exactly version, dailyNotes, and paperNotes.')
  }
  if (value.version !== NOTES_STATE_VERSION) {
    throw new Error(`Unsupported cloud notes version: ${String(value.version)}.`)
  }

  const dailyNotes = parseStoredDailyNotes(JSON.stringify({
    version: NOTES_STATE_VERSION,
    notes: value.dailyNotes,
  }))
  const paperNotes = parseStoredPaperNotes(JSON.stringify({
    version: NOTES_STATE_VERSION,
    notes: value.paperNotes,
  }))

  return Object.freeze({ version: NOTES_STATE_VERSION, dailyNotes, paperNotes })
}

export function createNotesState(dailyNotes: DailyNotes, paperNotes: PaperNotes): NotesState {
  return parseNotesState({ version: NOTES_STATE_VERSION, dailyNotes, paperNotes })
}

export function createInitialNotesState(now: Date = new Date()): NotesState {
  return createNotesState(emptyDailyNotes(), createStarterPaperNotes(now))
}

/** Cloud/account values win conflicts; legacy values only fill missing entries. */
export function mergeNotesStates(legacy: NotesState, cloud: NotesState): NotesState {
  return createNotesState(
    mergeDailyNotes(legacy.dailyNotes, cloud.dailyNotes),
    mergePaperNotes(legacy.paperNotes, cloud.paperNotes),
  )
}

export function serializeNotesState(notes: NotesState): string {
  const valid = parseNotesState(notes)
  return JSON.stringify({
    version: NOTES_STATE_VERSION,
    dailyNotes: JSON.parse(serializeDailyNotes(valid.dailyNotes)).notes as unknown,
    paperNotes: JSON.parse(serializePaperNotes(valid.paperNotes)).notes as unknown,
  })
}

export function notesStateByteLength(notes: NotesState): number {
  return new TextEncoder().encode(serializeNotesState(notes)).byteLength
}

import { dateKey } from './tracker.ts'

export const DAILY_NOTES_VERSION = 1 as const
export const DAILY_NOTES_STORAGE_PREFIX = 'angelo-daily-notes-v1:'

export type DailyNotes = Readonly<Record<string, string>>

interface StoredDailyNotes {
  version: typeof DAILY_NOTES_VERSION
  notes: Record<string, string>
}

export interface DailyNotesStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export class DailyNotesValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DailyNotesValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).length === fields.length
    && fields.every((field) => Object.hasOwn(value, field))
}

/** Returns true only for a real, zero-padded YYYY-MM-DD calendar date. */
export function isValidDailyNoteDateKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false

  const month = { year: Number(match[1]), month: Number(match[2]) - 1 }
  const day = Number(match[3])
  try {
    return dateKey(month, day) === value
  } catch {
    return false
  }
}

function validatedNotes(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    throw new DailyNotesValidationError('Daily notes must be stored in a date-keyed object.')
  }

  const notes: Record<string, string> = {}
  for (const key of Object.keys(value).sort()) {
    if (!isValidDailyNoteDateKey(key)) {
      throw new DailyNotesValidationError(`Invalid daily note date: "${key}".`)
    }
    const note = value[key]
    if (typeof note !== 'string') {
      throw new DailyNotesValidationError(`The daily note for ${key} must be text.`)
    }
    if (!note.trim()) {
      throw new DailyNotesValidationError(`The daily note for ${key} cannot be whitespace-only.`)
    }
    notes[key] = note
  }
  return notes
}

function immutableNotes(notes: Record<string, string>): DailyNotes {
  return Object.freeze(notes)
}

export function emptyDailyNotes(): DailyNotes {
  return immutableNotes({})
}

/** Parses and strictly validates the complete versioned local-storage payload. */
export function parseStoredDailyNotes(serialized: string): DailyNotes {
  if (typeof serialized !== 'string') {
    throw new DailyNotesValidationError('Stored daily notes must be JSON text.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    throw new DailyNotesValidationError('Stored daily notes are not valid JSON.')
  }

  if (!isRecord(parsed) || !hasExactFields(parsed, ['version', 'notes'])) {
    throw new DailyNotesValidationError('Stored daily notes must contain exactly version and notes.')
  }
  if (parsed.version !== DAILY_NOTES_VERSION) {
    throw new DailyNotesValidationError(`Unsupported daily notes version: ${String(parsed.version)}.`)
  }

  return immutableNotes(validatedNotes(parsed.notes))
}

/** Produces stable JSON by writing date keys in ascending order. */
export function serializeDailyNotes(dailyNotes: DailyNotes): string {
  const notes = validatedNotes(dailyNotes)
  const stored: StoredDailyNotes = { version: DAILY_NOTES_VERSION, notes }
  return JSON.stringify(stored)
}

/**
 * Returns a new date-keyed notes object without changing the input. Exact note
 * text is retained; only an all-whitespace value removes the note.
 */
export function updateDailyNote(
  dailyNotes: DailyNotes,
  key: string,
  text: string,
): DailyNotes {
  if (!isValidDailyNoteDateKey(key)) {
    throw new DailyNotesValidationError(`Invalid daily note date: "${key}".`)
  }
  if (typeof text !== 'string') {
    throw new DailyNotesValidationError('A daily note must be text.')
  }

  const shouldDelete = !text.trim()
  if ((shouldDelete && !Object.hasOwn(dailyNotes, key)) || dailyNotes[key] === text) {
    return dailyNotes
  }

  const next: Record<string, string> = { ...dailyNotes }
  if (shouldDelete) delete next[key]
  else next[key] = text

  const ordered: Record<string, string> = {}
  for (const date of Object.keys(next).sort()) ordered[date] = next[date]
  return immutableNotes(ordered)
}

/** Account notes win on the unlikely event that both scopes contain a date. */
export function mergeDailyNotes(guestNotes: DailyNotes, accountNotes: DailyNotes): DailyNotes {
  const merged = validatedNotes({ ...guestNotes, ...accountNotes })
  return immutableNotes(merged)
}

export function normalizeDailyNotesUsername(username?: string | null): string | null {
  if (typeof username !== 'string') return null
  const normalized = username.trim().toLowerCase()
  return normalized || null
}

export function dailyNotesStorageKey(username?: string | null): string {
  const normalized = normalizeDailyNotesUsername(username)
  return normalized
    ? `${DAILY_NOTES_STORAGE_PREFIX}account:${encodeURIComponent(normalized)}`
    : `${DAILY_NOTES_STORAGE_PREFIX}guest`
}

export function readDailyNotes(
  storage: Pick<DailyNotesStorage, 'getItem'>,
  username?: string | null,
): DailyNotes {
  const serialized = storage.getItem(dailyNotesStorageKey(username))
  return serialized === null ? emptyDailyNotes() : parseStoredDailyNotes(serialized)
}

export function writeDailyNotes(
  storage: Pick<DailyNotesStorage, 'setItem'>,
  dailyNotes: DailyNotes,
  username?: string | null,
): void {
  storage.setItem(dailyNotesStorageKey(username), serializeDailyNotes(dailyNotes))
}

import { ApiError } from './errors.js'
import { PAPER_NOTE_KINDS } from './types.js'
import type { NotesState, PaperNote, PaperNoteKind } from './types.js'

export const NOTES_VERSION = 1 as const
// Leaves enough room for a maximum-size tracker plus signup credentials inside
// the API's 800 KiB request limit. Notes are stored in their own Firestore doc.
export const MAX_NOTES_BYTES = 88 * 1024
export const MAX_PAPER_NOTES = 12
export const MAX_PAPER_NOTE_TITLE_LENGTH = 48
export const MAX_PAPER_NOTE_BODY_LENGTH = 800

const NOTES_FIELDS = ['version', 'dailyNotes', 'paperNotes'] as const
const PAPER_NOTE_FIELDS = ['id', 'kind', 'title', 'body', 'createdAt', 'updatedAt'] as const
const PAPER_NOTE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function invalidNotes(message: string): never {
  throw new ApiError(400, 'INVALID_NOTES', message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  const keys = Object.keys(value)
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(value, field))
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    return leap ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

export function isValidDailyNoteDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}

function isPaperNoteKind(value: unknown): value is PaperNoteKind {
  return typeof value === 'string' && (PAPER_NOTE_KINDS as readonly string[]).includes(value)
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

function validateDailyNotes(value: unknown): Record<string, string> {
  if (!isRecord(value)) invalidNotes('Daily notes must be a date-keyed object.')
  const dailyNotes: Record<string, string> = {}
  for (const date of Object.keys(value).sort()) {
    if (!isValidDailyNoteDate(date)) invalidNotes(`Daily note date "${date}" is invalid.`)
    const text = value[date]
    if (typeof text !== 'string') invalidNotes(`The daily note for ${date} must be text.`)
    if (!text.trim()) invalidNotes(`The daily note for ${date} cannot be blank.`)
    dailyNotes[date] = text
  }
  return dailyNotes
}

function validatePaperNote(value: unknown, index: number): PaperNote {
  const label = `Paper note ${index + 1}`
  if (!isRecord(value) || !hasExactFields(value, PAPER_NOTE_FIELDS)) {
    invalidNotes(`${label} must contain exactly id, kind, title, body, createdAt, and updatedAt.`)
  }
  const { id, kind, title, body, createdAt, updatedAt } = value
  if (typeof id !== 'string' || !PAPER_NOTE_ID_PATTERN.test(id)) {
    invalidNotes(`${label} has an invalid id.`)
  }
  if (!isPaperNoteKind(kind)) invalidNotes(`${label} has an invalid kind.`)
  if (typeof title !== 'string' || title.length > MAX_PAPER_NOTE_TITLE_LENGTH) {
    invalidNotes(`${label} title must contain at most ${MAX_PAPER_NOTE_TITLE_LENGTH} characters.`)
  }
  if (typeof body !== 'string' || body.length > MAX_PAPER_NOTE_BODY_LENGTH) {
    invalidNotes(`${label} body must contain at most ${MAX_PAPER_NOTE_BODY_LENGTH} characters.`)
  }
  if (!title.trim() && !body.trim()) invalidNotes(`${label} cannot be blank.`)
  if (!isTimestamp(createdAt) || !isTimestamp(updatedAt)) {
    invalidNotes(`${label} has an invalid timestamp.`)
  }
  return { id, kind, title, body, createdAt, updatedAt }
}

function validatePaperNotes(value: unknown): PaperNote[] {
  if (!Array.isArray(value) || value.length > MAX_PAPER_NOTES) {
    invalidNotes(`Paper notes must be an array of at most ${MAX_PAPER_NOTES} notes.`)
  }
  const ids = new Set<string>()
  return value.map((item, index) => {
    const note = validatePaperNote(item, index)
    if (ids.has(note.id)) invalidNotes('Paper note ids must be unique.')
    ids.add(note.id)
    return note
  })
}

export function validateNotesState(value: unknown): NotesState {
  if (!isRecord(value) || !hasExactFields(value, NOTES_FIELDS)) {
    invalidNotes('Notes must contain exactly version, dailyNotes, and paperNotes.')
  }
  if (value.version !== NOTES_VERSION) {
    invalidNotes(`Notes version must be ${NOTES_VERSION}.`)
  }
  const notes: NotesState = {
    version: NOTES_VERSION,
    dailyNotes: validateDailyNotes(value.dailyNotes),
    paperNotes: validatePaperNotes(value.paperNotes),
  }
  if (Buffer.byteLength(JSON.stringify(notes), 'utf8') > MAX_NOTES_BYTES) {
    invalidNotes(`Notes must be at most ${MAX_NOTES_BYTES} bytes.`)
  }
  return notes
}

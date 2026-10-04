export const PAPER_NOTES_VERSION = 1 as const
export const PAPER_NOTES_STORAGE_PREFIX = 'angelo-paper-notes-v1:'
export const MAX_PAPER_NOTES = 12
export const MAX_PAPER_NOTE_TITLE_LENGTH = 48
export const MAX_PAPER_NOTE_BODY_LENGTH = 800
export const PAPER_NOTE_KINDS = ['principle', 'goal', 'quote', 'note'] as const

export type PaperNoteKind = (typeof PAPER_NOTE_KINDS)[number]

export interface PaperNote {
  id: string
  kind: PaperNoteKind
  title: string
  body: string
  createdAt: string
  updatedAt: string
}

export type PaperNotes = readonly PaperNote[]

interface StoredPaperNotes {
  version: typeof PAPER_NOTES_VERSION
  notes: PaperNote[]
}

export interface PaperNotesStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export class PaperNotesValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaperNotesValidationError'
  }
}

const NOTE_FIELDS = ['id', 'kind', 'title', 'body', 'createdAt', 'updatedAt'] as const
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export const PAPER_NOTE_KIND_LABELS: Readonly<Record<PaperNoteKind, string>> = {
  principle: 'Principle',
  goal: 'Goal',
  quote: 'Quote',
  note: 'Note',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).length === fields.length
    && fields.every((field) => Object.hasOwn(value, field))
}

export function isPaperNoteKind(value: unknown): value is PaperNoteKind {
  return typeof value === 'string' && (PAPER_NOTE_KINDS as readonly string[]).includes(value)
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString() === value
}

/** A note with neither a title nor a body has nothing worth keeping. */
export function isBlankPaperNote(note: Pick<PaperNote, 'title' | 'body'>): boolean {
  return !note.title.trim() && !note.body.trim()
}

function validatedNote(value: unknown, position: number): PaperNote {
  const label = `Paper note ${position + 1}`
  if (!isRecord(value) || !hasExactFields(value, NOTE_FIELDS)) {
    throw new PaperNotesValidationError(
      `${label} must contain exactly id, kind, title, body, createdAt, and updatedAt.`,
    )
  }
  const { id, kind, title, body, createdAt, updatedAt } = value
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new PaperNotesValidationError(`${label} has an invalid id.`)
  }
  if (!isPaperNoteKind(kind)) {
    throw new PaperNotesValidationError(`${label} has an unknown kind.`)
  }
  if (typeof title !== 'string' || title.length > MAX_PAPER_NOTE_TITLE_LENGTH) {
    throw new PaperNotesValidationError(
      `${label} needs a text title of at most ${MAX_PAPER_NOTE_TITLE_LENGTH} characters.`,
    )
  }
  if (typeof body !== 'string' || body.length > MAX_PAPER_NOTE_BODY_LENGTH) {
    throw new PaperNotesValidationError(
      `${label} needs text of at most ${MAX_PAPER_NOTE_BODY_LENGTH} characters.`,
    )
  }
  if (!title.trim() && !body.trim()) {
    throw new PaperNotesValidationError(`${label} cannot be blank.`)
  }
  if (!isTimestamp(createdAt) || !isTimestamp(updatedAt)) {
    throw new PaperNotesValidationError(`${label} has an invalid timestamp.`)
  }
  return Object.freeze({ id, kind, title, body, createdAt, updatedAt })
}

function validatedNotes(value: unknown): PaperNotes {
  if (!Array.isArray(value)) {
    throw new PaperNotesValidationError('Paper notes must be stored as a list.')
  }
  if (value.length > MAX_PAPER_NOTES) {
    throw new PaperNotesValidationError(`Keep at most ${MAX_PAPER_NOTES} paper notes.`)
  }
  const ids = new Set<string>()
  const notes = value.map((item, index) => {
    const note = validatedNote(item, index)
    if (ids.has(note.id)) {
      throw new PaperNotesValidationError(`Paper note ids must be unique: "${note.id}".`)
    }
    ids.add(note.id)
    return note
  })
  return Object.freeze(notes)
}

export function emptyPaperNotes(): PaperNotes {
  return Object.freeze([])
}

/** Parses and strictly validates the complete versioned local-storage payload. */
export function parseStoredPaperNotes(serialized: string): PaperNotes {
  if (typeof serialized !== 'string') {
    throw new PaperNotesValidationError('Stored paper notes must be JSON text.')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    throw new PaperNotesValidationError('Stored paper notes are not valid JSON.')
  }
  if (!isRecord(parsed) || !hasExactFields(parsed, ['version', 'notes'])) {
    throw new PaperNotesValidationError('Stored paper notes must contain exactly version and notes.')
  }
  if (parsed.version !== PAPER_NOTES_VERSION) {
    throw new PaperNotesValidationError(`Unsupported paper notes version: ${String(parsed.version)}.`)
  }
  return validatedNotes(parsed.notes)
}

export function serializePaperNotes(notes: PaperNotes): string {
  const stored: StoredPaperNotes = {
    version: PAPER_NOTES_VERSION,
    notes: validatedNotes(notes).map((note) => ({
      id: note.id,
      kind: note.kind,
      title: note.title,
      body: note.body,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    })),
  }
  return JSON.stringify(stored)
}

export function createPaperNoteId(random: () => number = Math.random): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  let id = 'note-'
  for (let index = 0; index < 16; index += 1) id += Math.floor(random() * 36).toString(36)
  return id
}

export function createPaperNoteDraft(
  now: Date = new Date(),
  id: string = createPaperNoteId(),
  kind: PaperNoteKind = 'note',
): PaperNote {
  if (!ID_PATTERN.test(id)) throw new PaperNotesValidationError('A paper note needs a valid id.')
  const timestamp = now.toISOString()
  return { id, kind, title: '', body: '', createdAt: timestamp, updatedAt: timestamp }
}

/**
 * Adds or replaces a note while keeping every other note in place, so a ball
 * never changes its spot in the cluster just because it was edited.
 */
export function savePaperNote(notes: PaperNotes, note: PaperNote): PaperNotes {
  const valid = validatedNote(note, notes.length)
  const index = notes.findIndex((existing) => existing.id === valid.id)
  if (index === -1) {
    if (notes.length >= MAX_PAPER_NOTES) {
      throw new PaperNotesValidationError(`Keep at most ${MAX_PAPER_NOTES} paper notes.`)
    }
    return Object.freeze([...notes, valid])
  }
  const current = notes[index]
  if (
    current.kind === valid.kind
    && current.title === valid.title
    && current.body === valid.body
    && current.createdAt === valid.createdAt
    && current.updatedAt === valid.updatedAt
  ) {
    return notes
  }
  const next = [...notes]
  next[index] = valid
  return Object.freeze(next)
}

export function removePaperNote(notes: PaperNotes, id: string): PaperNotes {
  if (!notes.some((note) => note.id === id)) return notes
  return Object.freeze(notes.filter((note) => note.id !== id))
}

/** Account notes win on id conflicts; guest notes fill any remaining room. */
export function mergePaperNotes(guestNotes: PaperNotes, accountNotes: PaperNotes): PaperNotes {
  const merged = [...validatedNotes(accountNotes)]
  const ids = new Set(merged.map((note) => note.id))
  for (const note of validatedNotes(guestNotes)) {
    if (merged.length >= MAX_PAPER_NOTES) break
    if (ids.has(note.id)) continue
    ids.add(note.id)
    merged.push(note)
  }
  return Object.freeze(merged)
}

/** The short caption printed under a paper ball. */
export function paperNoteLabel(note: Pick<PaperNote, 'title' | 'body'>): string {
  const title = note.title.trim().replace(/\s+/g, ' ')
  if (title) return title
  const firstLine = note.body.trim().split('\n')[0]?.trim().replace(/\s+/g, ' ') ?? ''
  if (!firstLine) return 'Untitled'
  const characters = Array.from(firstLine)
  return characters.length > 40 ? `${characters.slice(0, 39).join('').trimEnd()}\u2026` : firstLine
}

export function createStarterPaperNotes(now: Date = new Date()): PaperNotes {
  const timestamp = now.toISOString()
  const starters: Array<Pick<PaperNote, 'id' | 'kind' | 'title' | 'body'>> = [
    {
      id: 'starter-principle',
      kind: 'principle',
      title: 'Never miss twice',
      body: 'Missing one day is an accident. Missing two is the start of a new habit.\nWhatever happens today, show up tomorrow.',
    },
    {
      id: 'starter-goal',
      kind: 'goal',
      title: 'Read 12 books this year',
      body: 'One book a month. Twenty pages a day gets me there with room to spare.',
    },
    {
      id: 'starter-quote',
      kind: 'quote',
      title: 'Well begun is half done',
      body: '\u201cWell begun is half done.\u201d\n\u2014 Aristotle',
    },
  ]
  return validatedNotes(starters.map((note) => ({ ...note, createdAt: timestamp, updatedAt: timestamp })))
}

export function normalizePaperNotesUsername(username?: string | null): string | null {
  if (typeof username !== 'string') return null
  const normalized = username.trim().toLowerCase()
  return normalized || null
}

export function paperNotesStorageKey(username?: string | null): string {
  const normalized = normalizePaperNotesUsername(username)
  return normalized
    ? `${PAPER_NOTES_STORAGE_PREFIX}account:${encodeURIComponent(normalized)}`
    : `${PAPER_NOTES_STORAGE_PREFIX}guest`
}

/** A scope that has never been written to starts with the starter notes. */
export function readPaperNotes(
  storage: Pick<PaperNotesStorage, 'getItem'>,
  username?: string | null,
  now: Date = new Date(),
): PaperNotes {
  const serialized = storage.getItem(paperNotesStorageKey(username))
  return serialized === null ? createStarterPaperNotes(now) : parseStoredPaperNotes(serialized)
}

export function writePaperNotes(
  storage: Pick<PaperNotesStorage, 'setItem'>,
  notes: PaperNotes,
  username?: string | null,
): void {
  storage.setItem(paperNotesStorageKey(username), serializePaperNotes(notes))
}

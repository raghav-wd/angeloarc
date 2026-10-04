import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createPaperNoteDraft,
  createStarterPaperNotes,
  isBlankPaperNote,
  MAX_PAPER_NOTE_BODY_LENGTH,
  MAX_PAPER_NOTE_TITLE_LENGTH,
  MAX_PAPER_NOTES,
  mergePaperNotes,
  normalizePaperNotesUsername,
  PAPER_NOTES_STORAGE_PREFIX,
  PaperNotesValidationError,
  paperNoteLabel,
  paperNotesStorageKey,
  parseStoredPaperNotes,
  readPaperNotes,
  removePaperNote,
  savePaperNote,
  serializePaperNotes,
  writePaperNotes,
} from '../src/lib/paperNotes.ts'
import type { PaperNote } from '../src/lib/paperNotes.ts'

const NOW = new Date('2026-10-03T09:30:00.000Z')

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function note(id: string, overrides: Partial<PaperNote> = {}): PaperNote {
  return {
    id,
    kind: 'principle',
    title: `Title ${id}`,
    body: '',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  }
}

describe('paper notes serialization', () => {
  it('round-trips notes in order without trimming text', () => {
    const notes = [
      note('a', { kind: 'quote', title: '  Spaced  ', body: '\u201cWell begun\u201d\n\u2014 Aristotle\n' }),
      note('b', { kind: 'goal', title: '', body: 'Body only, h\u00e4\u00e4 \ud83e\udeb4' }),
    ]
    const parsed = parseStoredPaperNotes(serializePaperNotes(notes))
    assert.deepEqual(parsed, notes)
    assert.ok(Object.isFrozen(parsed))
    assert.ok(Object.isFrozen(parsed[0]))
  })

  it('writes exactly the stored fields in a stable order', () => {
    const extra = { ...note('a'), ignored: true } as unknown as PaperNote
    assert.throws(() => serializePaperNotes([extra]), PaperNotesValidationError)
    assert.equal(
      serializePaperNotes([note('a')]),
      '{"version":1,"notes":[{"id":"a","kind":"principle","title":"Title a","body":"","createdAt":"2026-10-03T09:30:00.000Z","updatedAt":"2026-10-03T09:30:00.000Z"}]}',
    )
  })

  it('strictly rejects malformed payloads', () => {
    const valid = note('a')
    const rejected: unknown[] = [
      null,
      [],
      {},
      { version: 1 },
      { version: 2, notes: [] },
      { version: 1, notes: {} },
      { version: 1, notes: [], extra: 1 },
      { version: 1, notes: [{ ...valid, extra: 1 }] },
      { version: 1, notes: [{ ...valid, id: '' }] },
      { version: 1, notes: [{ ...valid, id: 'has space' }] },
      { version: 1, notes: [{ ...valid, kind: 'idea' }] },
      { version: 1, notes: [{ ...valid, title: 4 }] },
      { version: 1, notes: [{ ...valid, title: 'x'.repeat(MAX_PAPER_NOTE_TITLE_LENGTH + 1) }] },
      { version: 1, notes: [{ ...valid, body: 'x'.repeat(MAX_PAPER_NOTE_BODY_LENGTH + 1) }] },
      { version: 1, notes: [{ ...valid, title: ' ', body: '\n\t' }] },
      { version: 1, notes: [{ ...valid, createdAt: '2026-10-03' }] },
      { version: 1, notes: [{ ...valid, updatedAt: '2026-02-30T00:00:00.000Z' }] },
      { version: 1, notes: [valid, { ...valid }] },
      { version: 1, notes: Array.from({ length: MAX_PAPER_NOTES + 1 }, (_, index) => note(`n${index}`)) },
    ]
    for (const value of rejected) {
      assert.throws(() => parseStoredPaperNotes(JSON.stringify(value)), PaperNotesValidationError, JSON.stringify(value)?.slice(0, 80))
    }
    for (const value of ['', '{', 'undefined']) {
      assert.throws(() => parseStoredPaperNotes(value), PaperNotesValidationError)
    }
  })
})

describe('paper note updates', () => {
  it('adds new notes at the end and replaces edited notes in place', () => {
    const original = Object.freeze([note('a'), note('b')])
    const added = savePaperNote(original, note('c'))
    assert.deepEqual(added.map((item) => item.id), ['a', 'b', 'c'])
    assert.deepEqual(original.map((item) => item.id), ['a', 'b'])

    const edited = savePaperNote(added, note('a', { title: 'Changed', updatedAt: '2026-10-04T00:00:00.000Z' }))
    assert.deepEqual(edited.map((item) => item.id), ['a', 'b', 'c'])
    assert.equal(edited[0].title, 'Changed')
    assert.equal(added[0].title, 'Title a')
  })

  it('returns the same list for no-op saves and missing removals', () => {
    const notes = Object.freeze([note('a')])
    assert.equal(savePaperNote(notes, note('a')), notes)
    assert.equal(removePaperNote(notes, 'missing'), notes)
    assert.deepEqual(removePaperNote(notes, 'a'), [])
  })

  it('refuses blank notes and notes past the limit', () => {
    assert.throws(() => savePaperNote([], note('a', { title: ' ', body: '' })), PaperNotesValidationError)
    const full = Array.from({ length: MAX_PAPER_NOTES }, (_, index) => note(`n${index}`))
    assert.throws(() => savePaperNote(full, note('extra')), PaperNotesValidationError)
    assert.equal(savePaperNote(full, note('n0', { title: 'Still editable' }))[0].title, 'Still editable')
  })

  it('creates blank drafts that only become valid once written in', () => {
    const draft = createPaperNoteDraft(NOW, 'draft-1', 'goal')
    assert.deepEqual(draft, {
      id: 'draft-1',
      kind: 'goal',
      title: '',
      body: '',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    })
    assert.equal(isBlankPaperNote(draft), true)
    assert.equal(isBlankPaperNote({ ...draft, body: 'Something' }), false)
    assert.throws(() => createPaperNoteDraft(NOW, 'bad id'), PaperNotesValidationError)
  })
})

describe('paper note labels', () => {
  it('prefers the title, then the first body line, then a placeholder', () => {
    assert.equal(paperNoteLabel({ title: '  Stay   curious ', body: 'ignored' }), 'Stay curious')
    assert.equal(paperNoteLabel({ title: '', body: '\n  First line \nSecond' }), 'First line')
    assert.equal(paperNoteLabel({ title: '', body: '' }), 'Untitled')
    const long = 'word '.repeat(20)
    const label = paperNoteLabel({ title: '', body: long })
    assert.ok(Array.from(label).length <= 40)
    assert.ok(label.endsWith('\u2026'))
  })
})

describe('paper note storage scopes', () => {
  it('separates guest notes from case-normalized account notes', () => {
    assert.equal(normalizePaperNotesUsername(undefined), null)
    assert.equal(normalizePaperNotesUsername('  '), null)
    assert.equal(paperNotesStorageKey(), `${PAPER_NOTES_STORAGE_PREFIX}guest`)
    assert.equal(paperNotesStorageKey(' Some_User '), `${PAPER_NOTES_STORAGE_PREFIX}account:some_user`)
    assert.notEqual(paperNotesStorageKey(), paperNotesStorageKey('guest'))
  })

  it('starts an untouched scope with valid starter notes and keeps an emptied one empty', () => {
    const storage = new MemoryStorage()
    const starters = readPaperNotes(storage, null, NOW)
    assert.deepEqual(starters, createStarterPaperNotes(NOW))
    assert.deepEqual(starters.map((item) => item.kind), ['principle', 'goal', 'quote'])

    writePaperNotes(storage, [], 'alice')
    assert.deepEqual(readPaperNotes(storage, 'ALICE', NOW), [])
    assert.deepEqual(readPaperNotes(storage, null, NOW), starters)
  })

  it('merges guest notes behind account notes without duplicates or overflow', () => {
    const guest = [note('shared', { title: 'Guest copy' }), note('g1'), note('g2')]
    const account = [note('shared', { title: 'Account copy' }), note('a1')]
    const merged = mergePaperNotes(guest, account)
    assert.deepEqual(merged.map((item) => item.id), ['shared', 'a1', 'g1', 'g2'])
    assert.equal(merged[0].title, 'Account copy')

    const fullAccount = Array.from({ length: MAX_PAPER_NOTES }, (_, index) => note(`a${index}`))
    assert.equal(mergePaperNotes(guest, fullAccount).length, MAX_PAPER_NOTES)
  })
})

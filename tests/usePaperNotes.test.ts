import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { paperNotesStorageKey, serializePaperNotes } from '../src/lib/paperNotes.ts'
import type { PaperNote } from '../src/lib/paperNotes.ts'

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

const storage = new MemoryStorage()
let mergeGuestPaperNotesIntoAccount: (username: string) => readonly PaperNote[]

function note(id: string, title = `Title ${id}`): PaperNote {
  const timestamp = '2026-10-03T09:30:00.000Z'
  return { id, kind: 'note', title, body: '', createdAt: timestamp, updatedAt: timestamp }
}

function store(notes: PaperNote[], username?: string) {
  storage.setItem(paperNotesStorageKey(username), serializePaperNotes(notes))
}

function stored(username?: string): string[] {
  const serialized = storage.getItem(paperNotesStorageKey(username))
  return serialized === null ? [] : JSON.parse(serialized).notes.map((item: PaperNote) => item.id)
}

before(async () => {
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  ;({ mergeGuestPaperNotesIntoAccount } = await import('../src/hooks/usePaperNotes.ts'))
})

describe('copying guest notes to self into a new account', () => {
  it('gives a brand-new account exactly the guest notes, not the starters as well', () => {
    store([note('g1'), note('g2')])
    assert.deepEqual(mergeGuestPaperNotesIntoAccount('fresh_user').map((item) => item.id), ['g1', 'g2'])
    assert.deepEqual(stored('fresh_user'), ['g1', 'g2'])
    assert.deepEqual(stored(), ['g1', 'g2'])
  })

  it('keeps notes an account already has ahead of the guest notes', () => {
    store([note('shared', 'Account copy'), note('a1')], 'returning_user')
    store([note('shared', 'Guest copy'), note('g3')])
    const merged = mergeGuestPaperNotesIntoAccount('Returning_User')
    assert.deepEqual(merged.map((item) => item.id), ['shared', 'a1', 'g3'])
    assert.equal(merged[0].title, 'Account copy')
  })

  it('catches up with notes another tab saved while this tab was not watching', () => {
    store([note('g1')])
    mergeGuestPaperNotesIntoAccount('first_user')
    // Another tab adds a note while this tab's guest store has no subscribers.
    store([note('g1'), note('from-other-tab')])
    assert.deepEqual(
      mergeGuestPaperNotesIntoAccount('second_user').map((item) => item.id),
      ['g1', 'from-other-tab'],
    )
    assert.deepEqual(stored(), ['g1', 'from-other-tab'])
  })
})

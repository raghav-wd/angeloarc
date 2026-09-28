import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DAILY_NOTES_STORAGE_PREFIX,
  DailyNotesValidationError,
  dailyNotesStorageKey,
  emptyDailyNotes,
  isValidDailyNoteDateKey,
  mergeDailyNotes,
  normalizeDailyNotesUsername,
  parseStoredDailyNotes,
  readDailyNotes,
  serializeDailyNotes,
  updateDailyNote,
  writeDailyNotes,
} from '../src/lib/dailyNotes.ts'

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('daily note date keys', () => {
  it('accepts only exact real YYYY-MM-DD calendar dates', () => {
    for (const key of ['0000-01-01', '1900-01-01', '2000-02-29', '2024-02-29', '9999-12-31']) {
      assert.equal(isValidDailyNoteDateKey(key), true, key)
    }
    for (const key of [
      '', '2026-9-01', '2026-09-1', '26-09-01', '10000-01-01', '-001-01-01',
      '1900-02-29', '2100-02-29', '2026-02-29', '2024-02-30', '2026-04-31',
      '2026-00-01', '2026-13-01', '2026-09-00', '2026-09-31',
      '2026-09-01T00:00:00Z', '2026-09-01 ', 'constructor', '__proto__',
    ]) {
      assert.equal(isValidDailyNoteDateKey(key), false, key)
    }
  })
})

describe('daily notes serialization', () => {
  it('round-trips multiline and Unicode text without trimming or limiting it', () => {
    const longLine = '🪴'.repeat(20_000)
    const notes = {
      '2026-09-28': `  First line\nsecond line\nहिंदी\n${longLine}\n  `,
      '2024-02-29': 'Leap day ✓',
    }
    const parsed = parseStoredDailyNotes(serializeDailyNotes(notes))
    assert.deepEqual(parsed, {
      '2024-02-29': 'Leap day ✓',
      '2026-09-28': notes['2026-09-28'],
    })
    assert.equal(parsed['2026-09-28'].length, notes['2026-09-28'].length)
  })

  it('serializes deterministically in ascending date order', () => {
    const first = { '2026-12-31': 'Last', '2026-01-01': 'First', '2026-09-28': 'Middle' }
    const second = { '2026-09-28': 'Middle', '2026-01-01': 'First', '2026-12-31': 'Last' }
    const expected =
      '{"version":1,"notes":{"2026-01-01":"First","2026-09-28":"Middle","2026-12-31":"Last"}}'
    assert.equal(serializeDailyNotes(first), expected)
    assert.equal(serializeDailyNotes(second), expected)
    assert.equal(serializeDailyNotes(parseStoredDailyNotes(expected)), expected)
  })

  it('strictly validates the versioned shape, keys, and values', () => {
    const rejected: unknown[] = [
      null,
      [],
      {},
      { version: 1 },
      { notes: {} },
      { version: 1, notes: {}, extra: true },
      { version: 0, notes: {} },
      { version: 2, notes: {} },
      { version: '1', notes: {} },
      { version: 1, notes: [] },
      { version: 1, notes: { '2026-02-29': 'Not a real day' } },
      { version: 1, notes: { '2026-09-28': 42 } },
      { version: 1, notes: { '2026-09-28': '' } },
      { version: 1, notes: { '2026-09-28': ' \n\t ' } },
    ]
    for (const value of rejected) {
      assert.throws(
        () => parseStoredDailyNotes(JSON.stringify(value)),
        DailyNotesValidationError,
      )
    }
    for (const value of ['', '{', '{"version":1,}', 'undefined']) {
      assert.throws(() => parseStoredDailyNotes(value), DailyNotesValidationError)
    }
    assert.throws(
      () => parseStoredDailyNotes(1 as unknown as string),
      DailyNotesValidationError,
    )
  })
})

describe('daily note updates', () => {
  it('adds, replaces, and deletes immutably while preserving exact text', () => {
    const original = Object.freeze({ '2026-09-27': 'Yesterday' })
    const added = updateDailyNote(original, '2026-09-28', '  Today\nwent well.  ')
    assert.deepEqual(original, { '2026-09-27': 'Yesterday' })
    assert.deepEqual(added, {
      '2026-09-27': 'Yesterday',
      '2026-09-28': '  Today\nwent well.  ',
    })
    assert.notEqual(added, original)

    const replaced = updateDailyNote(added, '2026-09-28', 'Changed')
    assert.equal(replaced['2026-09-28'], 'Changed')
    assert.equal(added['2026-09-28'], '  Today\nwent well.  ')

    const deleted = updateDailyNote(replaced, '2026-09-28', ' \n\t ')
    assert.deepEqual(deleted, original)
    assert.notEqual(deleted, replaced)
  })

  it('returns the original for no-op updates and rejects invalid inputs', () => {
    const notes = { '2026-09-28': 'Same' }
    assert.equal(updateDailyNote(notes, '2026-09-28', 'Same'), notes)
    assert.equal(updateDailyNote(notes, '2026-09-27', ''), notes)
    assert.throws(() => updateDailyNote(notes, '2026-02-29', 'Nope'), DailyNotesValidationError)
    assert.throws(
      () => updateDailyNote(notes, '2026-09-28', null as unknown as string),
      DailyNotesValidationError,
    )
  })
})

describe('daily note storage scopes', () => {
  it('separates guest notes from case-normalized account notes', () => {
    assert.equal(normalizeDailyNotesUsername(undefined), null)
    assert.equal(normalizeDailyNotesUsername('   '), null)
    assert.equal(normalizeDailyNotesUsername('  Daily_User  '), 'daily_user')
    assert.equal(dailyNotesStorageKey(), `${DAILY_NOTES_STORAGE_PREFIX}guest`)
    assert.equal(
      dailyNotesStorageKey('  Daily_User  '),
      `${DAILY_NOTES_STORAGE_PREFIX}account:daily_user`,
    )
    assert.equal(dailyNotesStorageKey('Guest'), `${DAILY_NOTES_STORAGE_PREFIX}account:guest`)
    assert.notEqual(dailyNotesStorageKey(), dailyNotesStorageKey('guest'))
  })

  it('reads and writes only the requested scope using the versioned format', () => {
    const storage = new MemoryStorage()
    const guest = updateDailyNote(emptyDailyNotes(), '2026-09-28', 'Guest note')
    const account = updateDailyNote(emptyDailyNotes(), '2026-09-28', 'Account note')
    writeDailyNotes(storage, guest)
    writeDailyNotes(storage, account, 'Alice')

    assert.deepEqual(readDailyNotes(storage), guest)
    assert.deepEqual(readDailyNotes(storage, ' alice '), account)
    assert.deepEqual(readDailyNotes(storage, 'bob'), {})
    assert.equal(
      storage.values.get(dailyNotesStorageKey()),
      '{"version":1,"notes":{"2026-09-28":"Guest note"}}',
    )
  })

  it('merges guest notes without mutating either scope and preserves account conflicts', () => {
    const guest = Object.freeze({
      '2026-09-27': 'Only guest',
      '2026-09-28': 'Guest version',
    })
    const account = Object.freeze({
      '2026-09-28': 'Account version',
      '2026-09-29': 'Only account',
    })
    const merged = mergeDailyNotes(guest, account)
    assert.deepEqual(merged, {
      '2026-09-27': 'Only guest',
      '2026-09-28': 'Account version',
      '2026-09-29': 'Only account',
    })
    assert.deepEqual(guest, {
      '2026-09-27': 'Only guest',
      '2026-09-28': 'Guest version',
    })
    assert.deepEqual(account, {
      '2026-09-28': 'Account version',
      '2026-09-29': 'Only account',
    })
  })
})

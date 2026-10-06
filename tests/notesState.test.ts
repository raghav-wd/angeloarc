import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createInitialNotesState,
  createNotesState,
  MAX_CLOUD_NOTES_BYTES,
  mergeNotesStates,
  notesStateByteLength,
  parseNotesState,
  serializeNotesState,
} from '../src/lib/notesState.ts'
import type { PaperNote } from '../src/lib/paperNotes.ts'

const NOW = new Date('2026-10-06T05:00:00.000Z')

function paper(id: string, title: string): PaperNote {
  return {
    id,
    kind: 'note',
    title,
    body: '',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  }
}

describe('cloud notes state', () => {
  it('strictly validates and deterministically serializes both private note collections', () => {
    const state = createNotesState(
      { '2026-10-06': 'Today', '2026-10-05': 'Yesterday' },
      [paper('first', 'First')],
    )

    assert.deepEqual(parseNotesState(JSON.parse(serializeNotesState(state))), state)
    assert.equal(
      serializeNotesState(state),
      '{"version":1,"dailyNotes":{"2026-10-05":"Yesterday","2026-10-06":"Today"},"paperNotes":[{"id":"first","kind":"note","title":"First","body":"","createdAt":"2026-10-06T05:00:00.000Z","updatedAt":"2026-10-06T05:00:00.000Z"}]}',
    )

    for (const invalid of [
      null,
      {},
      { version: 1, dailyNotes: {}, paperNotes: [], extra: true },
      { version: 2, dailyNotes: {}, paperNotes: [] },
      { version: 1, dailyNotes: { '2026-02-29': 'No' }, paperNotes: [] },
      { version: 1, dailyNotes: {}, paperNotes: [{ ...paper('bad', 'Bad'), id: '' }] },
    ]) {
      assert.throws(() => parseNotesState(invalid))
    }
  })

  it('creates starter paper notes for a cloud record that has never existed', () => {
    const initial = createInitialNotesState(NOW)
    assert.deepEqual(initial.dailyNotes, {})
    assert.deepEqual(initial.paperNotes.map((note) => note.id), [
      'starter-principle',
      'starter-goal',
      'starter-quote',
    ])
    assert.ok(initial.paperNotes.every((note) => note.createdAt === NOW.toISOString()))
  })

  it('measures the canonical UTF-8 payload against the cloud limit', () => {
    const state = createNotesState({ '2026-10-06': 'é🙂' }, [])
    assert.equal(notesStateByteLength(state), Buffer.byteLength(serializeNotesState(state), 'utf8'))
    assert.equal(MAX_CLOUD_NOTES_BYTES, 88 * 1024)
  })

  it('merges a one-time legacy device copy without overriding cloud conflicts', () => {
    const legacy = createNotesState(
      { '2026-10-05': 'Legacy only', '2026-10-06': 'Legacy conflict' },
      [paper('shared', 'Legacy copy'), paper('legacy-only', 'Legacy only')],
    )
    const cloud = createNotesState(
      { '2026-10-06': 'Cloud copy', '2026-10-07': 'Cloud only' },
      [paper('shared', 'Cloud copy'), paper('cloud-only', 'Cloud only')],
    )

    const merged = mergeNotesStates(legacy, cloud)
    assert.deepEqual(merged.dailyNotes, {
      '2026-10-05': 'Legacy only',
      '2026-10-06': 'Cloud copy',
      '2026-10-07': 'Cloud only',
    })
    assert.deepEqual(merged.paperNotes.map((note) => note.id), [
      'shared',
      'cloud-only',
      'legacy-only',
    ])
    assert.equal(merged.paperNotes[0].title, 'Cloud copy')
  })
})

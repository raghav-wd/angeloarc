import { useCallback, useMemo, useSyncExternalStore } from 'react'
import {
  createStarterPaperNotes,
  mergePaperNotes,
  normalizePaperNotesUsername,
  paperNotesStorageKey,
  parseStoredPaperNotes,
  removePaperNote,
  savePaperNote,
  serializePaperNotes,
} from '../lib/paperNotes.ts'
import type { PaperNote, PaperNotes } from '../lib/paperNotes.ts'

interface PaperNotesSnapshot {
  paperNotes: PaperNotes
  paperNotesStorageError: string
}

interface PaperNotesStore {
  getSnapshot: () => PaperNotesSnapshot
  subscribe: (listener: () => void) => () => void
  save: (note: PaperNote) => void
  remove: (id: string) => void
  replace: (notes: PaperNotes) => void
  refresh: () => void
  /** True until this scope has stored notes of its own (it shows the starters). */
  isPristine: () => boolean
}

const stores = new Map<string, PaperNotesStore>()

const READ_ERROR =
  'Your saved notes to self could not be read. They are untouched; edits will only stay in this tab.'
const ACCESS_ERROR =
  'Your browser could not access your notes to self. Edits will only stay in this tab.'
const SAVE_ERROR =
  'Your browser could not save this note. Your notes are available in this tab, but may not survive a refresh.'

function browserStorage(): Storage {
  if (typeof localStorage === 'undefined') throw new Error('Local storage is unavailable.')
  return localStorage
}

function createStore(storageKey: string): PaperNotesStore {
  let snapshot: PaperNotesSnapshot = { paperNotes: createStarterPaperNotes(), paperNotesStorageError: '' }
  let persistenceBlocked = false
  // True until this scope has stored notes of its own.
  let pristine = true
  // The exact text last read from or written to storage, so outside changes stand out.
  let stored: string | null | undefined
  const listeners = new Set<() => void>()

  const emit = () => {
    for (const listener of listeners) listener()
  }

  const load = (serialized: string | null) => {
    stored = serialized
    try {
      snapshot = {
        paperNotes: serialized === null ? createStarterPaperNotes() : parseStoredPaperNotes(serialized),
        paperNotesStorageError: '',
      }
      persistenceBlocked = false
      pristine = serialized === null
    } catch (error) {
      console.error('ANGELO could not read notes to self:', error)
      // Never replace unreadable data with a partial in-memory edit.
      snapshot = { ...snapshot, paperNotesStorageError: READ_ERROR }
      persistenceBlocked = true
      pristine = false
    }
  }

  const read = (): string | null | undefined => {
    try {
      return browserStorage().getItem(storageKey)
    } catch (error) {
      console.error('ANGELO could not access notes to self:', error)
      return undefined
    }
  }

  const initial = read()
  if (initial === undefined) {
    snapshot = { ...snapshot, paperNotesStorageError: ACCESS_ERROR }
    persistenceBlocked = true
    pristine = false
  } else {
    load(initial)
  }

  const persist = (paperNotes: PaperNotes) => {
    pristine = false
    let paperNotesStorageError = snapshot.paperNotesStorageError
    if (!persistenceBlocked) {
      try {
        const serialized = serializePaperNotes(paperNotes)
        browserStorage().setItem(storageKey, serialized)
        stored = serialized
        paperNotesStorageError = ''
      } catch (error) {
        console.error('ANGELO could not save notes to self:', error)
        paperNotesStorageError = SAVE_ERROR
      }
    }
    snapshot = { paperNotes, paperNotesStorageError }
    emit()
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== storageKey) return
    load(event.newValue)
    emit()
  }

  // A store nobody is watching misses storage events from other tabs, so it
  // catches up before it is shown or written again.
  const refresh = () => {
    const serialized = read()
    if (serialized === undefined || serialized === stored) return
    load(serialized)
    emit()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      if (listeners.size === 1 && typeof window !== 'undefined') {
        window.addEventListener('storage', handleStorage)
        refresh()
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && typeof window !== 'undefined') {
          window.removeEventListener('storage', handleStorage)
        }
      }
    },
    save: (note) => {
      const next = savePaperNote(snapshot.paperNotes, note)
      if (next !== snapshot.paperNotes) persist(next)
    },
    remove: (id) => {
      const next = removePaperNote(snapshot.paperNotes, id)
      if (next !== snapshot.paperNotes) persist(next)
    },
    replace: (notes) => {
      persist(notes)
    },
    refresh,
    isPristine: () => pristine,
  }
}

function storeFor(username?: string | null): PaperNotesStore {
  const storageKey = paperNotesStorageKey(username)
  let store = stores.get(storageKey)
  if (!store) {
    store = createStore(storageKey)
    stores.set(storageKey, store)
  }
  return store
}

export function usePaperNotes(username?: string | null): {
  paperNotes: PaperNotes
  savePaperNote: (note: PaperNote) => void
  deletePaperNote: (id: string) => void
  paperNotesStorageError: string
} {
  const store = useMemo(() => storeFor(username), [username])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const save = useCallback((note: PaperNote) => store.save(note), [store])
  const remove = useCallback((id: string) => store.remove(id), [store])

  return {
    paperNotes: snapshot.paperNotes,
    savePaperNote: save,
    deletePaperNote: remove,
    paperNotesStorageError: snapshot.paperNotesStorageError,
  }
}

/**
 * Copies guest notes into a newly created account scope. Existing account
 * notes take precedence, and guest notes remain available after sign-out.
 */
export function mergeGuestPaperNotesIntoAccount(username: string): PaperNotes {
  if (!normalizePaperNotesUsername(username)) {
    throw new Error('A username is required to merge guest notes to self.')
  }
  const guestStore = storeFor(null)
  const accountStore = storeFor(username)
  guestStore.refresh()
  accountStore.refresh()
  const guestNotes = guestStore.getSnapshot().paperNotes
  const merged = accountStore.isPristine()
    ? guestNotes
    : mergePaperNotes(guestNotes, accountStore.getSnapshot().paperNotes)
  accountStore.replace(merged)
  return merged
}

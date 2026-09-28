import { useCallback, useMemo, useSyncExternalStore } from 'react'
import {
  DailyNotesValidationError,
  dailyNotesStorageKey,
  emptyDailyNotes,
  mergeDailyNotes,
  normalizeDailyNotesUsername,
  parseStoredDailyNotes,
  serializeDailyNotes,
  updateDailyNote,
} from '../lib/dailyNotes.ts'
import type { DailyNotes } from '../lib/dailyNotes.ts'

interface DailyNotesSnapshot {
  dailyNotes: DailyNotes
  notesStorageError: string
}

interface DailyNotesStore {
  getSnapshot: () => DailyNotesSnapshot
  subscribe: (listener: () => void) => () => void
  setDailyNote: (key: string, text: string) => void
  replaceDailyNotes: (dailyNotes: DailyNotes) => void
}

const stores = new Map<string, DailyNotesStore>()

const READ_ERROR =
  'Your saved daily notes could not be read. They are untouched; edits will only stay in this tab.'
const ACCESS_ERROR =
  'Your browser could not access daily notes. Edits will only stay in this tab.'
const SAVE_ERROR =
  'Your browser could not save this note. Your notes are available in this tab, but may not survive a refresh.'

function browserStorage(): Storage {
  if (typeof localStorage === 'undefined') throw new Error('Local storage is unavailable.')
  return localStorage
}

function initialSnapshot(storageKey: string): {
  snapshot: DailyNotesSnapshot
  persistenceBlocked: boolean
} {
  try {
    const serialized = browserStorage().getItem(storageKey)
    return {
      snapshot: {
        dailyNotes: serialized === null ? emptyDailyNotes() : parseStoredDailyNotes(serialized),
        notesStorageError: '',
      },
      persistenceBlocked: false,
    }
  } catch (error) {
    const corrupt = error instanceof DailyNotesValidationError
    console.error('ANGELO could not load daily notes:', error)
    return {
      snapshot: {
        dailyNotes: emptyDailyNotes(),
        notesStorageError: corrupt ? READ_ERROR : ACCESS_ERROR,
      },
      // Never replace unreadable data with a partial in-memory edit.
      persistenceBlocked: true,
    }
  }
}

function createStore(storageKey: string): DailyNotesStore {
  const initial = initialSnapshot(storageKey)
  let snapshot = initial.snapshot
  let persistenceBlocked = initial.persistenceBlocked
  const listeners = new Set<() => void>()

  const emit = () => {
    for (const listener of listeners) listener()
  }

  const persist = (dailyNotes: DailyNotes) => {
    let notesStorageError = snapshot.notesStorageError
    if (!persistenceBlocked) {
      try {
        browserStorage().setItem(storageKey, serializeDailyNotes(dailyNotes))
        notesStorageError = ''
      } catch (error) {
        console.error('ANGELO could not save daily notes:', error)
        notesStorageError = SAVE_ERROR
      }
    }
    snapshot = { dailyNotes, notesStorageError }
    emit()
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== storageKey) return
    try {
      snapshot = {
        dailyNotes: event.newValue === null ? emptyDailyNotes() : parseStoredDailyNotes(event.newValue),
        notesStorageError: '',
      }
      persistenceBlocked = false
    } catch (error) {
      console.error('ANGELO could not reload daily notes:', error)
      snapshot = { ...snapshot, notesStorageError: READ_ERROR }
      persistenceBlocked = true
    }
    emit()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      if (listeners.size === 1 && typeof window !== 'undefined') {
        window.addEventListener('storage', handleStorage)
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && typeof window !== 'undefined') {
          window.removeEventListener('storage', handleStorage)
        }
      }
    },
    setDailyNote: (key, text) => {
      const next = updateDailyNote(snapshot.dailyNotes, key, text)
      if (next !== snapshot.dailyNotes) persist(next)
    },
    replaceDailyNotes: (dailyNotes) => {
      persist(dailyNotes)
    },
  }
}

function storeFor(username?: string | null): DailyNotesStore {
  const storageKey = dailyNotesStorageKey(username)
  let store = stores.get(storageKey)
  if (!store) {
    store = createStore(storageKey)
    stores.set(storageKey, store)
  }
  return store
}

export function useDailyNotes(username?: string | null): {
  dailyNotes: DailyNotes
  setDailyNote: (key: string, text: string) => void
  notesStorageError: string
} {
  const store = useMemo(() => storeFor(username), [username])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const setDailyNote = useCallback((key: string, text: string) => {
    store.setDailyNote(key, text)
  }, [store])

  return {
    dailyNotes: snapshot.dailyNotes,
    setDailyNote,
    notesStorageError: snapshot.notesStorageError,
  }
}

/**
 * Copies guest notes into a newly created account scope. Existing account
 * notes take precedence, and guest notes remain available after sign-out.
 */
export function mergeGuestNotesIntoAccount(username: string): DailyNotes {
  if (!normalizeDailyNotesUsername(username)) {
    throw new Error('A username is required to merge guest daily notes.')
  }
  const guestStore = storeFor(null)
  const accountStore = storeFor(username)
  const merged = mergeDailyNotes(
    guestStore.getSnapshot().dailyNotes,
    accountStore.getSnapshot().dailyNotes,
  )
  accountStore.replaceDailyNotes(merged)
  return merged
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, updateNotes } from '../lib/api'
import type { NotesState } from '../lib/api'
import {
  dailyNotesStorageKey,
  emptyDailyNotes,
  parseStoredDailyNotes,
  updateDailyNote,
} from '../lib/dailyNotes'
import type { DailyNotes } from '../lib/dailyNotes'
import {
  createInitialNotesState,
  createNotesState,
  MAX_CLOUD_NOTES_BYTES,
  mergeNotesStates,
  notesStateByteLength,
  parseNotesState,
  serializeNotesState,
} from '../lib/notesState'
import {
  emptyPaperNotes,
  paperNotesStorageKey,
  parseStoredPaperNotes,
  removePaperNote,
  restorePaperNote as restorePaperNoteInList,
  savePaperNote as savePaperNoteInList,
  swapPaperNotes as swapPaperNotesInList,
} from '../lib/paperNotes'
import type { PaperNote, PaperNotes } from '../lib/paperNotes'
import { clearGuestDailyNotes, useDailyNotes } from './useDailyNotes'
import { clearGuestPaperNotes, usePaperNotes } from './usePaperNotes'

const REMOTE_SAVE_DELAY = 400
const FETCH_KEEPALIVE_BODY_LIMIT = 60 * 1024
const MIGRATION_MARKER_PREFIX = 'angelo-cloud-notes-migrated-v1:'
const NOTES_TOO_LARGE_ERROR =
  'Your cloud notes have reached their storage limit. Shorten or remove a note before signing out.'
const NOTES_CONFLICT_ERROR =
  'These notes changed on another device. Copy any unsaved text, then refresh to load the latest cloud copy.'

export type NotesSyncStatus = 'local' | 'restoring' | 'syncing' | 'synced' | 'error'

interface CloudRecord {
  identity: string
  notes: NotesState
}

interface LegacyNotes {
  dailyNotes: DailyNotes | null
  paperNotes: PaperNotes | null
  alreadyMigrated: boolean
  canCleanUp: boolean
  error: string
}

function migrationMarkerKey(username: string): string {
  return `${MIGRATION_MARKER_PREFIX}${encodeURIComponent(username.trim().toLowerCase())}`
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function readLegacyAccountNotes(username: string): LegacyNotes {
  const storage = browserStorage()
  if (!storage) {
    return {
      dailyNotes: null,
      paperNotes: null,
      alreadyMigrated: false,
      canCleanUp: false,
      error: '',
    }
  }

  try {
    if (storage.getItem(migrationMarkerKey(username)) === 'done') {
      return {
        dailyNotes: null,
        paperNotes: null,
        alreadyMigrated: true,
        canCleanUp: true,
        error: '',
      }
    }

    let dailyNotes: DailyNotes | null = null
    let paperNotes: PaperNotes | null = null
    let hadReadError = false
    try {
      const dailySerialized = storage.getItem(dailyNotesStorageKey(username))
      dailyNotes = dailySerialized === null ? null : parseStoredDailyNotes(dailySerialized)
    } catch (error) {
      hadReadError = true
      console.error('ANGELO could not read older daily notes for cloud migration:', error)
    }
    try {
      const paperSerialized = storage.getItem(paperNotesStorageKey(username))
      paperNotes = paperSerialized === null ? null : parseStoredPaperNotes(paperSerialized)
    } catch (error) {
      hadReadError = true
      console.error('ANGELO could not read older notes to self for cloud migration:', error)
    }
    return {
      dailyNotes,
      paperNotes,
      alreadyMigrated: false,
      canCleanUp: !hadReadError,
      error: hadReadError
        ? 'Some older notes saved on this device could not be moved to the cloud. Their unreadable copy was left untouched.'
        : '',
    }
  } catch (error) {
    console.error('ANGELO could not read older account notes for cloud migration:', error)
    return {
      dailyNotes: null,
      paperNotes: null,
      alreadyMigrated: false,
      canCleanUp: false,
      error: 'Older notes saved on this device could not be moved to the cloud. They were left untouched.',
    }
  }
}

function cleanUpLegacyAccountNotes(username: string): void {
  const storage = browserStorage()
  if (!storage) return
  try {
    // Mark first so a failure while removing obsolete payloads cannot make a
    // later cloud deletion look like data that still needs migration.
    storage.setItem(migrationMarkerKey(username), 'done')
  } catch (error) {
    console.error('ANGELO could not finish cleaning up older account notes:', error)
    return
  }
  for (const key of [dailyNotesStorageKey(username), paperNotesStorageKey(username)]) {
    try {
      storage.removeItem(key)
    } catch (error) {
      console.error('ANGELO could not remove an older account-notes copy:', error)
    }
  }
}

function notesWithLegacy(
  remote: NotesState | null,
  legacy: LegacyNotes,
): { notes: NotesState; changed: boolean; canCleanUp: boolean; error: string } {
  if (remote === null) {
    const initial = createInitialNotesState()
    const local = createNotesState(
      legacy.dailyNotes ?? emptyDailyNotes(),
      legacy.paperNotes ?? initial.paperNotes,
    )
    return { notes: local, changed: true, canCleanUp: true, error: '' }
  }

  // Each device has its own one-time marker. An unmarked device may contain
  // account notes from before cloud sync existed, so merge its unique values
  // without replacing any cloud conflicts. Once marked, the cloud is fully
  // authoritative and stale keys from an older open tab are only cleaned up.
  if (legacy.alreadyMigrated || (legacy.dailyNotes === null && legacy.paperNotes === null)) {
    return { notes: remote, changed: false, canCleanUp: true, error: '' }
  }
  const local = createNotesState(
    legacy.dailyNotes ?? emptyDailyNotes(),
    legacy.paperNotes ?? emptyPaperNotes(),
  )
  const merged = mergeNotesStates(local, remote)
  const cloudPaperIds = new Set(remote.paperNotes.map((note) => note.id))
  const mergedPaperIds = new Set(merged.paperNotes.map((note) => note.id))
  const omittedPaperNotes = local.paperNotes.filter((note) => (
    !cloudPaperIds.has(note.id) && !mergedPaperIds.has(note.id)
  )).length
  return {
    notes: merged,
    changed: serializeNotesState(merged) !== serializeNotesState(remote),
    canCleanUp: omittedPaperNotes === 0,
    error: omittedPaperNotes > 0
      ? `The cloud already has 12 notes to self, so ${omittedPaperNotes} older device ${omittedPaperNotes === 1 ? 'note was' : 'notes were'} left on this device. Remove a cloud note and refresh to move ${omittedPaperNotes === 1 ? 'it' : 'them'}.`
      : '',
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'NOTES_CONFLICT') return NOTES_CONFLICT_ERROR
  if (error instanceof ApiError && error.message) return error.message
  if (error instanceof Error && error.message) return error.message
  return 'Your latest notes could not be synced to the cloud.'
}

export function useNotesState({
  username,
  token,
  initialNotes,
  initialRevision,
}: {
  username?: string | null
  token?: string | null
  initialNotes?: NotesState | null
  initialRevision?: number
}) {
  // Guest notes are the only notes that stay in browser storage. Account notes
  // live in memory and in the authenticated cloud record below.
  const {
    dailyNotes: guestDailyNotes,
    setDailyNote: setGuestDailyNote,
    notesStorageError: guestDailyStorageError,
  } = useDailyNotes()
  const {
    paperNotes: guestPaperNotes,
    savePaperNote: saveGuestPaperNote,
    deletePaperNote: deleteGuestPaperNote,
    swapPaperNotes: swapGuestPaperNotes,
    restorePaperNote: restoreGuestPaperNote,
    paperNotesStorageError: guestPaperStorageError,
  } = usePaperNotes()
  const identity = username && token ? `${username.trim().toLowerCase()}\u0000${token}` : null
  const [cloudRecord, setCloudRecord] = useState<CloudRecord | null>(null)
  const [syncStatus, setSyncStatus] = useState<NotesSyncStatus>(identity ? 'restoring' : 'local')
  const [syncError, setSyncError] = useState('')
  const [migrationError, setMigrationError] = useState('')
  const cloudRef = useRef<CloudRecord | null>(null)
  const activeRef = useRef<{ identity: string; token: string; username: string } | null>(null)
  const pendingRef = useRef<NotesState | null>(null)
  const blockedBySizeRef = useRef(false)
  const conflictRef = useRef(false)
  const revisionRef = useRef(0)
  const inFlightRef = useRef<Promise<boolean> | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const migrationCleanupRef = useRef<{ identity: string; username: string } | null>(null)
  const initializationKey = useRef('')
  const mounted = useRef(true)

  const flushRemote = useCallback(async function flushRemoteSave(drain = false): Promise<boolean> {
    if (blockedBySizeRef.current || conflictRef.current) return false
    if (inFlightRef.current) {
      const previousSucceeded = await inFlightRef.current
      if (blockedBySizeRef.current || conflictRef.current) return false
      if (pendingRef.current) return flushRemoteSave(drain)
      return previousSucceeded
    }

    const active = activeRef.current
    const next = pendingRef.current
    if (!active || !next) return true
    const expectedRevision = revisionRef.current
    pendingRef.current = null
    if (mounted.current && activeRef.current?.identity === active.identity) {
      setSyncStatus('syncing')
      setSyncError('')
    }

    const request = (async () => {
      try {
        // Small note writes use fetch keepalive so a save already in progress
        // can finish if the user closes or reloads the page.
        const keepalive = notesStateByteLength(next) + 32 <= FETCH_KEEPALIVE_BODY_LIMIT
        const response = await updateNotes(
          active.token,
          next,
          expectedRevision,
          undefined,
          keepalive,
        )
        if (activeRef.current?.identity !== active.identity) return true
        if (response.revision !== expectedRevision + 1) {
          throw new Error('The server returned an invalid cloud-notes revision.')
        }
        revisionRef.current = response.revision
        conflictRef.current = false

        const cleanup = migrationCleanupRef.current
        if (cleanup?.identity === active.identity) {
          cleanUpLegacyAccountNotes(cleanup.username)
          migrationCleanupRef.current = null
        }
        if (mounted.current) {
          if (blockedBySizeRef.current) {
            setSyncStatus('error')
            setSyncError(NOTES_TOO_LARGE_ERROR)
          } else {
            setSyncError('')
            setSyncStatus(pendingRef.current ? 'syncing' : 'synced')
          }
        }
        return true
      } catch (error) {
        if (activeRef.current?.identity !== active.identity) return false
        const conflict = error instanceof ApiError && error.code === 'NOTES_CONFLICT'
        if (conflict) conflictRef.current = true
        // Keep the newest state queued. A later edit, explicit flush, or tab
        // visibility change retries it without ever claiming it was synced.
        if (!blockedBySizeRef.current && !pendingRef.current) pendingRef.current = next
        if (mounted.current) {
          setSyncStatus('error')
          setSyncError(blockedBySizeRef.current ? NOTES_TOO_LARGE_ERROR : errorMessage(error))
        }
        return false
      }
    })()

    inFlightRef.current = request
    const succeeded = await request
    if (inFlightRef.current === request) inFlightRef.current = null

    if (succeeded && pendingRef.current && activeRef.current?.identity === active.identity) {
      if (drain) return flushRemoteSave(true)
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        void flushRemoteSave()
      }, 80)
    }
    return succeeded && !blockedBySizeRef.current
  }, [])

  const flushNotes = useCallback(() => flushRemote(true), [flushRemote])

  const queueRemote = useCallback((notes: NotesState) => {
    clearTimeout(saveTimer.current)
    if (notesStateByteLength(notes) > MAX_CLOUD_NOTES_BYTES) {
      pendingRef.current = null
      blockedBySizeRef.current = true
      if (mounted.current) {
        setSyncStatus('error')
        setSyncError(NOTES_TOO_LARGE_ERROR)
      }
      return
    }
    blockedBySizeRef.current = false
    pendingRef.current = notes
    if (conflictRef.current) {
      if (mounted.current) {
        setSyncStatus('error')
        setSyncError(NOTES_CONFLICT_ERROR)
      }
      return
    }
    if (mounted.current) {
      setSyncStatus('syncing')
      setSyncError('')
    }
    saveTimer.current = setTimeout(() => {
      void flushRemote()
    }, REMOTE_SAVE_DELAY)
  }, [flushRemote])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      clearTimeout(saveTimer.current)
    }
  }, [])

  // Auth is an external source for this store: switching identities must
  // replace the visible private record and its sync status together.
  // oxlint-disable react/set-state-in-effect
  useEffect(() => {
    if (!identity || !username || !token) {
      initializationKey.current = ''
      activeRef.current = null
      cloudRef.current = null
      pendingRef.current = null
      blockedBySizeRef.current = false
      conflictRef.current = false
      revisionRef.current = 0
      migrationCleanupRef.current = null
      clearTimeout(saveTimer.current)
      setCloudRecord(null)
      setSyncStatus('local')
      setSyncError('')
      setMigrationError('')
      return
    }
    if (initialNotes === undefined) return

    let serializedInitial = 'null'
    const cloudRevision = initialRevision === undefined
      ? initialNotes === null ? 0 : 1
      : initialRevision
    try {
      if (!Number.isSafeInteger(cloudRevision)
        || cloudRevision < 0
        || (initialNotes === null ? cloudRevision !== 0 : cloudRevision < 1)) {
        throw new Error('The server returned an invalid cloud-notes revision.')
      }
      if (initialNotes !== null) serializedInitial = serializeNotesState(initialNotes)
    } catch (error) {
      console.error('ANGELO received invalid cloud notes:', error)
      activeRef.current = { identity, token, username }
      conflictRef.current = true
      revisionRef.current = 0
      const fallback = { identity, notes: createInitialNotesState() }
      cloudRef.current = fallback
      setCloudRecord(fallback)
      setSyncStatus('error')
      setSyncError('Your cloud notes could not be read safely. Refresh before making changes.')
      return
    }
    const nextInitializationKey = `${identity}\u0000${cloudRevision}\u0000${serializedInitial}`
    if (initializationKey.current === nextInitializationKey) {
      // React Strict Mode replays effects and the mounted-effect cleanup clears
      // this timer. Re-arm a migration/save that is still waiting to run.
      if (pendingRef.current) queueRemote(pendingRef.current)
      return
    }
    initializationKey.current = nextInitializationKey

    clearTimeout(saveTimer.current)
    pendingRef.current = null
    blockedBySizeRef.current = false
    conflictRef.current = false
    revisionRef.current = cloudRevision
    migrationCleanupRef.current = null
    activeRef.current = { identity, token, username }
    setSyncStatus('restoring')
    setSyncError('')

    const remote = initialNotes === null ? null : parseNotesState(initialNotes)
    const legacy = readLegacyAccountNotes(username)
    const prepared = notesWithLegacy(remote, legacy)
    const record = { identity, notes: prepared.notes }
    cloudRef.current = record
    setCloudRecord(record)
    const currentMigrationError = [legacy.error, prepared.error].filter(Boolean).join(' ')
    setMigrationError(currentMigrationError)

    if (prepared.changed) {
      if (legacy.canCleanUp && prepared.canCleanUp) {
        migrationCleanupRef.current = { identity, username }
      }
      queueRemote(prepared.notes)
    } else {
      if (legacy.canCleanUp && prepared.canCleanUp) cleanUpLegacyAccountNotes(username)
      setSyncStatus(currentMigrationError ? 'error' : 'synced')
    }
  }, [identity, initialNotes, initialRevision, queueRemote, token, username])
  // oxlint-enable react/set-state-in-effect

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden' && pendingRef.current) void flushNotes()
    }
    const flushWhenLeaving = () => {
      if (pendingRef.current) void flushNotes()
    }
    const protectUnsavedNotes = (event: BeforeUnloadEvent) => {
      if (!activeRef.current
        || (!pendingRef.current && !inFlightRef.current && !blockedBySizeRef.current)) return
      void flushNotes()
      // Browsers show their own short warning. It gives a large or not-yet-
      // started request a chance to finish instead of silently losing an edit.
      event.preventDefault()
      event.returnValue = ''
    }
    document.addEventListener('visibilitychange', flushWhenHidden)
    window.addEventListener('pagehide', flushWhenLeaving)
    window.addEventListener('beforeunload', protectUnsavedNotes)
    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden)
      window.removeEventListener('pagehide', flushWhenLeaving)
      window.removeEventListener('beforeunload', protectUnsavedNotes)
    }
  }, [flushNotes])

  const updateCloud = useCallback((change: (current: NotesState) => NotesState) => {
    if (!identity) return
    const current = cloudRef.current
    if (!current || current.identity !== identity) return
    const next = change(current.notes)
    if (next === current.notes) return
    const record = { identity, notes: next }
    cloudRef.current = record
    setCloudRecord(record)
    queueRemote(next)
  }, [identity, queueRemote])

  const setDailyNote = useCallback((key: string, text: string) => {
    if (!identity) {
      setGuestDailyNote(key, text)
      return
    }
    updateCloud((current) => {
      const dailyNotes = updateDailyNote(current.dailyNotes, key, text)
      return dailyNotes === current.dailyNotes
        ? current
        : createNotesState(dailyNotes, current.paperNotes)
    })
  }, [identity, setGuestDailyNote, updateCloud])

  const savePaperNote = useCallback((note: PaperNote) => {
    if (!identity) {
      saveGuestPaperNote(note)
      return
    }
    updateCloud((current) => {
      const paperNotes = savePaperNoteInList(current.paperNotes, note)
      return paperNotes === current.paperNotes
        ? current
        : createNotesState(current.dailyNotes, paperNotes)
    })
  }, [identity, saveGuestPaperNote, updateCloud])

  const deletePaperNote = useCallback((id: string) => {
    if (!identity) {
      deleteGuestPaperNote(id)
      return
    }
    updateCloud((current) => {
      const paperNotes = removePaperNote(current.paperNotes, id)
      return paperNotes === current.paperNotes
        ? current
        : createNotesState(current.dailyNotes, paperNotes)
    })
  }, [deleteGuestPaperNote, identity, updateCloud])

  const swapPaperNotes = useCallback((firstId: string, secondId: string) => {
    if (!identity) {
      swapGuestPaperNotes(firstId, secondId)
      return
    }
    updateCloud((current) => {
      const paperNotes = swapPaperNotesInList(current.paperNotes, firstId, secondId)
      return paperNotes === current.paperNotes
        ? current
        : createNotesState(current.dailyNotes, paperNotes)
    })
  }, [identity, swapGuestPaperNotes, updateCloud])

  const restorePaperNote = useCallback((note: PaperNote, index: number) => {
    if (!identity) {
      restoreGuestPaperNote(note, index)
      return
    }
    updateCloud((current) => {
      const paperNotes = restorePaperNoteInList(current.paperNotes, note, index)
      return paperNotes === current.paperNotes
        ? current
        : createNotesState(current.dailyNotes, paperNotes)
    })
  }, [identity, restoreGuestPaperNote, updateCloud])

  const clearGuestNotes = useCallback(() => {
    clearGuestDailyNotes()
    clearGuestPaperNotes()
  }, [])

  const currentCloud = identity && cloudRecord?.identity === identity ? cloudRecord.notes : null
  const ready = !identity || currentCloud !== null
  const paperNotesStorageError = identity
    ? migrationError || syncError
    : guestPaperStorageError
  const notesStorageError = identity
    ? migrationError || syncError
    : guestDailyStorageError

  return useMemo(() => ({
    dailyNotes: currentCloud?.dailyNotes ?? (identity ? emptyDailyNotes() : guestDailyNotes),
    setDailyNote,
    paperNotes: currentCloud?.paperNotes ?? (identity ? [] : guestPaperNotes),
    savePaperNote,
    deletePaperNote,
    swapPaperNotes,
    restorePaperNote,
    notesStorageError,
    paperNotesStorageError,
    syncStatus,
    ready,
    flushNotes,
    clearGuestNotes,
  }), [
    clearGuestNotes,
    currentCloud,
    deletePaperNote,
    flushNotes,
    guestDailyNotes,
    guestPaperNotes,
    identity,
    notesStorageError,
    paperNotesStorageError,
    ready,
    restorePaperNote,
    savePaperNote,
    setDailyNote,
    swapPaperNotes,
    syncStatus,
  ])
}

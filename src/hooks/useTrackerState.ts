import { useCallback, useEffect, useRef, useState } from 'react'
import type { SetStateAction } from 'react'
import {
  ApiError,
  getMe,
  login as loginRequest,
  logout as logoutRequest,
  signup as signupRequest,
  updateProfile,
  updateTracker,
} from '../lib/api'
import type { Account, AuthResponse } from '../lib/api'
import {
  createInitialState,
  parseStoredState,
  STORAGE_KEY,
  StorageValidationError,
} from '../lib/tracker'
import type { TrackerState } from '../lib/tracker'

export const SESSION_STORAGE_KEY = 'angelo-session-v1'
const ACCOUNT_CACHE_PREFIX = 'angelo-account-v1:'
const REMOTE_SAVE_DELAY = 450

export type SyncStatus = 'local' | 'restoring' | 'syncing' | 'synced' | 'error'

function isStorageError(error: unknown): error is DOMException {
  return (
    error instanceof DOMException &&
    (error.name === 'SecurityError' || error.name === 'QuotaExceededError')
  )
}

function messageFrom(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message
  if (error instanceof Error && error.message) return error.message
  return fallback
}

function validateRemoteTracker(value: unknown): TrackerState {
  const serialized = JSON.stringify(value)
  if (typeof serialized !== 'string') throw new StorageValidationError('The server returned invalid tracker data.')
  return parseStoredState(serialized)
}

function accountCacheKey(username: string): string {
  return `${ACCOUNT_CACHE_PREFIX}${encodeURIComponent(username.toLowerCase())}`
}

function readSavedRoutine() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return {
      state: saved ? parseStoredState(saved) : createInitialState(),
      error: '',
      canPersist: true,
    }
  } catch (error) {
    if (!(error instanceof StorageValidationError) && !isStorageError(error)) {
      throw error
    }

    console.error('ANGELO could not load the saved routine:', error)
    return {
      state: createInitialState(),
      error:
        'Your saved routine could not be read. Your existing data is untouched; changes will only stay in this tab.',
      canPersist: false,
    }
  }
}

function readSavedSession(): { token: string; error: string } {
  try {
    return { token: localStorage.getItem(SESSION_STORAGE_KEY) ?? '', error: '' }
  } catch (error) {
    if (!isStorageError(error)) throw error
    return {
      token: '',
      error: 'Your browser could not restore a saved sign-in. You can keep using ANGELO as a guest.',
    }
  }
}

export function useTrackerState() {
  const [loaded] = useState(readSavedRoutine)
  const [savedSession] = useState(readSavedSession)
  const [state, setCurrentState] = useState(loaded.state)
  const currentState = useRef(loaded.state)
  const guestState = useRef(loaded.state)
  const [storageError, setStorageError] = useState(loaded.error || savedSession.error)
  const [account, setAccount] = useState<Account | null>(null)
  const accountRef = useRef<Account | null>(null)
  const tokenRef = useRef<string | null>(null)
  const [authReady, setAuthReady] = useState(!savedSession.token)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(savedSession.token ? 'restoring' : 'local')
  const [syncError, setSyncError] = useState('')
  const restoreStarted = useRef(false)
  const mounted = useRef(true)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pendingRemoteState = useRef<TrackerState | null>(null)
  const saveInFlight = useRef<Promise<void> | null>(null)

  const persistLocal = useCallback((key: string, next: TrackerState) => {
    if (!loaded.canPersist) return
    try {
      localStorage.setItem(key, JSON.stringify(next))
      setStorageError('')
    } catch (error) {
      if (!isStorageError(error)) throw error
      console.error('ANGELO could not save the routine:', error)
      setStorageError(
        'Your browser could not save this change. Your routine is available in this tab, but may not survive a refresh.',
      )
    }
  }, [loaded.canPersist])

  const flushRemote = useCallback(async function flushRemoteSave() {
    if (saveInFlight.current) {
      await saveInFlight.current
      return
    }

    const token = tokenRef.current
    const next = pendingRemoteState.current
    if (!token || !accountRef.current || !next) return
    pendingRemoteState.current = null
    if (mounted.current) {
      setSyncStatus('syncing')
      setSyncError('')
    }

    let saved = false
    const request = (async () => {
      try {
        await updateTracker(token, next)
        saved = true
        if (mounted.current && tokenRef.current === token) {
          setSyncStatus(pendingRemoteState.current ? 'syncing' : 'synced')
        }
      } catch (error) {
        if (!pendingRemoteState.current) pendingRemoteState.current = next
        if (mounted.current && tokenRef.current === token) {
          setSyncStatus('error')
          setSyncError(messageFrom(error, 'Your latest changes could not be synced. They are still saved on this device.'))
        }
      }
    })()

    saveInFlight.current = request
    await request
    saveInFlight.current = null

    if (saved && pendingRemoteState.current && tokenRef.current === token) {
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        void flushRemoteSave()
      }, 80)
    }
  }, [])

  const scheduleRemoteSave = useCallback((delay = REMOTE_SAVE_DELAY) => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void flushRemote()
    }, delay)
  }, [flushRemote])

  const adoptAuthenticatedState = useCallback((response: Pick<AuthResponse, 'account' | 'tracker'>, token: string) => {
    const next = validateRemoteTracker(response.tracker)
    clearTimeout(saveTimer.current)
    pendingRemoteState.current = null
    tokenRef.current = token
    accountRef.current = response.account
    currentState.current = next
    setCurrentState(next)
    setAccount(response.account)
    setSyncStatus('synced')
    setSyncError('')
    persistLocal(accountCacheKey(response.account.username), next)
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, token)
    } catch (error) {
      if (!isStorageError(error)) throw error
      setStorageError('You are signed in for this tab, but your browser could not remember the session.')
    }
  }, [persistLocal])

  useEffect(() => {
    mounted.current = true
    if (!restoreStarted.current) {
      restoreStarted.current = true

      const token = savedSession.token

      if (token) {
        tokenRef.current = token
        void getMe(token)
          .then((response) => {
            if (!mounted.current) return
            adoptAuthenticatedState(response, token)
          })
          .catch((error: unknown) => {
            if (!mounted.current) return
            if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
              tokenRef.current = null
              try {
                localStorage.removeItem(SESSION_STORAGE_KEY)
              } catch (storageFailure) {
                if (!isStorageError(storageFailure)) throw storageFailure
              }
              setAuthError('Your saved sign-in expired. Your guest routine is still here.')
            } else {
              setAuthError('We could not restore your account. You can keep using ANGELO as a guest and try again later.')
            }
            setSyncStatus('local')
          })
          .finally(() => {
            if (mounted.current) setAuthReady(true)
          })
      }
    }

    return () => {
      mounted.current = false
      clearTimeout(saveTimer.current)
    }
  }, [adoptAuthenticatedState, savedSession.token])

  const setState = useCallback((change: SetStateAction<TrackerState>) => {
    const next = typeof change === 'function' ? change(currentState.current) : change
    currentState.current = next
    setCurrentState(next)

    const activeAccount = accountRef.current
    if (activeAccount && tokenRef.current) {
      persistLocal(accountCacheKey(activeAccount.username), next)
      pendingRemoteState.current = next
      scheduleRemoteSave()
      setSyncStatus('syncing')
      setSyncError('')
      return
    }

    guestState.current = next
    persistLocal(STORAGE_KEY, next)
    setSyncStatus('local')
  }, [persistLocal, scheduleRemoteSave])

  const signup = useCallback(async (username: string, password: string) => {
    setAuthBusy(true)
    setAuthError('')
    try {
      const response = await signupRequest({ username, password, tracker: guestState.current })
      if (!response.token) throw new Error('The server did not return a session token.')
      adoptAuthenticatedState(response, response.token)
    } catch (error) {
      setAuthError(messageFrom(error, 'We could not create your account. Please try again.'))
      throw error
    } finally {
      setAuthBusy(false)
      setAuthReady(true)
    }
  }, [adoptAuthenticatedState])

  const login = useCallback(async (username: string, password: string) => {
    setAuthBusy(true)
    setAuthError('')
    try {
      const response = await loginRequest({ username, password })
      if (!response.token) throw new Error('The server did not return a session token.')
      adoptAuthenticatedState(response, response.token)
    } catch (error) {
      setAuthError(messageFrom(error, 'We could not sign you in. Check your details and try again.'))
      throw error
    } finally {
      setAuthBusy(false)
      setAuthReady(true)
    }
  }, [adoptAuthenticatedState])

  const logout = useCallback(async () => {
    const token = tokenRef.current
    setAuthBusy(true)
    setAuthError('')
    clearTimeout(saveTimer.current)
    if (saveInFlight.current) await saveInFlight.current
    if (pendingRemoteState.current) await flushRemote()

    try {
      if (token) await logoutRequest(token)
    } catch (error) {
      console.error('ANGELO could not notify the server about sign out:', error)
    } finally {
      tokenRef.current = null
      accountRef.current = null
      pendingRemoteState.current = null
      setAccount(null)
      currentState.current = guestState.current
      setCurrentState(guestState.current)
      setSyncStatus('local')
      setSyncError('')
      setAuthBusy(false)
      try {
        localStorage.removeItem(SESSION_STORAGE_KEY)
      } catch (error) {
        console.error('ANGELO could not clear the saved session marker:', error)
        setStorageError('You are signed out, but your browser could not clear the saved session marker.')
      }
    }
  }, [flushRemote])

  const setProfilePublic = useCallback(async (isPublic: boolean) => {
    const token = tokenRef.current
    if (!token || !accountRef.current) return
    setAuthBusy(true)
    setAuthError('')
    try {
      const response = await updateProfile(token, isPublic)
      accountRef.current = response.account
      setAccount(response.account)
    } catch (error) {
      setAuthError(messageFrom(error, 'Your profile visibility could not be updated.'))
      throw error
    } finally {
      setAuthBusy(false)
    }
  }, [])

  return {
    state,
    setState,
    storageError,
    account,
    authReady,
    authBusy,
    authError,
    syncStatus,
    syncError,
    signup,
    login,
    logout,
    setProfilePublic,
  }
}

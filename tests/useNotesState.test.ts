import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import * as React from 'react'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import {
  dailyNotesStorageKey,
  serializeDailyNotes,
} from '../src/lib/dailyNotes.ts'
import {
  paperNotesStorageKey,
  serializePaperNotes,
} from '../src/lib/paperNotes.ts'
import type { PaperNote } from '../src/lib/paperNotes.ts'
import type { NotesState } from '../src/lib/api.ts'

// This tiny renderer deliberately exercises the real hook without adding a
// browser-DOM test dependency to the application.
// oxlint-disable react/rules-of-hooks

interface HookInput {
  username?: string | null
  token?: string | null
  initialNotes?: NotesState | null
  initialRevision?: number
}

interface NotesHookResult {
  dailyNotes: Readonly<Record<string, string>>
  setDailyNote: (key: string, text: string) => void
  paperNotes: readonly PaperNote[]
  savePaperNote: (note: PaperNote) => void
  syncStatus: 'local' | 'restoring' | 'syncing' | 'synced' | 'error'
  notesStorageError: string
  ready: boolean
  flushNotes: () => Promise<boolean>
  clearGuestNotes: () => void
}

type UseNotesState = (input: HookInput) => NotesHookResult
type DependencyList = readonly unknown[] | undefined

interface StateSlot {
  kind: 'state'
  value: unknown
  set: (next: unknown) => void
}

interface RefSlot {
  kind: 'ref'
  value: { current: unknown }
}

interface MemoSlot {
  kind: 'memo'
  value: unknown
  dependencies: DependencyList
}

interface EffectSlot {
  kind: 'effect'
  create: () => void | (() => void)
  dependencies: DependencyList
  cleanup?: () => void
}

interface ExternalStoreSlot {
  kind: 'external-store'
  value: unknown
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => unknown
  unsubscribe?: () => void
}

type HookSlot = StateSlot | RefSlot | MemoSlot | EffectSlot | ExternalStoreSlot

interface HookDispatcher {
  useState: (initial: unknown) => [unknown, (next: unknown) => void]
  useRef: (initial: unknown) => { current: unknown }
  useMemo: (factory: () => unknown, dependencies: DependencyList) => unknown
  useCallback: (callback: unknown, dependencies: DependencyList) => unknown
  useEffect: (
    create: () => void | (() => void),
    dependencies: DependencyList,
  ) => void
  useSyncExternalStore: (
    subscribe: (listener: () => void) => () => void,
    getSnapshot: () => unknown,
  ) => unknown
}

interface ReactClientInternals {
  H: HookDispatcher | null
}

const reactInternals = (
  React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactClientInternals
  }
).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

function sameDependencies(left: DependencyList, right: DependencyList): boolean {
  return left !== undefined
    && right !== undefined
    && left.length === right.length
    && left.every((value, index) => Object.is(value, right[index]))
}

class HookHarness<T> {
  current!: T

  private readonly renderHook: () => T
  private readonly slots: HookSlot[] = []
  private hookIndex = 0
  private effectIndexes: number[] = []
  private subscriptionIndexes: number[] = []
  private renderQueued = false
  private disposed = false

  private readonly dispatcher: HookDispatcher = {
    useState: (initial) => {
      const index = this.hookIndex++
      let slot = this.slots[index] as StateSlot | undefined
      if (!slot) {
        slot = {
          kind: 'state',
          value: typeof initial === 'function' ? (initial as () => unknown)() : initial,
          set: () => undefined,
        }
        slot.set = (next) => {
          const value = typeof next === 'function'
            ? (next as (previous: unknown) => unknown)(slot.value)
            : next
          if (Object.is(value, slot.value)) return
          slot.value = value
          this.scheduleRender()
        }
        this.slots[index] = slot
      }
      return [slot.value, slot.set]
    },
    useRef: (initial) => {
      const index = this.hookIndex++
      let slot = this.slots[index] as RefSlot | undefined
      if (!slot) {
        slot = { kind: 'ref', value: { current: initial } }
        this.slots[index] = slot
      }
      return slot.value
    },
    useMemo: (factory, dependencies) => {
      const index = this.hookIndex++
      let slot = this.slots[index] as MemoSlot | undefined
      if (!slot || !sameDependencies(slot.dependencies, dependencies)) {
        slot = { kind: 'memo', value: factory(), dependencies }
        this.slots[index] = slot
      }
      return slot.value
    },
    useCallback: (callback, dependencies) => {
      return this.dispatcher.useMemo(() => callback, dependencies)
    },
    useEffect: (create, dependencies) => {
      const index = this.hookIndex++
      const previous = this.slots[index] as EffectSlot | undefined
      if (previous && sameDependencies(previous.dependencies, dependencies)) return
      this.slots[index] = {
        kind: 'effect',
        create,
        dependencies,
        cleanup: previous?.cleanup,
      }
      this.effectIndexes.push(index)
    },
    useSyncExternalStore: (subscribe, getSnapshot) => {
      const index = this.hookIndex++
      let slot = this.slots[index] as ExternalStoreSlot | undefined
      if (!slot) {
        slot = {
          kind: 'external-store',
          value: getSnapshot(),
          subscribe,
          getSnapshot,
        }
        this.slots[index] = slot
        this.subscriptionIndexes.push(index)
      } else {
        slot.value = getSnapshot()
        slot.getSnapshot = getSnapshot
        if (slot.subscribe !== subscribe) {
          slot.unsubscribe?.()
          slot.unsubscribe = undefined
          slot.subscribe = subscribe
          this.subscriptionIndexes.push(index)
        }
      }
      return slot.value
    },
  }

  constructor(renderHook: () => T) {
    this.renderHook = renderHook
    this.render()
  }

  private scheduleRender(): void {
    if (this.disposed || this.renderQueued) return
    this.renderQueued = true
    queueMicrotask(() => {
      this.renderQueued = false
      if (!this.disposed) this.render()
    })
  }

  private render(): void {
    this.hookIndex = 0
    this.effectIndexes = []
    this.subscriptionIndexes = []
    const previousDispatcher = reactInternals.H
    reactInternals.H = this.dispatcher
    try {
      this.current = this.renderHook()
    } finally {
      reactInternals.H = previousDispatcher
    }

    for (const index of this.subscriptionIndexes) {
      const slot = this.slots[index] as ExternalStoreSlot
      slot.unsubscribe = slot.subscribe(() => {
        const value = slot.getSnapshot()
        if (Object.is(value, slot.value)) return
        slot.value = value
        this.scheduleRender()
      })
    }
    for (const index of this.effectIndexes) {
      const slot = this.slots[index] as EffectSlot
      slot.cleanup?.()
      const cleanup = slot.create()
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
    }
  }

  async settle(): Promise<void> {
    for (let index = 0; index < 12; index += 1) await Promise.resolve()
  }

  unmount(): void {
    if (this.disposed) return
    this.disposed = true
    for (const slot of this.slots) {
      if (slot.kind === 'effect') slot.cleanup?.()
      if (slot.kind === 'external-store') slot.unsubscribe?.()
    }
  }
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

class ManualTimers {
  private now = 0
  private nextId = 1
  private readonly tasks = new Map<number, { at: number; callback: () => void }>()

  readonly setTimeout = (callback: TimerHandler, delay = 0): ReturnType<typeof setTimeout> => {
    if (typeof callback !== 'function') throw new TypeError('Tests only support function timers.')
    const id = this.nextId++
    this.tasks.set(id, { at: this.now + Math.max(0, Number(delay) || 0), callback })
    return id as unknown as ReturnType<typeof setTimeout>
  }

  readonly clearTimeout = (timer: ReturnType<typeof setTimeout> | undefined): void => {
    this.tasks.delete(timer as unknown as number)
  }

  advance(milliseconds: number): void {
    const target = this.now + milliseconds
    while (true) {
      const due = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0]
      if (!due) break
      const [id, task] = due
      this.tasks.delete(id)
      this.now = task.at
      task.callback()
    }
    this.now = target
  }
}

class FakeDocument {
  visibilityState: DocumentVisibilityState = 'visible'
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener)
  }
}

interface FetchCall {
  url: string
  init?: RequestInit
}

const storage = new MemoryStorage()
const fakeDocument = new FakeDocument()
const fakeWindow = new EventTarget()
const fetchCalls: FetchCall[] = []
const harnesses: HookHarness<NotesHookResult>[] = []
const originalFetch = globalThis.fetch
const originalSetTimeout = globalThis.setTimeout
const originalClearTimeout = globalThis.clearTimeout
let timers = new ManualTimers()
let failFetch = false
let conflictFetch = false
let server: ViteDevServer
let useNotesState: UseNotesState

function cloudNotes(dailyNotes: Readonly<Record<string, string>> = {}): NotesState {
  return { version: 1, dailyNotes, paperNotes: [] }
}

function mount(input: HookInput): HookHarness<NotesHookResult> {
  const harness = new HookHarness(() => useNotesState(input))
  harnesses.push(harness)
  return harness
}

function requestNotes(call: FetchCall): NotesState {
  const body = JSON.parse(String(call.init?.body)) as {
    notes: NotesState
    expectedRevision: number
  }
  return body.notes
}

function requestExpectedRevision(call: FetchCall): number {
  const body = JSON.parse(String(call.init?.body)) as { expectedRevision: number }
  return body.expectedRevision
}

before(async () => {
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  Object.defineProperty(globalThis, 'document', { value: fakeDocument, configurable: true })
  Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true })
  server = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
  })
  const module = await server.ssrLoadModule('/src/hooks/useNotesState.ts') as {
    useNotesState: UseNotesState
  }
  useNotesState = module.useNotesState
})

beforeEach(() => {
  storage.clear()
  fetchCalls.length = 0
  failFetch = false
  conflictFetch = false
  timers = new ManualTimers()
  Object.defineProperty(globalThis, 'setTimeout', { value: timers.setTimeout, configurable: true })
  Object.defineProperty(globalThis, 'clearTimeout', { value: timers.clearTimeout, configurable: true })
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init })
      if (failFetch) throw new Error('network unavailable')
      if (conflictFetch) {
        return new Response(JSON.stringify({
          error: {
            code: 'NOTES_CONFLICT',
            message: 'Cloud notes changed since they were last read. Refresh and try again.',
          },
        }), { headers: { 'Content-Type': 'application/json' }, status: 409 })
      }
      const expectedRevision = requestExpectedRevision({ url: String(input), init })
      return new Response(JSON.stringify({
        updatedAt: '2026-10-06T10:00:00.000Z',
        revision: expectedRevision + 1,
      }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    },
  })
})

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.unmount()
  Object.defineProperty(globalThis, 'fetch', { value: originalFetch, configurable: true })
  Object.defineProperty(globalThis, 'setTimeout', { value: originalSetTimeout, configurable: true })
  Object.defineProperty(globalThis, 'clearTimeout', { value: originalClearTimeout, configurable: true })
})

after(async () => {
  await server.close()
})

describe('useNotesState cloud lifecycle', () => {
  it('debounces authenticated edits and sends the latest notes to the private API', async () => {
    const hook = mount({
      username: 'cloud_user',
      token: 'secret-token',
      initialNotes: cloudNotes({ '2026-10-01': 'Already in cloud' }),
    })
    await hook.settle()

    hook.current.setDailyNote('2026-10-06', 'Save me remotely')
    await hook.settle()
    assert.equal(hook.current.syncStatus, 'syncing')
    timers.advance(399)
    await hook.settle()
    assert.equal(fetchCalls.length, 0)

    timers.advance(1)
    await hook.settle()
    assert.equal(fetchCalls.length, 1)
    assert.match(fetchCalls[0].url, /\/v1\/me\/notes$/)
    assert.equal(fetchCalls[0].init?.method, 'PUT')
    assert.equal(new Headers(fetchCalls[0].init?.headers).get('Authorization'), 'Bearer secret-token')
    assert.equal(requestExpectedRevision(fetchCalls[0]), 1)
    assert.equal(requestNotes(fetchCalls[0]).dailyNotes['2026-10-06'], 'Save me remotely')
    assert.equal(hook.current.syncStatus, 'synced')
    assert.equal(storage.getItem(dailyNotesStorageKey('cloud_user')), null)
  })

  it('returns false after a failed flush and preserves the pending edit for retry', async () => {
    const hook = mount({
      username: 'retry_user',
      token: 'retry-token',
      initialNotes: cloudNotes(),
    })
    await hook.settle()
    hook.current.setDailyNote('2026-10-06', 'Do not lose this')
    await hook.settle()

    failFetch = true
    assert.equal(await hook.current.flushNotes(), false)
    await hook.settle()
    assert.equal(hook.current.syncStatus, 'error')

    failFetch = false
    assert.equal(await hook.current.flushNotes(), true)
    await hook.settle()
    assert.equal(fetchCalls.length, 2)
    assert.equal(requestNotes(fetchCalls[1]).dailyNotes['2026-10-06'], 'Do not lose this')
    assert.equal(hook.current.syncStatus, 'synced')
  })

  it('keeps a conflicting edit in memory without overwriting another device', async () => {
    const hook = mount({
      username: 'conflict_user',
      token: 'conflict-token',
      initialNotes: cloudNotes({ '2026-10-05': 'Original cloud note' }),
      initialRevision: 4,
    })
    await hook.settle()
    hook.current.setDailyNote('2026-10-06', 'Unsaved local edit')
    await hook.settle()

    conflictFetch = true
    assert.equal(await hook.current.flushNotes(), false)
    await hook.settle()
    assert.equal(fetchCalls.length, 1)
    assert.equal(requestExpectedRevision(fetchCalls[0]), 4)
    assert.equal(hook.current.dailyNotes['2026-10-06'], 'Unsaved local edit')
    assert.equal(hook.current.syncStatus, 'error')
    assert.match(hook.current.notesStorageError, /changed on another device/i)

    hook.current.setDailyNote('2026-10-07', 'A second local edit')
    await hook.settle()
    assert.equal(await hook.current.flushNotes(), false)
    assert.equal(fetchCalls.length, 1)
    assert.equal(hook.current.dailyNotes['2026-10-07'], 'A second local edit')
  })

  it('merges an unmarked second-device legacy copy without replacing cloud conflicts', async () => {
    const username = 'returning_user'
    const legacyPaperNote: PaperNote = {
      id: 'legacy-note',
      kind: 'note',
      title: 'Old local note',
      body: 'This must not overwrite cloud state.',
      createdAt: '2026-10-01T09:30:00.000Z',
      updatedAt: '2026-10-01T09:30:00.000Z',
    }
    storage.setItem(
      dailyNotesStorageKey(username),
      serializeDailyNotes({
        '2026-10-02': 'Phone-only daily note',
        '2026-10-03': 'Older local conflict',
      }),
    )
    storage.setItem(paperNotesStorageKey(username), serializePaperNotes([legacyPaperNote]))

    const hook = mount({
      username,
      token: 'returning-token',
      initialNotes: cloudNotes({ '2026-10-03': 'Current cloud note' }),
    })
    await hook.settle()
    timers.advance(1_000)
    await hook.settle()

    assert.deepEqual(hook.current.dailyNotes, {
      '2026-10-02': 'Phone-only daily note',
      '2026-10-03': 'Current cloud note',
    })
    assert.deepEqual(hook.current.paperNotes, [legacyPaperNote])
    assert.equal(fetchCalls.length, 1)
    assert.equal(requestExpectedRevision(fetchCalls[0]), 1)
    assert.deepEqual(requestNotes(fetchCalls[0]), {
      version: 1,
      dailyNotes: {
        '2026-10-02': 'Phone-only daily note',
        '2026-10-03': 'Current cloud note',
      },
      paperNotes: [legacyPaperNote],
    })
    assert.equal(storage.getItem(dailyNotesStorageKey(username)), null)
    assert.equal(storage.getItem(paperNotesStorageKey(username)), null)
    assert.equal(storage.getItem('angelo-cloud-notes-migrated-v1:returning_user'), 'done')
  })

  it('keeps an older device copy when a full cloud note list cannot absorb it', async () => {
    const username = 'full_cloud_user'
    const timestamp = '2026-10-01T09:30:00.000Z'
    const legacyPaperNote: PaperNote = {
      id: 'legacy-overflow',
      kind: 'note',
      title: 'Keep this device copy',
      body: 'There is no room in the cloud list yet.',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const cloudPaperNotes = Array.from({ length: 12 }, (_, index): PaperNote => ({
      id: `cloud-${index}`,
      kind: 'note',
      title: `Cloud note ${index + 1}`,
      body: '',
      createdAt: timestamp,
      updatedAt: timestamp,
    }))
    storage.setItem(paperNotesStorageKey(username), serializePaperNotes([legacyPaperNote]))

    const hook = mount({
      username,
      token: 'full-cloud-token',
      initialNotes: { version: 1, dailyNotes: {}, paperNotes: cloudPaperNotes },
    })
    await hook.settle()
    timers.advance(1_000)
    await hook.settle()

    assert.equal(fetchCalls.length, 0)
    assert.equal(hook.current.paperNotes.length, 12)
    assert.match(hook.current.notesStorageError, /left on this device/i)
    assert.notEqual(storage.getItem(paperNotesStorageKey(username)), null)
    assert.equal(storage.getItem('angelo-cloud-notes-migrated-v1:full_cloud_user'), null)
  })

  it('ignores and removes legacy keys rewritten after this device already migrated', async () => {
    const username = 'already_migrated'
    storage.setItem('angelo-cloud-notes-migrated-v1:already_migrated', 'done')
    storage.setItem(
      dailyNotesStorageKey(username),
      serializeDailyNotes({ '2026-10-02': 'Stale rewrite from an old tab' }),
    )

    const hook = mount({
      username,
      token: 'current-token',
      initialNotes: cloudNotes({ '2026-10-03': 'Current cloud note' }),
    })
    await hook.settle()
    timers.advance(1_000)
    await hook.settle()

    assert.deepEqual(hook.current.dailyNotes, { '2026-10-03': 'Current cloud note' })
    assert.equal(fetchCalls.length, 0)
    assert.equal(storage.getItem(dailyNotesStorageKey(username)), null)
  })

  it('uploads an older account-local copy when the cloud record does not exist yet', async () => {
    const username = 'legacy_user'
    const legacyPaperNote: PaperNote = {
      id: 'legacy-goal',
      kind: 'goal',
      title: 'Move this note',
      body: 'From the device into the private cloud record.',
      createdAt: '2026-10-01T09:30:00.000Z',
      updatedAt: '2026-10-01T09:30:00.000Z',
    }
    storage.setItem(
      dailyNotesStorageKey(username),
      serializeDailyNotes({ '2026-10-02': 'Move this daily note too' }),
    )
    storage.setItem(paperNotesStorageKey(username), serializePaperNotes([legacyPaperNote]))

    const hook = mount({ username, token: 'legacy-token', initialNotes: null })
    await hook.settle()
    assert.deepEqual(hook.current.dailyNotes, { '2026-10-02': 'Move this daily note too' })
    assert.deepEqual(hook.current.paperNotes, [legacyPaperNote])

    timers.advance(400)
    await hook.settle()
    assert.equal(fetchCalls.length, 1)
    assert.equal(requestExpectedRevision(fetchCalls[0]), 0)
    assert.deepEqual(requestNotes(fetchCalls[0]), {
      version: 1,
      dailyNotes: { '2026-10-02': 'Move this daily note too' },
      paperNotes: [legacyPaperNote],
    })
    assert.equal(storage.getItem(dailyNotesStorageKey(username)), null)
    assert.equal(storage.getItem(paperNotesStorageKey(username)), null)
    assert.equal(storage.getItem('angelo-cloud-notes-migrated-v1:legacy_user'), 'done')
  })

  it('keeps guest edits device-only and clears their copy after account transfer', async () => {
    const hook = mount({})
    await hook.settle()
    hook.current.setDailyNote('2026-10-06', 'Guest-only daily note')
    hook.current.savePaperNote({
      id: 'guest-note',
      kind: 'goal',
      title: 'Guest goal',
      body: 'Stored on this device',
      createdAt: '2026-10-06T09:30:00.000Z',
      updatedAt: '2026-10-06T09:30:00.000Z',
    })
    await hook.settle()
    timers.advance(1_000)
    await hook.settle()

    const daily = JSON.parse(String(storage.getItem(dailyNotesStorageKey()))) as {
      notes: Record<string, string>
    }
    const paper = JSON.parse(String(storage.getItem(paperNotesStorageKey()))) as {
      notes: PaperNote[]
    }
    assert.equal(daily.notes['2026-10-06'], 'Guest-only daily note')
    assert.equal(paper.notes.some((note) => note.id === 'guest-note'), true)
    assert.equal(fetchCalls.length, 0)
    assert.equal(hook.current.syncStatus, 'local')

    hook.current.clearGuestNotes()
    await hook.settle()
    const clearedDaily = JSON.parse(String(storage.getItem(dailyNotesStorageKey()))) as {
      notes: Record<string, string>
    }
    const clearedPaper = JSON.parse(String(storage.getItem(paperNotesStorageKey()))) as {
      notes: PaperNote[]
    }
    assert.deepEqual(clearedDaily.notes, {})
    assert.deepEqual(clearedPaper.notes, [])
    assert.deepEqual(hook.current.dailyNotes, {})
    assert.deepEqual(hook.current.paperNotes, [])
  })
})


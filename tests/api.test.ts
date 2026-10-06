import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  API_BASE_URL,
  getPasswordValidationError,
  getPublicProfile,
  getUsernameValidationError,
  normalizeUsername,
  signup,
  updateNotes,
} from '../src/lib/api.ts'
import type { NotesState } from '../src/lib/api.ts'
import type { TrackerState } from '../src/lib/tracker.ts'

const tracker: TrackerState = {
  version: 2,
  title: 'Show up',
  startedOn: '2026-10-01',
  habitPlans: {
    '2026-10': [{ id: 'read', name: 'Read', startedOn: '2026-10-01' }],
  },
  completions: {},
  reminders: [],
  isDemo: false,
}

const notes: NotesState = {
  version: 1,
  dailyNotes: { '2026-10-06': 'A steady day.' },
  paperNotes: [{
    id: 'keep-going',
    kind: 'principle',
    title: 'Keep going',
    body: 'Small steps count.',
    createdAt: '2026-10-06T05:00:00.000Z',
    updatedAt: '2026-10-06T05:00:00.000Z',
  }],
}

describe('frontend API contract', () => {
  it('normalizes and validates usernames before sending auth requests', () => {
    assert.equal(normalizeUsername('  Daily_User  '), 'daily_user')
    assert.equal(getUsernameValidationError('daily_user'), null)
    assert.match(getUsernameValidationError('no spaces') ?? '', /letters, numbers, and underscores/)
    assert.match(getUsernameValidationError('admin') ?? '', /reserved/)
    assert.equal(getPasswordValidationError('eight888'), null)
    assert.match(getPasswordValidationError('short') ?? '', /8 to 128/)
  })

  it('always includes the selected month when opening a public profile', async () => {
    const originalFetch = globalThis.fetch
    let requestedUrl = ''
    globalThis.fetch = async (input) => {
      requestedUrl = String(input)
      return new Response(JSON.stringify({
        profile: {
          username: 'daily_user',
          title: 'Show up',
          habits: ['Read'],
          month: '2026-09',
          stats: { completed: 1, total: 30, percentage: 3 },
          joinedAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-19T00:00:00.000Z',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    try {
      await getPublicProfile('daily_user', '2026-09')
      assert.equal(requestedUrl, `${API_BASE_URL}/v1/profiles/daily_user?month=2026-09`)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('includes signup notes only when the caller provides them', async () => {
    const originalFetch = globalThis.fetch
    const requests: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), init })
      return new Response(JSON.stringify({
        token: 'session-token',
        account: {
          username: 'daily_user',
          isPublic: true,
          createdAt: '2026-10-06T05:00:00.000Z',
        },
        tracker,
        notes: requests.length === 1 ? null : notes,
        notesRevision: requests.length === 1 ? 0 : 1,
      }), { status: 201, headers: { 'content-type': 'application/json' } })
    }

    try {
      await signup({ username: 'daily_user', password: 'password123', tracker })
      await signup({ username: 'daily_user', password: 'password123', tracker, notes })

      assert.equal(requests.length, 2)
      assert.equal(requests[0].url, `${API_BASE_URL}/v1/auth/signup`)
      assert.equal(requests[0].init?.method, 'POST')
      assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
        username: 'daily_user',
        password: 'password123',
        tracker,
      })
      assert.deepEqual(JSON.parse(String(requests[1].init?.body)), {
        username: 'daily_user',
        password: 'password123',
        tracker,
        notes,
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('saves notes to the private cloud endpoint with bearer authentication', async () => {
    const originalFetch = globalThis.fetch
    let requestedUrl = ''
    let requestedInit: RequestInit | undefined
    globalThis.fetch = async (input, init) => {
      requestedUrl = String(input)
      requestedInit = init
      return new Response(JSON.stringify({
        updatedAt: '2026-10-06T05:30:00.000Z',
        revision: 8,
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    try {
      const response = await updateNotes('private-session-token', notes, 7, undefined, true)

      assert.deepEqual(response, { updatedAt: '2026-10-06T05:30:00.000Z', revision: 8 })
      assert.equal(requestedUrl, `${API_BASE_URL}/v1/me/notes`)
      assert.equal(requestedInit?.method, 'PUT')
      assert.equal(requestedInit?.keepalive, true)
      const headers = new Headers(requestedInit?.headers)
      assert.equal(headers.get('authorization'), 'Bearer private-session-token')
      assert.equal(headers.get('content-type'), 'application/json')
      assert.deepEqual(JSON.parse(String(requestedInit?.body)), { notes, expectedRevision: 7 })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { hashSessionToken, SESSION_TTL_MS } from '../src/auth.js'
import { loadConfig } from '../src/config.js'
import { MemoryStore } from '../src/memory-store.js'
import {
  MAX_COMPLETION_DATES,
  MAX_HABIT_PLANS,
  MAX_TRACKER_BYTES,
  validateTracker,
} from '../src/tracker.js'
import type { LegacyTrackerState, MonthHabit, TrackerState } from '../src/types.js'

const PASSWORD = 'a-safe-password'
const ORIGIN = 'https://app.example.com'

function tracker(overrides: Partial<TrackerState> = {}): TrackerState {
  return {
    version: 2,
    title: 'Keep Going',
    startedOn: '2026-09-01',
    habitPlans: {
      '2026-09': [
        { id: 'move', name: 'Move', startedOn: '2026-09-01' },
        { id: 'read', name: 'Read', startedOn: '2026-09-01' },
      ],
    },
    completions: {
      '2026-09-01': ['move', 'read'],
      '2026-09-02': ['move'],
    },
    isDemo: false,
    ...structuredClone(overrides),
  }
}

function legacyTracker(overrides: Partial<LegacyTrackerState> = {}): LegacyTrackerState {
  return {
    version: 1,
    title: 'Keep Going',
    habits: [
      { id: 'move', name: 'Move' },
      { id: 'read', name: 'Read' },
    ],
    completions: {
      '2026-09-01': ['move', 'read'],
      '2026-09-02': ['move'],
    },
    isDemo: false,
    ...structuredClone(overrides),
  }
}

function migratedLegacy(value: LegacyTrackerState): TrackerState {
  return {
    version: 2,
    title: value.title,
    startedOn: '0000-01-01',
    habitPlans: {
      '0000-01': value.habits.map((habit) => ({
        ...habit,
        startedOn: '0000-01-01',
      })),
    },
    completions: structuredClone(value.completions),
    isDemo: value.isDemo,
  }
}

function numberedHabits(prefix: string, count: number, startedOn: string): MonthHabit[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    name: `${prefix} ${index + 1}`,
    startedOn,
  }))
}

function emptyPlanHistory(count: number): Record<string, MonthHabit[]> {
  const plans: Record<string, MonthHabit[]> = {}
  for (let offset = 0; offset < count; offset += 1) {
    const absoluteMonth = 2026 * 12 + 8 + offset
    const year = Math.floor(absoluteMonth / 12)
    const month = absoluteMonth - year * 12 + 1
    plans[`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`] = []
  }
  return plans
}

function emptyCompletionHistory(count: number): Record<string, string[]> {
  const completions: Record<string, string[]> = {}
  let created = 0
  for (let year = 2027; created < count; year += 1) {
    for (let month = 1; month <= 12 && created < count; month += 1) {
      for (let day = 1; day <= 28 && created < count; day += 1) {
        const key = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        completions[key] = []
        created += 1
      }
    }
  }
  return completions
}

async function testApp(options: { now?: () => Date; rateLimitEnabled?: boolean } = {}) {
  const store = new MemoryStore()
  const app = await buildApp({
    store,
    allowedOrigins: [ORIGIN],
    now: options.now ?? (() => new Date('2026-09-19T00:00:00.000Z')),
    rateLimitEnabled: options.rateLimitEnabled ?? false,
  })
  return { app, store }
}

async function signup(
  app: FastifyInstance,
  username = 'alice',
  value: TrackerState | LegacyTrackerState = tracker(),
) {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { username, password: PASSWORD, tracker: value },
  })
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` }
}

describe('health, security headers, and CORS', () => {
  it('serves health and allows only configured exact origins', async (context) => {
    const { app } = await testApp()
    context.after(() => app.close())

    const allowed = await app.inject({ method: 'GET', url: '/healthz', headers: { origin: ORIGIN } })
    assert.equal(allowed.statusCode, 200)
    assert.deepEqual(allowed.json(), { status: 'ok' })
    assert.equal(allowed.headers['access-control-allow-origin'], ORIGIN)
    assert.equal(allowed.headers['access-control-allow-credentials'], undefined)
    assert.equal(allowed.headers['x-content-type-options'], 'nosniff')

    const denied = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { origin: 'https://attacker.example.com' },
    })
    assert.equal(denied.statusCode, 200)
    assert.equal(denied.headers['access-control-allow-origin'], undefined)

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/v1/profiles?query=a',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'GET',
      },
    })
    assert.equal(preflight.statusCode, 204)
    assert.equal(preflight.headers['access-control-allow-origin'], ORIGIN)
  })

  it('fails closed on mistyped production configuration', () => {
    assert.throws(
      () => loadConfig({ NODE_ENV: 'prod' }),
      /NODE_ENV must be development, test, or production/,
    )
    assert.throws(
      () => loadConfig({ NODE_ENV: 'production', DATA_STORE: 'memory', ALLOWED_ORIGINS: ORIGIN }),
      /Production must use the firestore data store/,
    )
    assert.throws(
      () => loadConfig({ NODE_ENV: 'production', DATA_STORE: 'firestore', ALLOWED_ORIGINS: `${ORIGIN}/path` }),
      /exact HTTP\(S\) origins/,
    )
  })

  it('does not let forged forwarded-for prefixes bypass auth rate limits', async (context) => {
    const { app } = await testApp({ rateLimitEnabled: true })
    context.after(() => app.close())

    const statuses: number[] = []
    for (let attempt = 0; attempt < 21; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        headers: {
          // The left value is untrusted caller input; the right value represents
          // the address appended by the platform's directly connected proxy.
          'x-forwarded-for': `198.51.100.${attempt + 1}, 203.0.113.25`,
        },
        payload: { username: 'nobody', password: 'wrong-password' },
      })
      statuses.push(response.statusCode)
    }
    assert.deepEqual(statuses.slice(0, 20), Array.from({ length: 20 }, () => 401))
    assert.equal(statuses[20], 429)
  })
})

describe('signup and credentials', () => {
  it('normalizes usernames, hashes passwords, and resets demos to today with the effective plan', async (context) => {
    const { app, store } = await testApp()
    context.after(() => app.close())
    const demo = tracker({
      startedOn: '2026-07-04',
      habitPlans: {
        '2026-07': [
          { id: 'move', name: 'Move', startedOn: '2026-07-04' },
        ],
        '2026-08': [
          { id: 'move', name: 'Move', startedOn: '2026-07-04' },
          { id: 'read', name: 'Read', startedOn: '2026-08-06' },
        ],
        '2026-09': [
          { id: 'move', name: 'Move', startedOn: '2026-07-04' },
          { id: 'stretch', name: 'Stretch', startedOn: '2026-09-25' },
        ],
        '2026-10': [
          { id: 'future', name: 'Future plan', startedOn: '2026-10-01' },
        ],
      },
      completions: {
        '2026-07-04': ['move'],
        '2026-08-06': ['move', 'read'],
      },
      isDemo: true,
    })

    const response = await signup(app, '  New_USER  ', demo)
    assert.equal(response.statusCode, 201)
    const body = response.json()
    assert.match(body.token, /^[A-Za-z0-9_-]{43}$/)
    assert.deepEqual(body.account, {
      username: 'new_user',
      isPublic: true,
      createdAt: '2026-09-19T00:00:00.000Z',
    })
    assert.equal(body.tracker.title, demo.title)
    assert.deepEqual(body.tracker, {
      version: 2,
      title: 'Keep Going',
      startedOn: '2026-09-19',
      habitPlans: {
        '2026-09': [
          { id: 'move', name: 'Move', startedOn: '2026-09-19' },
          { id: 'stretch', name: 'Stretch', startedOn: '2026-09-19' },
        ],
      },
      completions: {},
      isDemo: false,
    })
    assert.equal(JSON.stringify(body).includes('passwordHash'), false)
    assert.equal(JSON.stringify(body).includes('passwordSalt'), false)

    const stored = await store.getUser('new_user')
    assert.ok(stored)
    assert.notEqual(stored.passwordHash, PASSWORD)
    assert.notEqual(stored.passwordSalt, PASSWORD)
    assert.equal(stored.passwordHash.length > 40, true)
    assert.equal(stored.passwordSalt.length > 10, true)

    assert.equal(await store.getSession(body.token), null)
    assert.ok(await store.getSession(hashSessionToken(body.token)))
  })

  it('accepts legacy V1 state but stores and returns only canonical V2 state', async (context) => {
    const { app } = await testApp()
    context.after(() => app.close())
    const legacy = legacyTracker()

    const created = await signup(app, 'legacy_user', legacy)
    assert.equal(created.statusCode, 201)
    assert.deepEqual(created.json().tracker, migratedLegacy(legacy))
    const token = created.json().token as string

    const replacement = legacyTracker({
      title: 'Imported again',
      habits: [{ id: 'write', name: 'Write' }],
      completions: { '1999-12-31': ['write'] },
    })
    const updated = await app.inject({
      method: 'PUT',
      url: '/v1/me/tracker',
      headers: bearer(token),
      payload: { tracker: replacement },
    })
    assert.equal(updated.statusCode, 200)

    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(token) })
    assert.deepEqual(me.json().tracker, migratedLegacy(replacement))
  })

  it('preserves a demo baseline that begins in the next client-local month', async (context) => {
    const { app } = await testApp({ now: () => new Date('2026-08-31T19:00:00.000Z') })
    context.after(() => app.close())
    const localSeptemberDemo = tracker({
      startedOn: '2026-09-01',
      habitPlans: {
        '2026-09': [
          { id: 'move', name: 'Move', startedOn: '2026-09-01' },
          { id: 'read', name: 'Read', startedOn: '2026-09-01' },
        ],
      },
      completions: {},
      isDemo: true,
    })

    const response = await signup(app, 'month_edge', localSeptemberDemo)

    assert.equal(response.statusCode, 201)
    assert.deepEqual(response.json().tracker, {
      version: 2,
      title: 'Keep Going',
      startedOn: '2026-08-31',
      habitPlans: {
        '2026-08': [
          { id: 'move', name: 'Move', startedOn: '2026-08-31' },
          { id: 'read', name: 'Read', startedOn: '2026-08-31' },
        ],
      },
      completions: {},
      isDemo: false,
    })
  })

  it('atomically accepts only one case-insensitive concurrent username claim', async (context) => {
    const { app } = await testApp()
    context.after(() => app.close())

    const responses = await Promise.all([
      signup(app, 'Racer'),
      signup(app, ' racer '),
      signup(app, 'RACER'),
    ])
    assert.deepEqual(
      responses.map((response) => response.statusCode).sort((a, b) => a - b),
      [201, 409, 409],
    )
    for (const response of responses.filter((item) => item.statusCode === 409)) {
      assert.equal(response.json().error.code, 'USERNAME_TAKEN')
    }
  })

  it('rejects reserved/malformed usernames and weak passwords', async (context) => {
    const { app } = await testApp()
    context.after(() => app.close())

    for (const username of ['ab', 'has-dash', 'Admin', 'x'.repeat(25)]) {
      const response = await signup(app, username)
      assert.equal(response.statusCode, 400)
      assert.equal(response.json().error.code, 'INVALID_USERNAME')
    }
    const password = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { username: 'valid_name', password: 'short', tracker: tracker() },
    })
    assert.equal(password.statusCode, 400)
    assert.equal(password.json().error.code, 'INVALID_PASSWORD')
  })

  it('uses the same generic response for unknown, malformed, and wrong credentials', async (context) => {
    const { app } = await testApp()
    context.after(() => app.close())
    assert.equal((await signup(app)).statusCode, 201)

    const attempts = [
      { username: 'alice', password: 'wrong-password' },
      { username: 'nobody', password: 'wrong-password' },
      { username: '??', password: 'wrong-password' },
    ]
    const responses = []
    for (const payload of attempts) {
      responses.push(await app.inject({ method: 'POST', url: '/v1/auth/login', payload }))
    }
    for (const response of responses) {
      assert.equal(response.statusCode, 401)
      assert.deepEqual(response.json(), {
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' },
      })
    }

    const success = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: 'ALICE', password: PASSWORD },
    })
    assert.equal(success.statusCode, 200)
    assert.equal(success.json().account.username, 'alice')
    assert.match(success.json().token, /^[A-Za-z0-9_-]{43}$/)
  })
})

describe('sessions', () => {
  it('authenticates bearer sessions and revokes them on logout', async (context) => {
    const { app } = await testApp()
    context.after(() => app.close())
    const created = await signup(app)
    const token = created.json().token as string

    const anonymous = await app.inject({ method: 'GET', url: '/v1/auth/me' })
    assert.equal(anonymous.statusCode, 401)

    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(token) })
    assert.equal(me.statusCode, 200)
    assert.equal(me.json().token, undefined)
    assert.equal(me.json().account.username, 'alice')
    assert.deepEqual(me.json().tracker, tracker())
    assert.equal(me.headers['cache-control'], 'no-store')

    const logout = await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: bearer(token) })
    assert.equal(logout.statusCode, 200)
    assert.deepEqual(logout.json(), { ok: true })
    const revoked = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(token) })
    assert.equal(revoked.statusCode, 401)
  })

  it('expires fixed 30-day sessions and removes expired records', async (context) => {
    let milliseconds = Date.parse('2026-09-19T00:00:00.000Z')
    const { app, store } = await testApp({ now: () => new Date(milliseconds) })
    context.after(() => app.close())
    const created = await signup(app)
    const token = created.json().token as string
    const tokenHash = hashSessionToken(token)
    assert.ok(await store.getSession(tokenHash))

    milliseconds += SESSION_TTL_MS + 1
    const expired = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(token) })
    assert.equal(expired.statusCode, 401)
    assert.equal(await store.getSession(tokenHash), null)
  })
})

describe('tracker validation and updates', () => {
  it('updates a valid change-point tracker and rejects invalid dates and plan histories', async (context) => {
    const { app } = await testApp()
    context.after(() => app.close())
    const token = (await signup(app)).json().token as string
    const next = tracker({
      title: 'A New Chapter',
      startedOn: '2026-09-10',
      habitPlans: {
        '2026-09': [
          { id: 'move', name: 'Move', startedOn: '2026-09-10' },
          { id: 'read', name: 'Read', startedOn: '2026-09-15' },
        ],
        '2026-10': [
          { id: 'move', name: 'Move', startedOn: '2026-09-10' },
          { id: 'code', name: 'Code', startedOn: '2026-10-05' },
          { id: 'write', name: 'Write', startedOn: '2026-10-01' },
        ],
      },
      completions: {
        '2026-09-10': ['move'],
        '2026-09-15': ['move', 'read'],
        '2026-10-05': ['move', 'code'],
      },
    })

    const updated = await app.inject({
      method: 'PUT',
      url: '/v1/me/tracker',
      headers: bearer(token),
      payload: { tracker: next },
    })
    assert.equal(updated.statusCode, 200)
    assert.equal(updated.json().updatedAt, '2026-09-19T00:00:00.000Z')
    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(token) })
    assert.deepEqual(me.json().tracker, next)
    const search = await app.inject({ method: 'GET', url: '/v1/profiles?query=ali' })
    assert.deepEqual(search.json(), {
      profiles: [{
        username: 'alice',
        title: 'A New Chapter',
        habitCount: 3,
        updatedAt: '2026-09-19T00:00:00.000Z',
      }],
    })

    const invalidTrackers: unknown[] = [
      { ...next, extra: true },
      { ...next, title: 'x'.repeat(61) },
      { ...next, startedOn: '2026-02-29' },
      {
        ...next,
        habitPlans: { '2026-10': next.habitPlans['2026-10'] },
        completions: {},
      },
      { ...next, habitPlans: { '2026-13': [] }, completions: {} },
      {
        ...next,
        habitPlans: { '2026-08': [], ...next.habitPlans },
        completions: {},
      },
      tracker({
        startedOn: '2026-09-10',
        habitPlans: {
          '2026-09': [{ id: 'move', name: 'Move', startedOn: '2026-10-01' }],
        },
        completions: {},
      }),
      tracker({
        startedOn: '2026-09-10',
        habitPlans: {
          '2026-09': [{ id: 'move', name: 'Move', startedOn: '2026-09-09' }],
        },
        completions: {},
      }),
      { ...next, completions: { '2026-09-09': ['move'] } },
      { ...next, completions: { '2026-09-14': ['read'] } },
      { ...next, completions: { '2026-09-15': ['missing'] } },
      { ...next, completions: { '2026-10-10': ['read'] } },
      { ...next, completions: { '2026-02-29': ['move'] } },
      { ...next, completions: { '2026-09-15': ['move', 'move'] } },
      tracker({
        habitPlans: {
          '2026-09': [
            { id: 'move', name: 'Move', startedOn: '2026-09-01' },
            { id: 'move', name: 'Walk', startedOn: '2026-09-01' },
          ],
        },
        completions: {},
      }),
      tracker({
        habitPlans: {
          '2026-09': [
            { id: 'move', name: 'Move', startedOn: '2026-09-01' },
            { id: 'walk', name: 'move', startedOn: '2026-09-01' },
          ],
        },
        completions: {},
      }),
      tracker({
        habitPlans: { '2026-09': numberedHabits('habit', 10, '2026-09-01') },
        completions: {},
      }),
      tracker({
        habitPlans: {
          '2026-09': [{ id: 'move', name: 'Move', startedOn: '2026-09-01' }],
          '2026-10': [{ id: 'move', name: 'Move', startedOn: '2026-10-01' }],
        },
        completions: {},
      }),
      tracker({
        habitPlans: {
          '2026-09': [{ id: 'move', name: 'Move', startedOn: '2026-09-01', extra: true }],
        } as unknown as Record<string, MonthHabit[]>,
        completions: {},
      }),
    ]
    for (const invalidTracker of invalidTrackers) {
      const response = await app.inject({
        method: 'PUT',
        url: '/v1/me/tracker',
        headers: bearer(token),
        payload: { tracker: invalidTracker },
      })
      assert.equal(response.statusCode, 400)
      assert.equal(response.json().error.code, 'INVALID_TRACKER')
    }
  })

  it('allows more than nine distinct habit IDs across history when each plan has at most nine', async (context) => {
    const { app } = await testApp()
    context.after(() => app.close())
    const token = (await signup(app)).json().token as string
    const historical = tracker({
      habitPlans: {
        '2026-09': numberedHabits('old', 9, '2026-09-01'),
        '2026-10': numberedHabits('new', 9, '2026-10-01'),
      },
      completions: {},
    })

    const updated = await app.inject({
      method: 'PUT',
      url: '/v1/me/tracker',
      headers: bearer(token),
      payload: { tracker: historical },
    })
    assert.equal(updated.statusCode, 200)
    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(token) })
    assert.deepEqual(me.json().tracker, historical)
  })

  it('bounds V2 change points and completion-date keys', async (context) => {
    const { app } = await testApp()
    context.after(() => app.close())
    const token = (await signup(app)).json().token as string

    const tooManyPlans = await app.inject({
      method: 'PUT',
      url: '/v1/me/tracker',
      headers: bearer(token),
      payload: {
        tracker: tracker({
          habitPlans: emptyPlanHistory(MAX_HABIT_PLANS + 1),
          completions: {},
        }),
      },
    })
    assert.equal(tooManyPlans.statusCode, 400)
    assert.equal(tooManyPlans.json().error.code, 'INVALID_TRACKER')

    const tooManyCompletionDates = await app.inject({
      method: 'PUT',
      url: '/v1/me/tracker',
      headers: bearer(token),
      payload: {
        tracker: tracker({
          completions: emptyCompletionHistory(MAX_COMPLETION_DATES + 1),
        }),
      },
    })
    assert.equal(tooManyCompletionDates.statusCode, 400)
    assert.equal(tooManyCompletionDates.json().error.code, 'INVALID_TRACKER')
  })

  it('keeps old-limit V1 trackers valid after sentinel expansion', () => {
    const legacy = legacyTracker({ completions: emptyCompletionHistory(44_790) })
    const oldLimit = 700 * 1024
    const legacyBytes = Buffer.byteLength(JSON.stringify(legacy), 'utf8')

    assert.ok(legacyBytes <= oldLimit)
    const migrated = validateTracker(legacy)
    const migratedBytes = Buffer.byteLength(JSON.stringify(migrated), 'utf8')
    assert.ok(migratedBytes > oldLimit)
    assert.ok(migratedBytes <= MAX_TRACKER_BYTES)
    assert.deepEqual(validateTracker(migrated), migrated)
  })

  it('rejects request bodies before they can approach Firestore document limits', async (context) => {
    const { app } = await testApp()
    context.after(() => app.close())
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        username: 'oversized',
        password: PASSWORD,
        tracker: tracker(),
        padding: 'x'.repeat(801 * 1024),
      }),
    })
    assert.equal(response.statusCode, 413)
    assert.equal(response.json().error.code, 'REQUEST_TOO_LARGE')
  })
})

describe('public profiles and privacy', () => {
  it('searches summary-only profiles and resolves start-aware month plans and statistics', async (context) => {
    const { app, store } = await testApp()
    context.after(() => app.close())
    const aliceTracker = tracker({
      startedOn: '2026-09-10',
      habitPlans: {
        '2026-09': [
          { id: 'move', name: 'Move', startedOn: '2026-09-10' },
          { id: 'read', name: 'Read', startedOn: '2026-09-15' },
        ],
        '2026-10': [
          { id: 'code', name: 'Code', startedOn: '2026-10-10' },
        ],
      },
      completions: {
        '2026-09-10': ['move'],
        '2026-09-15': ['move', 'read'],
        '2026-11-01': ['code'],
      },
    })
    const alice = await signup(app, 'alice', aliceTracker)
    assert.equal(alice.statusCode, 201)
    assert.equal((await signup(app, 'albert', tracker({ title: 'Read Daily' }))).statusCode, 201)
    assert.equal((await signup(app, 'bob')).statusCode, 201)

    const search = await app.inject({ method: 'GET', url: '/v1/profiles?query=AL' })
    assert.equal(search.statusCode, 200)
    assert.deepEqual(search.json().profiles.map((profile: { username: string }) => profile.username), [
      'albert',
      'alice',
    ])
    assert.deepEqual(search.json().profiles[1], {
      username: 'alice',
      title: 'Keep Going',
      habitCount: 1,
      updatedAt: '2026-09-19T00:00:00.000Z',
    })
    const storedSummaries = await store.searchPublicProfiles('al', 20)
    assert.deepEqual(storedSummaries[1], search.json().profiles[1])
    assert.equal(Object.hasOwn(storedSummaries[1] as object, 'tracker'), false)
    assert.equal(Object.hasOwn(storedSummaries[1] as object, 'passwordHash'), false)

    const beforeStart = await app.inject({
      method: 'GET',
      url: '/v1/profiles/alice?month=2026-08',
    })
    assert.equal(beforeStart.statusCode, 200)
    assert.deepEqual(beforeStart.json(), {
      profile: {
        username: 'alice',
        title: 'Keep Going',
        habits: [],
        month: '2026-08',
        stats: { completed: 0, total: 0, percentage: 0 },
        joinedAt: '2026-09-19T00:00:00.000Z',
        updatedAt: '2026-09-19T00:00:00.000Z',
      },
    })

    const startingMonth = await app.inject({
      method: 'GET',
      url: '/v1/profiles/alice?month=2026-09',
    })
    assert.equal(startingMonth.statusCode, 200)
    assert.deepEqual(startingMonth.json(), {
      profile: {
        username: 'alice',
        title: 'Keep Going',
        habits: ['Move', 'Read'],
        month: '2026-09',
        stats: { completed: 3, total: 37, percentage: 8 },
        joinedAt: '2026-09-19T00:00:00.000Z',
        updatedAt: '2026-09-19T00:00:00.000Z',
      },
    })

    const inherited = await app.inject({
      method: 'GET',
      url: '/v1/profiles/alice?month=2026-11',
    })
    assert.equal(inherited.statusCode, 200)
    assert.deepEqual(inherited.json(), {
      profile: {
        username: 'alice',
        title: 'Keep Going',
        habits: ['Code'],
        month: '2026-11',
        stats: { completed: 1, total: 30, percentage: 3 },
        joinedAt: '2026-09-19T00:00:00.000Z',
        updatedAt: '2026-09-19T00:00:00.000Z',
      },
    })
    assert.equal(inherited.headers['cache-control'], 'no-store')
  })

  it('hides private accounts from both search and direct lookup', async (context) => {
    const { app } = await testApp()
    context.after(() => app.close())
    const created = await signup(app, 'private_user')
    const token = created.json().token as string

    const changed = await app.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: bearer(token),
      payload: { isPublic: false },
    })
    assert.equal(changed.statusCode, 200)
    assert.deepEqual(changed.json().account, {
      username: 'private_user',
      isPublic: false,
      createdAt: '2026-09-19T00:00:00.000Z',
    })

    const search = await app.inject({ method: 'GET', url: '/v1/profiles?query=private' })
    assert.deepEqual(search.json(), { profiles: [] })
    const direct = await app.inject({
      method: 'GET',
      url: '/v1/profiles/private_user?month=2026-09',
    })
    assert.equal(direct.statusCode, 404)
    assert.equal(direct.json().error.code, 'PROFILE_NOT_FOUND')
  })

  it('validates profile months and never returns private credential fields', async (context) => {
    const { app } = await testApp()
    context.after(() => app.close())
    assert.equal((await signup(app, 'safeuser')).statusCode, 201)

    const invalid = await app.inject({ method: 'GET', url: '/v1/profiles/safeuser?month=2026-13' })
    assert.equal(invalid.statusCode, 400)
    assert.equal(invalid.json().error.code, 'INVALID_MONTH')
    const valid = await app.inject({ method: 'GET', url: '/v1/profiles/safeuser?month=2026-09' })
    const serialized = valid.body
    for (const privateField of ['password', 'passwordHash', 'passwordSalt', 'token']) {
      assert.equal(serialized.includes(privateField), false)
    }
  })
})

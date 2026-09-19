import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  API_BASE_URL,
  getPasswordValidationError,
  getPublicProfile,
  getUsernameValidationError,
  normalizeUsername,
} from '../src/lib/api.ts'

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
})

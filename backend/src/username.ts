import { ApiError } from './errors.js'

export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 24

export const RESERVED_USERNAMES = new Set([
  'admin',
  'angelo',
  'api',
  'auth',
  'login',
  'logout',
  'me',
  'profile',
  'profiles',
  'root',
  'settings',
  'signup',
  'support',
  'system',
])

export function normalizeUsername(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ApiError(400, 'INVALID_USERNAME', 'Username must be a string.')
  }

  const username = value.trim().toLowerCase()
  if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
    throw new ApiError(
      400,
      'INVALID_USERNAME',
      `Username must contain ${USERNAME_MIN_LENGTH} to ${USERNAME_MAX_LENGTH} characters.`,
    )
  }
  if (!/^[a-z0-9_]+$/.test(username)) {
    throw new ApiError(
      400,
      'INVALID_USERNAME',
      'Username may contain only lowercase letters, numbers, and underscores.',
    )
  }
  if (RESERVED_USERNAMES.has(username)) {
    throw new ApiError(400, 'INVALID_USERNAME', 'That username is reserved.')
  }
  return username
}

export function normalizeSearchQuery(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value !== 'string') {
    throw new ApiError(400, 'INVALID_QUERY', 'Search query must be a string.')
  }
  const query = value.trim().toLowerCase()
  if (query.length > USERNAME_MAX_LENGTH || !/^[a-z0-9_]*$/.test(query)) {
    throw new ApiError(
      400,
      'INVALID_QUERY',
      `Search query must contain at most ${USERNAME_MAX_LENGTH} letters, numbers, or underscores.`,
    )
  }
  return query
}

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { ApiError, SessionCollisionError } from './errors.js'
import type { DataStore } from './store.js'
import type { SessionRecord, UserRecord } from './types.js'

const PASSWORD_MIN_LENGTH = 8
const PASSWORD_MAX_LENGTH = 128
const SCRYPT_KEY_LENGTH = 64
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const DUMMY_SALT = Buffer.from('angelo-invalid-user-salt', 'utf8').toString('base64')
const DUMMY_HASH = Buffer.alloc(SCRYPT_KEY_LENGTH).toString('base64')
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

function runScrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) reject(error)
      else resolve(derivedKey)
    })
  })
}

export function validatePassword(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ApiError(400, 'INVALID_PASSWORD', 'Password must be a string.')
  }
  const length = Array.from(value).length
  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
    throw new ApiError(
      400,
      'INVALID_PASSWORD',
      `Password must contain ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`,
    )
  }
  return value
}

export async function hashPassword(password: string): Promise<{ passwordHash: string; passwordSalt: string }> {
  const salt = randomBytes(16)
  const hash = await runScrypt(password, salt)
  return { passwordHash: hash.toString('base64'), passwordSalt: salt.toString('base64') }
}

export async function verifyPassword(
  candidate: string,
  credentials: Pick<UserRecord, 'passwordHash' | 'passwordSalt'> | null,
): Promise<boolean> {
  const hashText = credentials?.passwordHash ?? DUMMY_HASH
  const saltText = credentials?.passwordSalt ?? DUMMY_SALT
  let expected: Buffer
  let salt: Buffer
  try {
    expected = Buffer.from(hashText, 'base64')
    salt = Buffer.from(saltText, 'base64')
  } catch {
    expected = Buffer.alloc(SCRYPT_KEY_LENGTH)
    salt = Buffer.from(DUMMY_SALT, 'base64')
  }
  const actual = await runScrypt(candidate, salt)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export async function issueSession(
  store: DataStore,
  username: string,
  now: Date,
): Promise<{ token: string; session: SessionRecord }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = randomBytes(32).toString('base64url')
    const session: SessionRecord = {
      tokenHash: hashSessionToken(token),
      username,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    }
    try {
      await store.createSession(session)
      return { token, session }
    } catch (error) {
      if (!(error instanceof SessionCollisionError) || attempt === 2) throw error
    }
  }
  throw new Error('Could not create a unique session token.')
}

export async function authenticate(
  store: DataStore,
  authorization: string | undefined,
  now: Date,
): Promise<{ user: UserRecord; session: SessionRecord }> {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? '')
  if (!match) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.')
  const tokenHash = hashSessionToken(match[1] as string)
  const session = await store.getSession(tokenHash)
  if (!session) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.')
  if (Date.parse(session.expiresAt) <= now.getTime()) {
    await store.deleteSession(tokenHash)
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.')
  }
  const user = await store.getUser(session.username)
  if (!user) {
    await store.deleteSession(tokenHash)
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.')
  }
  return { user, session }
}

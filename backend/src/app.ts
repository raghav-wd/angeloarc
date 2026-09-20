import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import Fastify from 'fastify'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { authenticate, hashPassword, issueSession, validatePassword, verifyPassword } from './auth.js'
import { ApiError, UsernameTakenError } from './errors.js'
import { MemoryStore } from './memory-store.js'
import type { DataStore } from './store.js'
import {
  clearDemoProgress,
  hasExactFields,
  monthStats,
  parseMonth,
  resolveHabitPlan,
  trackerSearchSummary,
  validateTracker,
} from './tracker.js'
import { publicAccount } from './types.js'
import type { UserRecord } from './types.js'
import { normalizeSearchQuery, normalizeUsername } from './username.js'

const BODY_LIMIT_BYTES = 800 * 1024
const SEARCH_LIMIT = 20

interface BuildAppOptions {
  store?: DataStore
  allowedOrigins?: readonly string[]
  now?: () => Date
  logger?: boolean
  logLevel?: string
  rateLimitEnabled?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireBody(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!isRecord(value) || !hasExactFields(value, fields)) {
    throw new ApiError(400, 'INVALID_REQUEST', `Request body must contain exactly ${fields.join(', ')}.`)
  }
  return value
}

function notFound(): ApiError {
  return new ApiError(404, 'PROFILE_NOT_FOUND', 'Public profile was not found.')
}

function loginCandidate(body: unknown): { username: string | null; password: string; shapeValid: boolean } {
  const shapeValid = isRecord(body) && hasExactFields(body, ['username', 'password'])
  const usernameValue = isRecord(body) ? body.username : undefined
  const passwordValue = isRecord(body) ? body.password : undefined
  let username: string | null = null
  try {
    username = normalizeUsername(usernameValue)
  } catch {
    // Login intentionally does not reveal whether a username is malformed or absent.
  }
  return {
    username,
    password: typeof passwordValue === 'string' ? passwordValue : '',
    shapeValid,
  }
}

async function authenticatedUser(
  store: DataStore,
  request: FastifyRequest,
  now: () => Date,
): Promise<{ user: UserRecord; tokenHash: string }> {
  const authenticated = await authenticate(store, request.headers.authorization, now())
  return { user: authenticated.user, tokenHash: authenticated.session.tokenHash }
}

function authPayload(user: UserRecord, token?: string) {
  return {
    ...(token ? { token } : {}),
    account: publicAccount(user),
    tracker: user.tracker,
  }
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const store = options.store ?? new MemoryStore()
  const allowedOrigins = new Set(options.allowedOrigins ?? [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ])
  const now = options.now ?? (() => new Date())

  const app = Fastify({
    bodyLimit: BODY_LIMIT_BYTES,
    // Cloud Run appends the caller address at the right edge of X-Forwarded-For.
    // Trust only the directly connected platform proxy so caller-supplied values
    // farther to the left cannot choose request.ip and bypass rate limits.
    trustProxy: (_address, hop) => hop === 0,
    logger: options.logger
      ? {
          level: options.logLevel ?? 'info',
          redact: {
            paths: [
              'req.headers.authorization',
              'req.body.password',
              'password',
              'passwordHash',
              'passwordSalt',
              'token',
            ],
            censor: '[REDACTED]',
          },
        }
      : false,
  })

  await app.register(cors, {
    origin(origin, callback) {
      callback(null, origin === undefined || allowedOrigins.has(origin))
    },
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  })
  await app.register(helmet, {
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
  if (options.rateLimitEnabled !== false) {
    await app.register(rateLimit, {
      global: true,
      max: 120,
      timeWindow: '1 minute',
    })
  }

  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/v1/auth') || request.url.startsWith('/v1/me')) {
      reply.header('cache-control', 'no-store')
    }
  })

  const health = async () => ({ status: 'ok' })
  const healthOptions = { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }
  app.get('/health', healthOptions, health)
  app.get('/healthz', healthOptions, health)

  app.post(
    '/v1/auth/signup',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = requireBody(request.body, ['username', 'password', 'tracker'])
      const username = normalizeUsername(body.username)
      const password = validatePassword(body.password)
      const requestTime = now()
      const tracker = clearDemoProgress(validateTracker(body.tracker), requestTime)
      const passwordCredentials = await hashPassword(password)
      const timestamp = requestTime.toISOString()
      const user: UserRecord = {
        username,
        ...passwordCredentials,
        isPublic: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        tracker,
        searchSummary: trackerSearchSummary(tracker),
      }
      try {
        await store.createUser(user)
      } catch (error) {
        if (error instanceof UsernameTakenError) {
          throw new ApiError(409, 'USERNAME_TAKEN', 'That username is already registered.')
        }
        throw error
      }
      const { token } = await issueSession(store, username, now())
      reply.code(201)
      return authPayload(user, token)
    },
  )

  app.post(
    '/v1/auth/login',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      const candidate = loginCandidate(request.body)
      const user = candidate.username ? await store.getUser(candidate.username) : null
      const passwordMatches = await verifyPassword(candidate.password, user)
      if (!candidate.shapeValid || !user || !passwordMatches) {
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.')
      }
      const { token } = await issueSession(store, user.username, now())
      return authPayload(user, token)
    },
  )

  app.get('/v1/auth/me', async (request) => {
    const { user } = await authenticatedUser(store, request, now)
    return authPayload(user)
  })

  app.post('/v1/auth/logout', async (request) => {
    const { tokenHash } = await authenticatedUser(store, request, now)
    await store.deleteSession(tokenHash)
    return { ok: true }
  })

  app.put('/v1/me/tracker', async (request) => {
    const { user } = await authenticatedUser(store, request, now)
    const body = requireBody(request.body, ['tracker'])
    const tracker = validateTracker(body.tracker)
    const updatedAt = now().toISOString()
    await store.updateTracker(user.username, tracker, updatedAt)
    return { updatedAt }
  })

  app.patch('/v1/me/profile', async (request) => {
    const { user } = await authenticatedUser(store, request, now)
    const body = requireBody(request.body, ['isPublic'])
    if (typeof body.isPublic !== 'boolean') {
      throw new ApiError(400, 'INVALID_REQUEST', 'isPublic must be a boolean.')
    }
    const updated = await store.updateVisibility(user.username, body.isPublic, now().toISOString())
    if (!updated) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required.')
    return { account: publicAccount(updated) }
  })

  app.get(
    '/v1/profiles',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const queryObject = isRecord(request.query) ? request.query : {}
      const query = normalizeSearchQuery(queryObject.query)
      const users = await store.searchPublicProfiles(query, SEARCH_LIMIT)
      // Avoid serving stale listings after a user makes their profile private.
      reply.header('cache-control', 'no-store')
      return {
        profiles: users,
      }
    },
  )

  app.get(
    '/v1/profiles/:username',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const params = request.params as { username?: unknown }
      let username: string
      try {
        username = normalizeUsername(params.username)
      } catch {
        throw notFound()
      }
      const queryObject = isRecord(request.query) ? request.query : {}
      const month = parseMonth(queryObject.month)
      const user = await store.getUser(username)
      if (!user?.isPublic) throw notFound()
      const habits = resolveHabitPlan(user.tracker, month)
      // Public profiles may become private at any time; do not retain a copy.
      reply.header('cache-control', 'no-store')
      return {
        profile: {
          username: user.username,
          title: user.tracker.title,
          habits: habits.map((habit) => habit.name),
          month: month.key,
          stats: monthStats(user.tracker, month),
          joinedAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      }
    },
  )

  app.setNotFoundHandler(async () => {
    throw new ApiError(404, 'NOT_FOUND', 'Route was not found.')
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      void reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } })
      return
    }

    const statusCode = isRecord(error) && typeof error.statusCode === 'number'
      ? error.statusCode
      : 500
    if (statusCode === 413) {
      void reply.code(413).send({
        error: { code: 'REQUEST_TOO_LARGE', message: 'Request body is too large.' },
      })
      return
    }
    if (statusCode === 429) {
      void reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
      })
      return
    }
    if (statusCode >= 400 && statusCode < 500) {
      void reply.code(statusCode).send({
        error: { code: 'INVALID_REQUEST', message: 'The request could not be processed.' },
      })
      return
    }

    request.log.error({ err: error }, 'Unhandled API error')
    void reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
    })
  })

  app.addHook('onClose', async () => {
    await store.close()
  })

  return app
}

export type { BuildAppOptions }

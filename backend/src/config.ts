import { ApiError } from './errors.js'

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production'
  port: number
  host: string
  dataStore: 'memory' | 'firestore'
  allowedOrigins: string[]
  logLevel: string
  projectId?: string
  databaseId?: string
}

function parseNodeEnv(value: string | undefined): AppConfig['nodeEnv'] {
  if (value === undefined || value === 'development') return 'development'
  if (value === 'production' || value === 'test') return value
  throw new ApiError(
    500,
    'INVALID_CONFIGURATION',
    'NODE_ENV must be development, test, or production.',
  )
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? '8080')
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ApiError(500, 'INVALID_CONFIGURATION', 'PORT must be an integer from 1 to 65535.')
  }
  return port
}

function parseOrigins(value: string | undefined, nodeEnv: AppConfig['nodeEnv']): string[] {
  const origins = (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  const hasInvalidOrigin = origins.some((origin) => {
    try {
      const url = new URL(origin)
      return (url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== origin
    } catch {
      return true
    }
  })
  if (hasInvalidOrigin) {
    throw new ApiError(
      500,
      'INVALID_CONFIGURATION',
      'ALLOWED_ORIGINS must contain exact HTTP(S) origins without paths or wildcards.',
    )
  }
  if (origins.length > 0) return [...new Set(origins)]
  if (nodeEnv === 'production') {
    throw new ApiError(500, 'INVALID_CONFIGURATION', 'ALLOWED_ORIGINS is required in production.')
  }
  return ['http://localhost:5173', 'http://127.0.0.1:5173']
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = parseNodeEnv(environment.NODE_ENV)
  const dataStoreValue = environment.DATA_STORE ?? (nodeEnv === 'production' ? 'firestore' : 'memory')
  if (dataStoreValue !== 'memory' && dataStoreValue !== 'firestore') {
    throw new ApiError(500, 'INVALID_CONFIGURATION', 'DATA_STORE must be memory or firestore.')
  }
  if (nodeEnv === 'production' && dataStoreValue !== 'firestore') {
    throw new ApiError(500, 'INVALID_CONFIGURATION', 'Production must use the firestore data store.')
  }

  const config: AppConfig = {
    nodeEnv,
    port: parsePort(environment.PORT),
    host: '0.0.0.0',
    dataStore: dataStoreValue,
    allowedOrigins: parseOrigins(environment.ALLOWED_ORIGINS, nodeEnv),
    logLevel: environment.LOG_LEVEL ?? 'info',
  }
  if (environment.GOOGLE_CLOUD_PROJECT) config.projectId = environment.GOOGLE_CLOUD_PROJECT
  if (environment.FIRESTORE_DATABASE_ID) config.databaseId = environment.FIRESTORE_DATABASE_ID
  return config
}

import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { FirestoreStore } from './firestore-store.js'
import { MemoryStore } from './memory-store.js'
import type { DataStore } from './store.js'

async function main(): Promise<void> {
  const config = loadConfig()
  let store: DataStore
  if (config.dataStore === 'firestore') {
    store = new FirestoreStore({
      ...(config.projectId ? { projectId: config.projectId } : {}),
      ...(config.databaseId ? { databaseId: config.databaseId } : {}),
    })
  } else {
    store = new MemoryStore()
  }

  const app = await buildApp({
    store,
    allowedOrigins: config.allowedOrigins,
    logger: true,
    logLevel: config.logLevel,
  })

  let closing = false
  const shutdown = async (signal: string) => {
    if (closing) return
    closing = true
    app.log.info({ signal }, 'Shutting down')
    try {
      await app.close()
      process.exitCode = 0
    } catch (error) {
      app.log.error({ err: error }, 'Graceful shutdown failed')
      process.exitCode = 1
    }
  }
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  process.once('SIGINT', () => void shutdown('SIGINT'))

  await app.listen({ host: config.host, port: config.port })
}

main().catch((error: unknown) => {
  console.error('ANGELO backend failed to start:', error)
  process.exitCode = 1
})

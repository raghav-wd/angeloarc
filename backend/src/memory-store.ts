import { SessionCollisionError, UsernameTakenError } from './errors.js'
import type { DataStore } from './store.js'
import type { ProfileSummaryRecord, SessionRecord, TrackerState, UserRecord } from './types.js'

function clone<T>(value: T): T {
  return structuredClone(value)
}

export class MemoryStore implements DataStore {
  readonly #users = new Map<string, UserRecord>()
  readonly #sessions = new Map<string, SessionRecord>()

  async createUser(user: UserRecord): Promise<void> {
    if (this.#users.has(user.username)) throw new UsernameTakenError()
    this.#users.set(user.username, clone(user))
  }

  async getUser(username: string): Promise<UserRecord | null> {
    const user = this.#users.get(username)
    return user ? clone(user) : null
  }

  async updateTracker(username: string, tracker: TrackerState, updatedAt: string): Promise<void> {
    const user = this.#users.get(username)
    if (!user) return
    this.#users.set(username, { ...user, tracker: clone(tracker), updatedAt })
  }

  async updateVisibility(
    username: string,
    isPublic: boolean,
    updatedAt: string,
  ): Promise<UserRecord | null> {
    const user = this.#users.get(username)
    if (!user) return null
    const updated = { ...user, isPublic, updatedAt }
    this.#users.set(username, updated)
    return clone(updated)
  }

  async createSession(session: SessionRecord): Promise<void> {
    if (this.#sessions.has(session.tokenHash)) throw new SessionCollisionError()
    this.#sessions.set(session.tokenHash, clone(session))
  }

  async getSession(tokenHash: string): Promise<SessionRecord | null> {
    const session = this.#sessions.get(tokenHash)
    return session ? clone(session) : null
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.#sessions.delete(tokenHash)
  }

  async searchPublicProfiles(prefix: string, limit: number): Promise<ProfileSummaryRecord[]> {
    return [...this.#users.values()]
      .filter((user) => user.isPublic && user.username.startsWith(prefix))
      .sort((left, right) => left.username.localeCompare(right.username))
      .slice(0, limit)
      .map((user) => ({
        username: user.username,
        title: user.tracker.title,
        habitCount: user.tracker.habits.length,
        updatedAt: user.updatedAt,
      }))
  }

  async close(): Promise<void> {
    // The in-memory implementation has no external resources.
  }
}

import { SessionCollisionError, UsernameTakenError } from './errors.js'
import type { DataStore } from './store.js'
import type { ProfileSummaryRecord, SessionRecord, TrackerState, UserRecord } from './types.js'
import { trackerSearchSummary } from './tracker.js'

function clone<T>(value: T): T {
  return structuredClone(value)
}

export class MemoryStore implements DataStore {
  readonly #users = new Map<string, UserRecord>()
  readonly #sessions = new Map<string, SessionRecord>()
  readonly #following = new Map<string, Map<string, string>>()

  async createUser(user: UserRecord): Promise<void> {
    if (this.#users.has(user.username)) throw new UsernameTakenError()
    this.#users.set(user.username, clone({
      ...user,
      searchSummary: trackerSearchSummary(user.tracker),
    }))
  }

  async getUser(username: string): Promise<UserRecord | null> {
    const user = this.#users.get(username)
    return user ? clone(user) : null
  }

  async updateTracker(username: string, tracker: TrackerState, updatedAt: string): Promise<void> {
    const user = this.#users.get(username)
    if (!user) return
    this.#users.set(username, {
      ...user,
      tracker: clone(tracker),
      searchSummary: trackerSearchSummary(tracker),
      updatedAt,
    })
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
        title: user.searchSummary.title,
        habitCount: user.searchSummary.habitCount,
        updatedAt: user.updatedAt,
      }))
  }

  async followUser(
    followerUsername: string,
    followedUsername: string,
    createdAt: string,
  ): Promise<boolean> {
    const following = this.#following.get(followerUsername) ?? new Map<string, string>()
    if (following.has(followedUsername)) return false
    following.set(followedUsername, createdAt)
    this.#following.set(followerUsername, following)
    return true
  }

  async unfollowUser(followerUsername: string, followedUsername: string): Promise<boolean> {
    const following = this.#following.get(followerUsername)
    if (!following) return false
    return following.delete(followedUsername)
  }

  async isFollowing(followerUsername: string, followedUsername: string): Promise<boolean> {
    return this.#following.get(followerUsername)?.has(followedUsername) ?? false
  }

  async listFollowingUsernames(username: string, limit: number): Promise<string[]> {
    return [...(this.#following.get(username)?.entries() ?? [])]
      .sort((left, right) => right[1].localeCompare(left[1]) || left[0].localeCompare(right[0]))
      .slice(0, limit)
      .map(([followedUsername]) => followedUsername)
  }

  async countFollowers(username: string): Promise<number> {
    let count = 0
    for (const following of this.#following.values()) {
      if (following.has(username)) count += 1
    }
    return count
  }

  async countFollowing(username: string): Promise<number> {
    return this.#following.get(username)?.size ?? 0
  }

  async close(): Promise<void> {
    // The in-memory implementation has no external resources.
  }
}

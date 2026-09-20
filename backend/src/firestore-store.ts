import { Firestore, Timestamp } from '@google-cloud/firestore'
import { SessionCollisionError, UsernameTakenError } from './errors.js'
import type { DataStore } from './store.js'
import { trackerSearchSummary, validateTracker } from './tracker.js'
import type {
  ProfileSummaryRecord,
  SearchSummary,
  SessionRecord,
  TrackerState,
  UserRecord,
} from './types.js'

interface FirestoreStoreOptions {
  projectId?: string
  databaseId?: string
}

function timestamp(value: string): Timestamp {
  return Timestamp.fromDate(new Date(value))
}

function isoString(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString()
  }
  throw new Error('Firestore record contains an invalid timestamp.')
}

function userFromData(data: Record<string, unknown>): UserRecord {
  const tracker = validateTracker(data.tracker)
  return {
    username: data.username as string,
    passwordHash: data.passwordHash as string,
    passwordSalt: data.passwordSalt as string,
    isPublic: data.isPublic as boolean,
    createdAt: isoString(data.createdAt),
    updatedAt: isoString(data.updatedAt),
    tracker,
    searchSummary: searchSummaryFromData(data.searchSummary) ?? trackerSearchSummary(tracker),
  }
}

function sessionFromData(data: Record<string, unknown>, tokenHash: string): SessionRecord {
  return {
    tokenHash,
    username: data.username as string,
    createdAt: isoString(data.createdAt),
    expiresAt: isoString(data.expiresAt),
  }
}

function searchSummaryFromData(value: unknown): SearchSummary | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const summary = value as Record<string, unknown>
  if (typeof summary.title !== 'string'
    || typeof summary.habitCount !== 'number'
    || !Number.isInteger(summary.habitCount)
    || summary.habitCount < 0
    || summary.habitCount > 9) {
    return null
  }
  return { title: summary.title, habitCount: summary.habitCount }
}

function profileSummaryFromData(data: Record<string, unknown>): ProfileSummaryRecord {
  if (typeof data.username !== 'string') {
    throw new Error('Firestore profile summary contains invalid fields.')
  }
  let summary = searchSummaryFromData(data.searchSummary)
  if (!summary) {
    const tracker = data.tracker
    if (typeof tracker !== 'object' || tracker === null || Array.isArray(tracker)) {
      throw new Error('Firestore profile summary is missing.')
    }
    const legacyTitle = (tracker as Record<string, unknown>).title
    const legacyHabits = (tracker as Record<string, unknown>).habits
    if (typeof legacyTitle !== 'string' || !Array.isArray(legacyHabits)) {
      throw new Error('Firestore profile summary contains invalid legacy fields.')
    }
    summary = { title: legacyTitle, habitCount: legacyHabits.length }
  }
  return {
    username: data.username,
    ...summary,
    updatedAt: isoString(data.updatedAt),
  }
}

function firestoreCode(error: unknown): number | string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return (error as { code?: number | string }).code
}

export class FirestoreStore implements DataStore {
  readonly #firestore: Firestore
  readonly #users
  readonly #sessions

  constructor(options: FirestoreStoreOptions = {}) {
    const settings: ConstructorParameters<typeof Firestore>[0] = {}
    if (options.projectId) settings.projectId = options.projectId
    if (options.databaseId) settings.databaseId = options.databaseId
    this.#firestore = new Firestore(settings)
    this.#users = this.#firestore.collection('users')
    this.#sessions = this.#firestore.collection('sessions')
  }

  async createUser(user: UserRecord): Promise<void> {
    try {
      await this.#users.doc(user.username).create({
        ...user,
        searchSummary: trackerSearchSummary(user.tracker),
        createdAt: timestamp(user.createdAt),
        updatedAt: timestamp(user.updatedAt),
      })
    } catch (error) {
      if (firestoreCode(error) === 6 || firestoreCode(error) === '6' || firestoreCode(error) === 'ALREADY_EXISTS') {
        throw new UsernameTakenError()
      }
      throw error
    }
  }

  async getUser(username: string): Promise<UserRecord | null> {
    const snapshot = await this.#users.doc(username).get()
    if (!snapshot.exists) return null
    return userFromData(snapshot.data() as Record<string, unknown>)
  }

  async updateTracker(username: string, tracker: TrackerState, updatedAt: string): Promise<void> {
    await this.#users.doc(username).update({
      tracker,
      searchSummary: trackerSearchSummary(tracker),
      updatedAt: timestamp(updatedAt),
    })
  }

  async updateVisibility(
    username: string,
    isPublic: boolean,
    updatedAt: string,
  ): Promise<UserRecord | null> {
    const reference = this.#users.doc(username)
    await reference.update({ isPublic, updatedAt: timestamp(updatedAt) })
    const snapshot = await reference.get()
    if (!snapshot.exists) return null
    return userFromData(snapshot.data() as Record<string, unknown>)
  }

  async createSession(session: SessionRecord): Promise<void> {
    try {
      await this.#sessions.doc(session.tokenHash).create({
        username: session.username,
        createdAt: timestamp(session.createdAt),
        expiresAt: timestamp(session.expiresAt),
      })
    } catch (error) {
      if (firestoreCode(error) === 6 || firestoreCode(error) === '6' || firestoreCode(error) === 'ALREADY_EXISTS') {
        throw new SessionCollisionError()
      }
      throw error
    }
  }

  async getSession(tokenHash: string): Promise<SessionRecord | null> {
    const snapshot = await this.#sessions.doc(tokenHash).get()
    if (!snapshot.exists) return null
    return sessionFromData(snapshot.data() as Record<string, unknown>, tokenHash)
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.#sessions.doc(tokenHash).delete()
  }

  async searchPublicProfiles(prefix: string, limit: number): Promise<ProfileSummaryRecord[]> {
    const snapshot = await this.#users
      .where('isPublic', '==', true)
      .orderBy('username')
      .startAt(prefix)
      .endAt(`${prefix}\uf8ff`)
      .limit(limit)
      .select('username', 'searchSummary', 'tracker.title', 'tracker.habits', 'updatedAt')
      .get()
    return snapshot.docs.map((document) => profileSummaryFromData(document.data()))
  }

  async close(): Promise<void> {
    await this.#firestore.terminate()
  }
}

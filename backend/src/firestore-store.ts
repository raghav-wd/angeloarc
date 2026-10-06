import { Firestore, Timestamp } from '@google-cloud/firestore'
import { NotesConflictError, SessionCollisionError, UsernameTakenError } from './errors.js'
import { validateNotesState } from './notes.js'
import type { DataStore } from './store.js'
import { trackerSearchSummary, validateTracker } from './tracker.js'
import type {
  NotesRecord,
  NotesState,
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

function notesRecordFromData(data: Record<string, unknown>): NotesRecord {
  const revision = data.revision === undefined ? 1 : data.revision
  if (!Number.isSafeInteger(revision) || (revision as number) < 1) {
    throw new Error('Firestore notes record contains an invalid revision.')
  }
  return {
    notes: validateNotesState(data.notes),
    revision: revision as number,
  }
}

export class FirestoreStore implements DataStore {
  readonly #firestore: Firestore
  readonly #users
  readonly #notes
  readonly #sessions

  constructor(options: FirestoreStoreOptions = {}) {
    const settings: ConstructorParameters<typeof Firestore>[0] = {}
    if (options.projectId) settings.projectId = options.projectId
    if (options.databaseId) settings.databaseId = options.databaseId
    this.#firestore = new Firestore(settings)
    this.#users = this.#firestore.collection('users')
    this.#notes = this.#firestore.collection('userNotes')
    this.#sessions = this.#firestore.collection('sessions')
  }

  async createUser(user: UserRecord, notes?: NotesState): Promise<void> {
    try {
      const userData = {
        ...user,
        searchSummary: trackerSearchSummary(user.tracker),
        createdAt: timestamp(user.createdAt),
        updatedAt: timestamp(user.updatedAt),
      }
      if (notes) {
        const batch = this.#firestore.batch()
        batch.create(this.#users.doc(user.username), userData)
        batch.create(this.#notes.doc(user.username), {
          notes,
          revision: 1,
          updatedAt: timestamp(user.updatedAt),
        })
        await batch.commit()
      } else {
        await this.#users.doc(user.username).create(userData)
      }
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

  async getNotes(username: string): Promise<NotesRecord | null> {
    const snapshot = await this.#notes.doc(username).get()
    if (!snapshot.exists) return null
    return notesRecordFromData(snapshot.data() as Record<string, unknown>)
  }

  async updateNotes(
    username: string,
    notes: NotesState,
    expectedRevision: number,
    updatedAt: string,
  ): Promise<number> {
    const reference = this.#notes.doc(username)
    return this.#firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      const currentRevision = snapshot.exists
        ? notesRecordFromData(snapshot.data() as Record<string, unknown>).revision
        : 0
      if (currentRevision !== expectedRevision) throw new NotesConflictError()
      const revision = currentRevision + 1
      transaction.set(reference, {
        notes,
        revision,
        updatedAt: timestamp(updatedAt),
      })
      return revision
    })
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

  async followUser(
    followerUsername: string,
    followedUsername: string,
    createdAt: string,
  ): Promise<boolean> {
    const reference = this.#users.doc(followerUsername).collection('following').doc(followedUsername)
    try {
      await reference.create({ followedUsername, createdAt: timestamp(createdAt) })
      return true
    } catch (error) {
      if (firestoreCode(error) === 6 || firestoreCode(error) === '6' || firestoreCode(error) === 'ALREADY_EXISTS') {
        return false
      }
      throw error
    }
  }

  async unfollowUser(followerUsername: string, followedUsername: string): Promise<boolean> {
    const reference = this.#users.doc(followerUsername).collection('following').doc(followedUsername)
    const snapshot = await reference.get()
    if (!snapshot.exists) return false
    await reference.delete()
    return true
  }

  async isFollowing(followerUsername: string, followedUsername: string): Promise<boolean> {
    const snapshot = await this.#users.doc(followerUsername).collection('following').doc(followedUsername).get()
    return snapshot.exists
  }

  async listFollowingUsernames(username: string, limit: number): Promise<string[]> {
    const snapshot = await this.#users
      .doc(username)
      .collection('following')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get()
    return snapshot.docs.map((document) => document.id)
  }

  async countFollowers(username: string): Promise<number> {
    const snapshot = await this.#firestore
      .collectionGroup('following')
      .where('followedUsername', '==', username)
      .count()
      .get()
    return snapshot.data().count
  }

  async countFollowing(username: string): Promise<number> {
    const snapshot = await this.#users.doc(username).collection('following').count().get()
    return snapshot.data().count
  }

  async close(): Promise<void> {
    await this.#firestore.terminate()
  }
}

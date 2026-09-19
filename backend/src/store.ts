import type { ProfileSummaryRecord, SessionRecord, TrackerState, UserRecord } from './types.js'

export interface DataStore {
  createUser(user: UserRecord): Promise<void>
  getUser(username: string): Promise<UserRecord | null>
  updateTracker(username: string, tracker: TrackerState, updatedAt: string): Promise<void>
  updateVisibility(username: string, isPublic: boolean, updatedAt: string): Promise<UserRecord | null>
  createSession(session: SessionRecord): Promise<void>
  getSession(tokenHash: string): Promise<SessionRecord | null>
  deleteSession(tokenHash: string): Promise<void>
  searchPublicProfiles(prefix: string, limit: number): Promise<ProfileSummaryRecord[]>
  close(): Promise<void>
}

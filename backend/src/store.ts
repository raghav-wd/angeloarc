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
  followUser(followerUsername: string, followedUsername: string, createdAt: string): Promise<boolean>
  unfollowUser(followerUsername: string, followedUsername: string): Promise<boolean>
  isFollowing(followerUsername: string, followedUsername: string): Promise<boolean>
  listFollowingUsernames(username: string, limit: number): Promise<string[]>
  countFollowers(username: string): Promise<number>
  countFollowing(username: string): Promise<number>
  close(): Promise<void>
}

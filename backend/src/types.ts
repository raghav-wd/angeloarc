export interface LegacyHabit {
  id: string
  name: string
}

export interface LegacyTrackerState {
  version: 1
  title: string
  habits: LegacyHabit[]
  completions: Record<string, string[]>
  isDemo: boolean
}

export interface MonthHabit {
  id: string
  name: string
  startedOn: string
}

export interface TrackerState {
  version: 2
  title: string
  startedOn: string
  habitPlans: Record<string, MonthHabit[]>
  completions: Record<string, string[]>
  isDemo: boolean
}

export interface SearchSummary {
  title: string
  habitCount: number
}

export interface UserRecord {
  username: string
  passwordHash: string
  passwordSalt: string
  isPublic: boolean
  createdAt: string
  updatedAt: string
  tracker: TrackerState
  searchSummary: SearchSummary
}

export interface SessionRecord {
  tokenHash: string
  username: string
  createdAt: string
  expiresAt: string
}

export interface PublicAccount {
  username: string
  isPublic: boolean
  createdAt: string
}

export interface ProfileSummaryRecord {
  username: string
  title: string
  habitCount: number
  updatedAt: string
}

export function publicAccount(user: UserRecord): PublicAccount {
  return {
    username: user.username,
    isPublic: user.isPublic,
    createdAt: user.createdAt,
  }
}

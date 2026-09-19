export interface Habit {
  id: string
  name: string
}

export interface TrackerState {
  version: 1
  title: string
  habits: Habit[]
  completions: Record<string, string[]>
  isDemo: boolean
}

export interface UserRecord {
  username: string
  passwordHash: string
  passwordSalt: string
  isPublic: boolean
  createdAt: string
  updatedAt: string
  tracker: TrackerState
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

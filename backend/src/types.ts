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
  reminders: string[]
  isDemo: boolean
}

export interface SearchSummary {
  title: string
  habitCount: number
}

export const PAPER_NOTE_KINDS = ['principle', 'goal', 'quote', 'note'] as const

export type PaperNoteKind = (typeof PAPER_NOTE_KINDS)[number]

export interface PaperNote {
  id: string
  kind: PaperNoteKind
  title: string
  body: string
  createdAt: string
  updatedAt: string
}

export interface NotesState {
  version: 1
  dailyNotes: Record<string, string>
  paperNotes: PaperNote[]
}

export interface NotesRecord {
  notes: NotesState
  revision: number
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

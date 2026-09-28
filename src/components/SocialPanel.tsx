import { useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  ArrowRight,
  Check,
  LoaderCircle,
  Plus,
  Search,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react'
import { ApiError, searchProfiles } from '../lib/api'
import type {
  Account,
  FollowResponse,
  ProfileSearchResponse,
  ProfileSummary,
  PublicProfile,
  PublicProfileResponse,
} from '../lib/api'

interface SocialPanelProps {
  account: Account | null
  onClose: () => void
  onOpenAccount: () => void
  onLoadProfile: (username: string, month: string, signal?: AbortSignal) => Promise<PublicProfileResponse>
  onLoadFollowing: (signal?: AbortSignal) => Promise<ProfileSearchResponse>
  onFollow: (username: string, signal?: AbortSignal) => Promise<FollowResponse>
  onUnfollow: (username: string, signal?: AbortSignal) => Promise<FollowResponse>
  onViewProfile: (profile: PublicProfile) => void
  onRelationshipChange: (username: string, following: boolean, followerCount: number) => void
}

function friendlyError(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message
  if (error instanceof Error && error.message) return error.message
  return fallback
}

function currentLocalMonth(): string {
  const now = new Date()
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function SocialPanel({
  account,
  onClose,
  onOpenAccount,
  onLoadProfile,
  onLoadFollowing,
  onFollow,
  onUnfollow,
  onViewProfile,
  onRelationshipChange,
}: SocialPanelProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProfileSummary[]>([])
  const [following, setFollowing] = useState<ProfileSummary[]>([])
  const [relationships, setRelationships] = useState<Set<string>>(() => new Set())
  const [searching, setSearching] = useState(false)
  const [followingLoading, setFollowingLoading] = useState(Boolean(account))
  const [profileOpening, setProfileOpening] = useState('')
  const [relationshipBusy, setRelationshipBusy] = useState('')
  const [message, setMessage] = useState('')
  const root = useRef<HTMLElement>(null)
  const profileController = useRef<AbortController | null>(null)
  const close = useEffectEvent(onClose)

  useEffect(() => {
    const previousFocus = document.activeElement
    root.current?.querySelector<HTMLInputElement>('.profile-search input')?.focus({ preventScroll: true })
    function keyboard(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    }
    document.addEventListener('keydown', keyboard)
    return () => {
      document.removeEventListener('keydown', keyboard)
      profileController.current?.abort()
      if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    if (!account) return
    const controller = new AbortController()
    void onLoadFollowing(controller.signal)
      .then((response) => {
        setFollowing(response.profiles)
        setRelationships(new Set(response.profiles.map((profile) => profile.username)))
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof Error && requestError.name === 'AbortError') return
        setMessage(friendlyError(requestError, 'Your circle could not be loaded right now.'))
      })
      .finally(() => {
        if (!controller.signal.aborted) setFollowingLoading(false)
      })
    return () => controller.abort()
  }, [account, onLoadFollowing])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) return
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      setSearching(true)
      setMessage('')
      void searchProfiles(trimmed, controller.signal)
        .then((response) => setResults(response.profiles))
        .catch((requestError: unknown) => {
          if (requestError instanceof Error && requestError.name === 'AbortError') return
          setResults([])
          setMessage(friendlyError(requestError, 'Profiles could not be searched right now.'))
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false)
        })
    }, 260)
    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [query])

  async function openProfile(username: string) {
    profileController.current?.abort()
    const controller = new AbortController()
    profileController.current = controller
    setProfileOpening(username)
    setMessage('')
    try {
      const response = await onLoadProfile(username, currentLocalMonth(), controller.signal)
      onViewProfile(response.profile)
      onClose()
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === 'AbortError') return
      setMessage(friendlyError(requestError, 'This practice could not be opened.'))
    } finally {
      if (!controller.signal.aborted) setProfileOpening('')
    }
  }

  async function toggleFollow(profile: ProfileSummary) {
    if (!account || profile.username === account.username || relationshipBusy) return
    const wasFollowing = relationships.has(profile.username)
    setRelationshipBusy(profile.username)
    setMessage('')
    try {
      const response = wasFollowing
        ? await onUnfollow(profile.username)
        : await onFollow(profile.username)
      setRelationships((current) => {
        const next = new Set(current)
        if (response.following) next.add(profile.username)
        else next.delete(profile.username)
        return next
      })
      setFollowing((current) => response.following
        ? current.some((item) => item.username === profile.username) ? current : [profile, ...current]
        : current.filter((item) => item.username !== profile.username))
      onRelationshipChange(profile.username, response.following, response.followerCount)
    } catch (requestError) {
      setMessage(friendlyError(requestError, 'That follow could not be updated.'))
    } finally {
      setRelationshipBusy('')
    }
  }

  const searchingNow = Boolean(query.trim())
  const profiles = searchingNow ? results : following
  const loading = searchingNow ? searching : followingLoading

  return (
    <section ref={root} className="social-panel people-panel" aria-labelledby="people-heading">
      <header className="social-header">
        <div>
          <p className="eyebrow"><span /> The Angelo Arc</p>
          <h2 id="people-heading">Your circle.</h2>
          <p>{account ? 'Open a practice you follow, or find someone new.' : 'Find a public practice and see how someone else shows up.'}</p>
        </div>
        <button className="icon-button social-close" aria-label="Close people panel" onClick={onClose}>
          <X size={19} strokeWidth={1.5} />
        </button>
      </header>

      <div className="people-toolbar">
        <label className="profile-search">
          <Search size={17} strokeWidth={1.4} aria-hidden="true" />
          <span className="sr-only">Search public profiles</span>
          <input
            autoComplete="off"
            value={query}
            maxLength={24}
            placeholder="Search any username..."
            onChange={(event) => {
              const next = event.target.value
              setQuery(next)
              setMessage('')
              if (!next.trim()) {
                setResults([])
                setSearching(false)
              }
            }}
          />
          {searching && <LoaderCircle className="social-spinner" size={16} aria-label="Searching" />}
        </label>
        <div className="people-list-label">
          <span>{searchingNow ? 'SEARCH RESULTS' : 'PEOPLE YOU FOLLOW'}</span>
          {!searchingNow && account && <strong>{String(following.length).padStart(2, '0')}</strong>}
        </div>
      </div>

      <div className="social-body people-body" data-scrollable>
        <section aria-live="polite" aria-busy={loading}>
          {message && <p className="social-error" role="alert">{message}</p>}

          {!account && !searchingNow && !message && (
            <div className="social-empty people-welcome">
              <UsersRound size={27} strokeWidth={1.1} />
              <p>Your following list lives here.</p>
              <span>Sign in to build a circle, or search above as a guest.</span>
              <button type="button" className="people-sign-in" onClick={onOpenAccount}>
                <UserRound size={14} /> Sign in
              </button>
            </div>
          )}

          {account && !searchingNow && !loading && profiles.length === 0 && !message && (
            <div className="social-empty people-welcome">
              <UsersRound size={27} strokeWidth={1.1} />
              <p>Your circle is ready for its first person.</p>
              <span>Search by username above, then tap Follow.</span>
            </div>
          )}

          {searchingNow && !loading && profiles.length === 0 && !message && (
            <div className="social-empty compact">
              <p>No public profiles found.</p>
              <span>Try another username.</span>
            </div>
          )}

          {loading && profiles.length === 0 && (
            <div className="profile-loading"><LoaderCircle className="social-spinner" size={20} /> Loading the circle...</div>
          )}

          <div className="people-list">
            {profiles.map((profile) => {
              const isSelf = profile.username === account?.username
              const isFollowing = relationships.has(profile.username)
              const isOpening = profileOpening === profile.username
              const isUpdating = relationshipBusy === profile.username
              return (
                <article className="people-row" key={profile.username}>
                  <button className="people-profile-button" type="button" onClick={() => void openProfile(profile.username)}>
                    <span className="profile-avatar" aria-hidden="true">{profile.username.slice(0, 1).toUpperCase()}</span>
                    <span className="profile-result-copy">
                      <strong>@{profile.username}</strong>
                      <small>{profile.title || 'A quiet daily practice'}</small>
                    </span>
                    <span className="profile-result-meta">
                      {profile.habitCount} {profile.habitCount === 1 ? 'habit' : 'habits'}
                      {isOpening ? <LoaderCircle className="social-spinner" size={14} /> : <ArrowRight size={14} strokeWidth={1.4} />}
                    </span>
                  </button>
                  {account && !isSelf && (
                    <button
                      type="button"
                      className={`follow-button ${isFollowing ? 'is-following' : ''}`}
                      disabled={Boolean(relationshipBusy)}
                      aria-label={`${isFollowing ? 'Unfollow' : 'Follow'} @${profile.username}`}
                      onClick={() => void toggleFollow(profile)}
                    >
                      {isUpdating
                        ? <LoaderCircle className="social-spinner" size={13} />
                        : isFollowing
                          ? <><Check size={13} /> Following</>
                          : <><Plus size={13} /> Follow</>}
                    </button>
                  )}
                  {isSelf && <span className="people-you-label">YOU</span>}
                </article>
              )
            })}
          </div>
        </section>
      </div>
    </section>
  )
}

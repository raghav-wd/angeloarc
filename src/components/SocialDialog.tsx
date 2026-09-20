import { useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Search,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react'
import {
  ApiError,
  getPasswordValidationError,
  getPublicProfile,
  getUsernameValidationError,
  normalizeUsername,
  searchProfiles,
} from '../lib/api'
import type { Account, ProfileSummary, PublicProfile } from '../lib/api'

type SocialPanel = 'discover' | 'login' | 'signup' | 'account' | 'profile'

interface SocialDialogProps {
  account: Account | null
  busy: boolean
  error: string
  syncLabel: string
  onClose: () => void
  onLogin: (username: string, password: string) => Promise<void>
  onSignup: (username: string, password: string) => Promise<void>
  onLogout: () => Promise<void>
  onVisibilityChange: (value: boolean) => Promise<void>
}

function friendlyError(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message
  if (error instanceof Error && error.message) return error.message
  return fallback
}

function displayDate(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Recently'
  return new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(date)
}

function monthLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) return value
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1))
  return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
}

function shiftMonth(value: string, delta: number): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) return null
  const offset = Number(match[1]) * 12 + Number(match[2]) - 1 + delta
  if (offset < 0 || offset > 9999 * 12 + 11) return null
  const year = Math.floor(offset / 12)
  const month = offset - year * 12 + 1
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

function currentLocalMonth(): string {
  const now = new Date()
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function SocialDialog({
  account,
  busy,
  error,
  syncLabel,
  onClose,
  onLogin,
  onSignup,
  onLogout,
  onVisibilityChange,
}: SocialDialogProps) {
  const [panel, setPanel] = useState<SocialPanel>('discover')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProfileSummary[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState('')
  const dialog = useRef<HTMLDivElement>(null)
  const close = useEffectEvent(onClose)
  const profileController = useRef<AbortController | null>(null)

  useEffect(() => {
    const previousFocus = document.activeElement
    dialog.current?.querySelector<HTMLButtonElement>('.social-close')?.focus({ preventScroll: true })

    function keyboard(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (event.key !== 'Tab') return
      const elements = dialog.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [href], [tabindex="0"]',
      )
      if (!elements?.length) return
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', keyboard)
    return () => {
      document.removeEventListener('keydown', keyboard)
      profileController.current?.abort()
      if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    if (panel !== 'discover') return
    const trimmed = query.trim()
    if (!trimmed) return

    const controller = new AbortController()
    const timeout = setTimeout(() => {
      setSearching(true)
      setSearchError('')
      void searchProfiles(trimmed, controller.signal)
        .then((response) => setResults(response.profiles))
        .catch((requestError: unknown) => {
          if (requestError instanceof Error && requestError.name === 'AbortError') return
          setResults([])
          setSearchError(friendlyError(requestError, 'Profiles could not be searched right now.'))
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false)
        })
    }, 300)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [panel, query])

  async function loadProfile(profileUsername: string, month?: string) {
    profileController.current?.abort()
    const controller = new AbortController()
    profileController.current = controller
    setPanel('profile')
    setProfileLoading(true)
    setProfileError('')
    try {
      const response = await getPublicProfile(
        profileUsername,
        month ?? currentLocalMonth(),
        controller.signal,
      )
      setProfile(response.profile)
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === 'AbortError') return
      setProfileError(friendlyError(requestError, 'This profile could not be opened.'))
    } finally {
      if (!controller.signal.aborted) setProfileLoading(false)
    }
  }

  function showAuth(next: 'login' | 'signup') {
    setPanel(next)
    setPassword('')
    setFormError('')
  }

  async function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = normalizeUsername(username)
    const usernameError = getUsernameValidationError(normalized)
    const passwordError = getPasswordValidationError(password)
    if (usernameError || passwordError) {
      setFormError(usernameError ?? passwordError ?? '')
      return
    }

    setFormError('')
    try {
      if (panel === 'signup') {
        await onSignup(normalized, password)
      } else {
        await onLogin(normalized, password)
      }
      setPassword('')
      setPanel('account')
    } catch {
      // The account hook supplies the server's safe error message.
    }
  }

  async function changeProfileMonth(delta: number) {
    if (!profile) return
    const next = shiftMonth(profile.month, delta)
    if (next) await loadProfile(profile.username, next)
  }

  const heading = panel === 'profile' && profile
    ? `@${profile.username}`
    : panel === 'account' && account
      ? `@${account.username}`
      : panel === 'signup'
        ? 'Join the circle.'
        : panel === 'login'
          ? 'Welcome back.'
          : 'Find your people.'

  return (
    <div
      className="modal-backdrop social-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialog}
        className="social-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="social-heading"
        aria-describedby="social-description"
      >
        <header className="social-header">
          <div>
            <p className="eyebrow"><span /> The Angelo Arc</p>
            <h2 id="social-heading">{heading}</h2>
            <p id="social-description">
              {panel === 'profile'
                ? 'A public glimpse at another daily practice.'
                : 'Share the practice, or keep going quietly as a guest.'}
            </p>
          </div>
          <button className="icon-button social-close" aria-label="Close social panel" onClick={onClose}>
            <X size={19} strokeWidth={1.5} />
          </button>
        </header>

        <nav className="social-tabs" aria-label="Social panel sections">
          <button
            type="button"
            className={panel === 'discover' || panel === 'profile' ? 'is-active' : ''}
            aria-current={panel === 'discover' || panel === 'profile' ? 'page' : undefined}
            onClick={() => setPanel('discover')}
          >
            <UsersRound size={14} strokeWidth={1.5} /> Discover
          </button>
          <button
            type="button"
            className={panel === 'account' || panel === 'login' || panel === 'signup' ? 'is-active' : ''}
            aria-current={panel === 'account' || panel === 'login' || panel === 'signup' ? 'page' : undefined}
            onClick={() => setPanel(account ? 'account' : 'login')}
          >
            <UserRound size={14} strokeWidth={1.5} /> {account ? `@${account.username}` : 'Sign in'}
          </button>
        </nav>

        <div className="social-body" data-scrollable>
          {panel === 'discover' && (
            <section className="social-discover" aria-labelledby="discover-heading">
              <div className="social-section-heading">
                <div>
                  <p className="social-kicker">PUBLIC PROFILES</p>
                  <h3 id="discover-heading">Search by username</h3>
                </div>
                {!account && <span>Guest access</span>}
              </div>
              <label className="profile-search">
                <Search size={17} strokeWidth={1.4} aria-hidden="true" />
                <span className="sr-only">Search public profiles</span>
                <input
                  autoComplete="off"
                  value={query}
                  maxLength={24}
                  placeholder="Try a username..."
                  onChange={(event) => {
                    const next = event.target.value
                    setQuery(next)
                    if (!next.trim()) {
                      setResults([])
                      setSearching(false)
                      setSearchError('')
                    }
                  }}
                />
                {searching && <LoaderCircle className="social-spinner" size={16} aria-label="Searching" />}
              </label>

              <div className="profile-results" aria-live="polite" aria-busy={searching}>
                {searchError && <p className="social-error" role="alert">{searchError}</p>}
                {!query.trim() && !searchError && (
                  <div className="social-empty">
                    <UsersRound size={25} strokeWidth={1.1} />
                    <p>Every public practice starts with a username.</p>
                    <span>Search for someone you know.</span>
                  </div>
                )}
                {query.trim() && !searching && !searchError && results.length === 0 && (
                  <div className="social-empty compact">
                    <p>No public profiles found.</p>
                    <span>Try another username.</span>
                  </div>
                )}
                {results.map((result) => (
                  <button
                    type="button"
                    className="profile-result"
                    key={result.username}
                    onClick={() => void loadProfile(result.username)}
                  >
                    <span className="profile-avatar" aria-hidden="true">{result.username.slice(0, 1).toUpperCase()}</span>
                    <span className="profile-result-copy">
                      <strong>@{result.username}</strong>
                      <small>{result.title || 'A quiet daily practice'}</small>
                    </span>
                    <span className="profile-result-meta">
                      {result.habitCount} {result.habitCount === 1 ? 'habit' : 'habits'}
                      <ArrowRight size={14} strokeWidth={1.4} aria-hidden="true" />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {(panel === 'login' || panel === 'signup') && (
            <section className="auth-section" aria-labelledby="auth-heading">
              <p className="social-kicker">{panel === 'signup' ? 'OPTIONAL ACCOUNT' : 'YOUR ACCOUNT'}</p>
              <h3 id="auth-heading">{panel === 'signup' ? 'Choose a name that is yours.' : 'Pick up where you left off.'}</h3>
              <p className="auth-intro">
                {panel === 'signup'
                  ? 'Your current routine comes with you. Sample check-ins are cleared, and your profile starts public.'
                  : 'Signing in loads your account routine. Your guest routine stays safely on this device.'}
              </p>
              <form className="auth-form" onSubmit={(event) => void submitAuth(event)}>
                <label>
                  <span>Username</span>
                  <div className="auth-input">
                    <span aria-hidden="true">@</span>
                    <input
                      autoFocus
                      autoCapitalize="none"
                      autoComplete="username"
                      spellCheck={false}
                      value={username}
                      minLength={3}
                      maxLength={24}
                      pattern="[A-Za-z0-9_]+"
                      required
                      onChange={(event) => {
                        setUsername(event.target.value)
                        setFormError('')
                      }}
                    />
                  </div>
                </label>
                <label>
                  <span>Password</span>
                  <div className="auth-input">
                    <LockKeyhole size={14} strokeWidth={1.4} aria-hidden="true" />
                    <input
                      type="password"
                      autoComplete={panel === 'signup' ? 'new-password' : 'current-password'}
                      value={password}
                      minLength={8}
                      maxLength={128}
                      required
                      onChange={(event) => {
                        setPassword(event.target.value)
                        setFormError('')
                      }}
                    />
                  </div>
                </label>
                {(formError || error) && <p className="social-error" role="alert">{formError || error}</p>}
                <button className="auth-submit" disabled={busy}>
                  {busy ? <LoaderCircle className="social-spinner" size={16} /> : <ArrowRight size={16} strokeWidth={1.5} />}
                  {panel === 'signup' ? 'Create my account' : 'Sign in'}
                </button>
              </form>
              <p className="auth-switch">
                {panel === 'signup' ? 'Already have a username?' : 'New to ANGELO?'}
                <button type="button" onClick={() => showAuth(panel === 'signup' ? 'login' : 'signup')}>
                  {panel === 'signup' ? 'Sign in' : 'Create an account'}
                </button>
              </p>
              <div className="public-note">
                <Eye size={15} strokeWidth={1.4} />
                <p><strong>Public by default.</strong> Your title, habits, and monthly stats can be found by username. You can switch this off anytime.</p>
              </div>
            </section>
          )}

          {panel === 'account' && account && (
            <section className="account-section" aria-labelledby="account-heading">
              <div className="account-identity">
                <span className="profile-avatar large" aria-hidden="true">{account.username.slice(0, 1).toUpperCase()}</span>
                <div>
                  <p className="social-kicker">SIGNED IN</p>
                  <h3 id="account-heading">@{account.username}</h3>
                  <span>Joined {displayDate(account.createdAt)} · {syncLabel}</span>
                </div>
                <Check size={18} strokeWidth={1.5} aria-label="Signed in" />
              </div>

              <div className="account-setting">
                <div>
                  {account.isPublic ? <Eye size={18} strokeWidth={1.4} /> : <EyeOff size={18} strokeWidth={1.4} />}
                  <span>
                    <strong>Public profile</strong>
                    <small>{account.isPublic ? 'People can find your practice.' : 'Your profile is hidden from search.'}</small>
                  </span>
                </div>
                <button
                  type="button"
                  className="toggle social-toggle"
                  role="switch"
                  aria-label="Make profile public"
                  aria-checked={account.isPublic}
                  disabled={busy}
                  onClick={() => {
                    void onVisibilityChange(!account.isPublic).catch(() => undefined)
                  }}
                ><span /></button>
              </div>

              {error && <p className="social-error" role="alert">{error}</p>}
              <div className="account-actions">
                <button type="button" onClick={() => setPanel('discover')}>
                  <Search size={15} strokeWidth={1.4} /> Find profiles
                </button>
                <button
                  type="button"
                  className="logout-button"
                  disabled={busy}
                  onClick={() => {
                    void onLogout().then(() => setPanel('discover'))
                  }}
                >
                  <LogOut size={15} strokeWidth={1.4} /> Sign out
                </button>
              </div>
              <p className="account-guest-note">Signing out returns to the guest routine saved on this device.</p>
            </section>
          )}

          {panel === 'profile' && (
            <section className="public-profile" aria-live="polite" aria-busy={profileLoading}>
              <button type="button" className="profile-back" onClick={() => setPanel('discover')}>
                <ArrowLeft size={14} strokeWidth={1.4} /> Back to search
              </button>
              {profileLoading && !profile && (
                <div className="profile-loading"><LoaderCircle className="social-spinner" size={20} /> Opening profile...</div>
              )}
              {profileError && <p className="social-error" role="alert">{profileError}</p>}
              {profile && (
                <>
                  <div className="public-profile-title">
                    <span className="profile-avatar large" aria-hidden="true">{profile.username.slice(0, 1).toUpperCase()}</span>
                    <div>
                      <p className="social-kicker">PUBLIC PRACTICE</p>
                      <h3>{profile.title || 'A quiet daily practice'}</h3>
                      <span>@{profile.username} · Joined {displayDate(profile.joinedAt)}</span>
                    </div>
                  </div>

                  <div className="profile-month">
                    <button
                      type="button"
                      aria-label="Previous profile month"
                      disabled={profileLoading || !shiftMonth(profile.month, -1)}
                      onClick={() => void changeProfileMonth(-1)}
                    ><ArrowLeft size={15} /></button>
                    <span><CalendarDays size={14} strokeWidth={1.4} /> {monthLabel(profile.month)}</span>
                    <button
                      type="button"
                      aria-label="Next profile month"
                      disabled={profileLoading || !shiftMonth(profile.month, 1)}
                      onClick={() => void changeProfileMonth(1)}
                    ><ArrowRight size={15} /></button>
                  </div>

                  <div className="profile-stats">
                    <div className="profile-score">
                      <strong>{profile.stats.percentage}<small>%</small></strong>
                      <span>CONSISTENCY</span>
                    </div>
                    <div>
                      <p><strong>{profile.stats.completed}</strong> of {profile.stats.total} check-ins</p>
                      <span>Little by little, in public.</span>
                    </div>
                  </div>

                  <div className="profile-habits">
                    <p className="social-kicker">DAILY RITUALS · {String(profile.habits.length).padStart(2, '0')}</p>
                    {profile.habits.length > 0 ? (
                      <ol>
                        {profile.habits.map((habit, index) => (
                          <li key={`${index}-${habit}`}><span>{String(index + 1).padStart(2, '0')}</span>{habit}</li>
                        ))}
                      </ol>
                    ) : <p className="profile-no-habits">A blank slate, for now.</p>}
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

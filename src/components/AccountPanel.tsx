import { useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react'
import {
  getPasswordValidationError,
  getUsernameValidationError,
  normalizeUsername,
} from '../lib/api'
import type { Account, SocialSummaryResponse } from '../lib/api'

type AccountView = 'login' | 'signup' | 'account'

interface AccountPanelProps {
  account: Account | null
  busy: boolean
  error: string
  syncLabel: string
  onClose: () => void
  onLogin: (username: string, password: string) => Promise<void>
  onSignup: (username: string, password: string) => Promise<void>
  onLogout: () => Promise<void>
  onVisibilityChange: (value: boolean) => Promise<void>
  onLoadSocialSummary: (signal?: AbortSignal) => Promise<SocialSummaryResponse>
}

function displayDate(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Recently'
  return new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(date)
}

export function AccountPanel({
  account,
  busy,
  error,
  syncLabel,
  onClose,
  onLogin,
  onSignup,
  onLogout,
  onVisibilityChange,
  onLoadSocialSummary,
}: AccountPanelProps) {
  const [view, setView] = useState<AccountView>(account ? 'account' : 'login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState('')
  const [summary, setSummary] = useState<SocialSummaryResponse | null>(null)
  const root = useRef<HTMLElement>(null)
  const close = useEffectEvent(onClose)

  useEffect(() => {
    const previousFocus = document.activeElement
    root.current?.querySelector<HTMLButtonElement>('.social-close')?.focus({ preventScroll: true })
    function keyboard(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    }
    document.addEventListener('keydown', keyboard)
    return () => {
      document.removeEventListener('keydown', keyboard)
      if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    if (!account) return
    const controller = new AbortController()
    void onLoadSocialSummary(controller.signal)
      .then(setSummary)
      .catch((requestError: unknown) => {
        if (!(requestError instanceof Error && requestError.name === 'AbortError')) setSummary(null)
      })
    return () => controller.abort()
  }, [account, onLoadSocialSummary])

  function showAuth(next: 'login' | 'signup') {
    setView(next)
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
      if (view === 'signup') await onSignup(normalized, password)
      else await onLogin(normalized, password)
      setPassword('')
      setView('account')
    } catch {
      // The account hook supplies the server's safe error message.
    }
  }

  const activeView = account ? 'account' : view === 'account' ? 'login' : view
  const heading = account && activeView === 'account'
    ? `@${account.username}`
    : activeView === 'signup'
      ? 'Join the circle.'
      : 'Welcome back.'

  return (
    <section ref={root} className="social-panel account-panel" aria-labelledby="account-panel-heading">
      <header className="social-header">
        <div>
          <p className="eyebrow"><span /> Your Angelo</p>
          <h2 id="account-panel-heading">{heading}</h2>
          <p>{account ? 'Your profile, privacy, and sign-in details.' : 'Sign in to keep your practice and circle together.'}</p>
        </div>
        <button className="icon-button social-close" aria-label="Close account panel" onClick={onClose}>
          <X size={19} strokeWidth={1.5} />
        </button>
      </header>

      {!account && (
        <nav className="social-tabs" aria-label="Account options">
          <button className={activeView === 'login' ? 'is-active' : ''} onClick={() => showAuth('login')}>
            <UserRound size={14} strokeWidth={1.5} /> Sign in
          </button>
          <button className={activeView === 'signup' ? 'is-active' : ''} onClick={() => showAuth('signup')}>
            <UsersRound size={14} strokeWidth={1.5} /> Create account
          </button>
        </nav>
      )}

      <div className="social-body" data-scrollable>
        {!account && (activeView === 'login' || activeView === 'signup') && (
          <section className="auth-section" aria-labelledby="auth-heading">
            <p className="social-kicker">{activeView === 'signup' ? 'OPTIONAL ACCOUNT' : 'YOUR ACCOUNT'}</p>
            <h3 id="auth-heading">{activeView === 'signup' ? 'Choose a name that is yours.' : 'Pick up where you left off.'}</h3>
            <p className="auth-intro">
              {activeView === 'signup'
                ? 'Your current routine and guest notes come with you. Sample check-ins are cleared, and your profile starts public.'
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
                    autoComplete={activeView === 'signup' ? 'new-password' : 'current-password'}
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
                {activeView === 'signup' ? 'Create my account' : 'Sign in'}
              </button>
            </form>
            <p className="auth-switch">
              {activeView === 'signup' ? 'Already have a username?' : 'New to ANGELO?'}
              <button type="button" onClick={() => showAuth(activeView === 'signup' ? 'login' : 'signup')}>
                {activeView === 'signup' ? 'Sign in' : 'Create an account'}
              </button>
            </p>
            <div className="public-note">
              <Eye size={15} strokeWidth={1.4} />
              <p><strong>Public by default.</strong> People can find your shared practice by username. You can switch this off anytime.</p>
            </div>
          </section>
        )}

        {account && activeView === 'account' && (
          <section className="account-section" aria-labelledby="signed-in-heading">
            <div className="account-identity">
              <span className="profile-avatar large" aria-hidden="true">{account.username.slice(0, 1).toUpperCase()}</span>
              <div>
                <p className="social-kicker">SIGNED IN</p>
                <h3 id="signed-in-heading">@{account.username}</h3>
                <span>Joined {displayDate(account.createdAt)} · {syncLabel}</span>
              </div>
              <Check size={18} strokeWidth={1.5} aria-label="Signed in" />
            </div>

            <div className="account-social-stats" aria-label="Social totals">
              <div><strong>{summary?.followers ?? '—'}</strong><span>Followers</span></div>
              <div><strong>{summary?.following ?? '—'}</strong><span>Following</span></div>
            </div>

            <div className="account-setting">
              <div>
                {account.isPublic ? <Eye size={18} strokeWidth={1.4} /> : <EyeOff size={18} strokeWidth={1.4} />}
                <span>
                  <strong>Public profile</strong>
                  <small>{account.isPublic ? 'People can find and view your practice.' : 'Your profile is hidden from search.'}</small>
                </span>
              </div>
              <button
                type="button"
                className="toggle social-toggle"
                role="switch"
                aria-label="Make profile public"
                aria-checked={account.isPublic}
                disabled={busy}
                onClick={() => void onVisibilityChange(!account.isPublic).catch(() => undefined)}
              ><span /></button>
            </div>

            {error && <p className="social-error" role="alert">{error}</p>}
            <div className="account-actions single-action">
              <button
                type="button"
                className="logout-button"
                disabled={busy}
                onClick={() => void onLogout()}
              >
                {busy ? <LoaderCircle className="social-spinner" size={15} /> : <LogOut size={15} strokeWidth={1.4} />}
                Sign out
              </button>
            </div>
            <p className="account-guest-note">Signing out returns to the guest routine saved on this device.</p>
          </section>
        )}
      </div>
    </section>
  )
}

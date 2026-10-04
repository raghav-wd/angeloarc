import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowUpRight, Check, Eye, LoaderCircle, Plus, SlidersHorizontal, UserRound, UsersRound } from 'lucide-react'
import type { CSSProperties } from 'react'
import { AccountLoadingScreen } from './components/AccountLoadingScreen'
import { AccountPanel } from './components/AccountPanel'
import { Brand } from './components/Brand'
import { CircularTracker } from './components/CircularTracker'
import { CustomCursor } from './components/CustomCursor'
import type { CursorFeedback, CursorRejection } from './components/CustomCursor'
import { FlashReminder } from './components/FlashReminder'
import { LockReminder } from './components/LockReminder'
import { MonthPicker } from './components/MonthPicker'
import { PaperBallIcon } from './components/PaperBallIcon'
import { PaperNotes } from './components/PaperNotes'
import type { PaperNotesPhase } from './components/PaperNotes'
import { SettingsPanel } from './components/SettingsPanel'
import { SocialPanel } from './components/SocialPanel'
import { mergeGuestNotesIntoAccount, useDailyNotes } from './hooks/useDailyNotes'
import { useDailyVisits } from './hooks/useDailyVisits'
import { mergeGuestPaperNotesIntoAccount, usePaperNotes } from './hooks/usePaperNotes'
import { useTrackerState } from './hooks/useTrackerState'
import { FLASH_REMINDER_MESSAGE, pickReminder } from './lib/flashReminder'
import { PANEL_EXIT_DURATION, SWEEP_IN_DURATION, SWEEP_OUT_DURATION, SWEEP_STAGGER, TEXT_SWEEP } from './lib/radialSweep'
import { clearTrackerProgress, dateKey, daysInMonth, formatFullDate, getHabitsForMonth, isFutureDate, isHabitAvailableOnDate, monthKey, toggleCompletion } from './lib/tracker'
import type { Month, MonthHabit } from './lib/tracker'
import type { PublicProfile } from './lib/api'
import './App.css'

type PanelKind = 'settings' | 'account'

// The homepage trades the tracker for a panel through a radial sweep:
// closed -> out (wheel and copy sweep away clockwise) -> open (panel lives
// inline) -> exit (panel fades) -> in (wheel sweeps back) -> closed.
type PanelPhase = 'closed' | 'out' | 'open' | 'exit' | 'in'
type TrackerSwitchPhase = 'idle' | 'out' | 'in'

// Notes to self replace the homepage: balls drop in as it comes apart, and
// roll away before whichever page the person picked next takes over.
type NotesPhase = 'closed' | PaperNotesPhase
type NotesDestination = 'home' | PanelKind | 'people'

const EMPTY_DAILY_VISITS: ReadonlySet<string> = new Set()
const EMPTY_DAILY_NOTES: Readonly<Record<string, string>> = {}

function sweep(progress: number): CSSProperties {
  return { '--sweep': progress } as CSSProperties
}

function App() {
  const {
    state,
    setState,
    storageError,
    account,
    authReady,
    authBusy,
    authError,
    syncStatus,
    syncError,
    signup,
    login,
    logout,
    setProfilePublic,
    loadPublicProfile,
    loadFollowingProfiles,
    loadSocialSummary,
    followUser,
    unfollowUser,
  } = useTrackerState()
  const [today, setToday] = useState(() => new Date())
  const { dailyVisits, recordDailyVisit } = useDailyVisits(today)
  const { dailyNotes, setDailyNote, notesStorageError } = useDailyNotes(account?.username)
  const { paperNotes, savePaperNote, deletePaperNote, paperNotesStorageError } = usePaperNotes(account?.username)
  const [month, setMonth] = useState<Month>(() => ({ year: today.getFullYear(), month: today.getMonth() }))
  const [panel, setPanel] = useState<PanelKind | null>(null)
  const [phase, setPhase] = useState<PanelPhase>('closed')
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [switchPhase, setSwitchPhase] = useState<TrackerSwitchPhase>('idle')
  const [viewedProfile, setViewedProfile] = useState<PublicProfile | null>(null)
  const [relationshipBusy, setRelationshipBusy] = useState(false)
  const [relationshipError, setRelationshipError] = useState('')
  const [lockReminderVisible, setLockReminderVisible] = useState(false)
  const [flashActive, setFlashActive] = useState(false)
  const [flashMessage, setFlashMessage] = useState(FLASH_REMINDER_MESSAGE)
  const [dateNoteOpen, setDateNoteOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [cursorRejection, setCursorRejection] = useState<CursorRejection | null>(null)
  const [notesPhase, setNotesPhase] = useState<NotesPhase>('closed')
  const [notesFromPanel, setNotesFromPanel] = useState(false)
  const [paperSheetOpen, setPaperSheetOpen] = useState(false)
  const notesPhaseRef = useRef<NotesPhase>('closed')
  const notesDestination = useRef<NotesDestination>('home')
  const notesTrigger = useRef<HTMLButtonElement>(null)
  const workspaceLayer = useRef<HTMLDivElement>(null)
  const footerLayer = useRef<HTMLDivElement>(null)
  const flashOpener = useRef<HTMLButtonElement | null>(null)
  const ownMonth = useRef(month)
  const pendingProfile = useRef<PublicProfile | null | undefined>(undefined)
  const switchAnnouncement = useRef('')
  const focusProfileAfterSwitch = useRef(false)
  const returnToOwnButton = useRef<HTMLButtonElement | null>(null)
  const workspace = useRef<HTMLElement>(null)
  const heading = useRef<HTMLDivElement>(null)
  const displayState = viewedProfile?.tracker ?? state
  const displayTitle = displayState.title.trim() || (viewedProfile ? `${viewedProfile.username}'s practice` : '')
  const viewedProfileIsFollowing = Boolean(account && viewedProfile?.isFollowing)
  const habits = getHabitsForMonth(displayState, month)
  const dense = habits.length >= 7
  const empty = habits.length === 0
  const titleWords = displayTitle.split(' ').filter(Boolean)
  const titleLastWord = titleWords.pop()
  const isCurrentMonth = today.getFullYear() === month.year && today.getMonth() === month.month
  const panelShown = phase === 'open' || phase === 'exit'
  const notesActive = notesPhase !== 'closed'
  // Mid-transition clicks are ignored rather than disabling the trigger, which
  // would throw keyboard focus off it.
  const notesTriggerBlocked = notesPhase === 'arriving'
    || notesPhase === 'leaving'
    || (notesPhase === 'closed' && (switchPhase !== 'idle' || phase === 'out' || phase === 'exit'))
  const homeAway = notesPhase === 'open' || notesPhase === 'leaving' || (notesPhase === 'arriving' && notesFromPanel)
  const syncLabel = account
    ? syncStatus === 'restoring'
      ? 'RESTORING ACCOUNT'
      : syncStatus === 'syncing'
        ? 'SYNCING CHANGES'
        : syncStatus === 'error'
          ? 'SAVED HERE · SYNC PAUSED'
          : 'SYNCED TO PROFILE'
    : storageError
      ? 'IN THIS TAB ONLY'
      : 'SAVED ON THIS DEVICE'

  useLayoutEffect(() => {
    const container = workspace.current
    const title = heading.current
    if (!container || !title) return

    function measureTitle() {
      container?.style.setProperty('--heading-height', `${title?.getBoundingClientRect().height ?? 0}px`)
    }

    measureTitle()
    const observer = new ResizeObserver(measureTitle)
    observer.observe(title)
    return () => observer.disconnect()
  }, [authReady, displayTitle])

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date()
      setToday(now)
      recordDailyVisit(now)
    }, 60_000)
    return () => clearInterval(interval)
  }, [recordDailyVisit])

  useLayoutEffect(() => {
    notesPhaseRef.current = notesPhase
  }, [notesPhase])

  useEffect(() => {
    if (phase === 'closed' || phase === 'open') return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const delay = phase === 'out' ? SWEEP_OUT_DURATION : phase === 'exit' ? PANEL_EXIT_DURATION : SWEEP_IN_DURATION
    const timer = setTimeout(() => {
      if (phase === 'out') {
        setPhase('open')
      } else if (phase === 'exit') {
        // A panel closing because notes to self are opening stays away; the
        // homepage only returns once the notes roll off.
        if (notesPhaseRef.current === 'closed') {
          setPhase('in')
        } else {
          setPhase('closed')
          setPanel(null)
        }
      } else {
        setPhase('closed')
        setPanel(null)
      }
    }, reduced ? 0 : delay)
    return () => clearTimeout(timer)
  }, [phase])

  useEffect(() => {
    if (switchPhase === 'idle') return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const delay = switchPhase === 'out' ? SWEEP_OUT_DURATION : SWEEP_IN_DURATION
    const timer = setTimeout(() => {
      if (switchPhase === 'out') {
        const nextProfile = pendingProfile.current
        pendingProfile.current = undefined
        if (nextProfile) {
          const [yearText, monthText] = nextProfile.month.split('-')
          setViewedProfile(nextProfile)
          setMonth({ year: Number(yearText), month: Number(monthText) - 1 })
        } else {
          setViewedProfile(null)
          setMonth(ownMonth.current)
        }
        setRelationshipError('')
        setSwitchPhase('in')
      } else {
        setSwitchPhase('idle')
        if (switchAnnouncement.current) setAnnouncement(switchAnnouncement.current)
        switchAnnouncement.current = ''
        if (focusProfileAfterSwitch.current) {
          focusProfileAfterSwitch.current = false
          requestAnimationFrame(() => returnToOwnButton.current?.focus({ preventScroll: true }))
        }
      }
    }, reduced ? 0 : delay)
    return () => clearTimeout(timer)
  }, [switchPhase])

  function openPanel(kind: PanelKind) {
    if (notesPhase === 'open' || notesPhase === 'leaving') {
      leaveNotes(kind)
      return
    }
    if (switchPhase !== 'idle' || notesActive) return
    setLockReminderVisible(false)
    setPeopleOpen(false)
    if (phase === 'open' && kind === panel) {
      closePanel()
      return
    }
    setPanel(kind)
    if (phase === 'closed' || phase === 'in') setPhase('out')
    else if (phase === 'exit') setPhase('open')
  }

  function closePanel() {
    if (phase === 'open') setPhase('exit')
  }

  function togglePeopleDrawer() {
    if (notesPhase === 'open' || notesPhase === 'leaving') {
      leaveNotes('people')
      return
    }
    if (phase !== 'closed' || switchPhase !== 'idle' || notesActive) return
    setLockReminderVisible(false)
    setPeopleOpen((current) => !current)
  }

  function animateNotesTrigger() {
    const icon = notesTrigger.current?.querySelector('svg')
    if (!icon || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    icon.getAnimations().forEach((animation) => animation.cancel())
    // Squeezed a little tighter, then it springs back.
    icon.animate([
      { transform: 'scale(1) rotate(0deg)' },
      { transform: 'scale(0.72) rotate(-24deg)', offset: 0.3 },
      { transform: 'scale(1.16) rotate(12deg)', offset: 0.62 },
      { transform: 'scale(0.96) rotate(-4deg)', offset: 0.82 },
      { transform: 'scale(1) rotate(0deg)' },
    ], { duration: 520, easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)' })
  }

  function toggleNotes() {
    if (notesPhase === 'open') {
      animateNotesTrigger()
      leaveNotes('home')
      return
    }
    if (notesTriggerBlocked) return
    animateNotesTrigger()
    setLockReminderVisible(false)
    setPeopleOpen(false)
    const fromPanel = phase === 'open'
    setNotesFromPanel(fromPanel)
    if (fromPanel) setPhase('exit')
    setNotesPhase('arriving')
    setAnnouncement('Notes to self.')
  }

  // While the balls are already rolling away, a later choice of page wins.
  function leaveNotes(destination: NotesDestination) {
    if (notesPhase !== 'open' && notesPhase !== 'leaving') return
    notesDestination.current = destination
    if (notesPhase === 'leaving') return
    // The notes page switches its controls off as it leaves, so keyboard focus
    // moves to the trigger that brought the person here instead of being lost.
    const focused = document.activeElement
    if (!focused || focused === document.body || focused.closest('.paper-notes')) {
      notesTrigger.current?.focus({ preventScroll: true })
    }
    setNotesPhase('leaving')
  }

  function finishNotesExit() {
    const destination = notesDestination.current
    notesDestination.current = 'home'
    setNotesPhase('closed')
    setNotesFromPanel(false)
    setPaperSheetOpen(false)
    if (destination === 'settings' || destination === 'account') {
      setPanel(destination)
      setPhase('open')
      return
    }
    setPhase('in')
    if (destination === 'people') setPeopleOpen(true)
  }

  function viewProfile(profile: PublicProfile) {
    if (switchPhase !== 'idle' || phase !== 'closed') return
    if (!viewedProfile) ownMonth.current = month
    setLockReminderVisible(false)
    setDateNoteOpen(false)
    setRelationshipError('')
    pendingProfile.current = profile
    switchAnnouncement.current = `Now viewing @${profile.username}'s ${profile.month} practice.`
    if (window.matchMedia('(max-width: 960px)').matches) {
      focusProfileAfterSwitch.current = true
      setPeopleOpen(false)
    }
    setSwitchPhase('out')
  }

  function returnToOwnPractice() {
    if (!viewedProfile || switchPhase !== 'idle' || phase !== 'closed') return
    pendingProfile.current = null
    switchAnnouncement.current = 'Now viewing your practice.'
    setSwitchPhase('out')
  }

  async function toggleViewedProfileFollow() {
    if (!viewedProfile || relationshipBusy) return
    if (!account) {
      openPanel('account')
      return
    }
    if (account.username === viewedProfile.username) return
    setRelationshipBusy(true)
    setRelationshipError('')
    try {
      const response = viewedProfileIsFollowing
        ? await unfollowUser(viewedProfile.username)
        : await followUser(viewedProfile.username)
      setViewedProfile((current) => current && current.username === viewedProfile.username
        ? { ...current, isFollowing: response.following, followerCount: response.followerCount }
        : current)
    } catch (error) {
      setRelationshipError(error instanceof Error ? error.message : 'That follow could not be updated.')
    } finally {
      setRelationshipBusy(false)
    }
  }

  function syncViewedRelationship(username: string, following: boolean, followerCount: number) {
    setViewedProfile((current) => current?.username === username
      ? { ...current, isFollowing: following, followerCount }
      : current)
  }

  function closeFlash() {
    setFlashActive(false)
    requestAnimationFrame(() => flashOpener.current?.focus({ preventScroll: true }))
  }

  async function signupWithNotes(username: string, password: string) {
    await signup(username, password)
    mergeGuestNotesIntoAccount(username)
    mergeGuestPaperNotesIntoAccount(username)
  }

  function toggle(day: number, habit: MonthHabit, feedback: CursorFeedback): boolean {
    const now = new Date()
    const activeState = state.isDemo ? clearTrackerProgress(state, now) : state
    if (!isHabitAvailableOnDate(activeState, month, day, habit.id)) {
      if (state.isDemo) setState(activeState)
      setCursorRejection((previous) => ({ ...feedback, id: (previous?.id ?? 0) + 1 }))
      setAnnouncement(`${habit.name} was not part of your routine on ${formatFullDate(month, day)}.`)
      return false
    }
    if (isFutureDate(month, day, now)) {
      setCursorRejection((previous) => ({ ...feedback, id: (previous?.id ?? 0) + 1 }))
      setAnnouncement(`${habit.name} is locked until ${formatFullDate(month, day)}. You can only update today or earlier.`)
      return false
    }
    setState((previous) => toggleCompletion(
      previous.isDemo ? clearTrackerProgress(previous, now) : previous,
      month,
      day,
      habit.id,
      now,
    ))
    const wasDone = activeState.completions[dateKey(month, day)]?.includes(habit.id)
    setAnnouncement(`${habit.name}, day ${day}, marked ${wasDone ? 'not done' : 'done'}.`)
    return true
  }

  if (!authReady) return <AccountLoadingScreen />

  return (
    <>
      <div
        className={[
          'app',
          dense ? 'is-dense' : '',
          displayTitle ? '' : 'no-title',
          phase === 'out' || switchPhase === 'out' ? 'is-sweeping-out' : '',
          panelShown ? 'is-panel-open' : '',
          phase === 'in' || switchPhase === 'in' ? 'is-sweeping-in' : '',
          viewedProfile ? 'is-viewing-profile' : '',
          peopleOpen ? 'is-people-open' : '',
          notesPhase === 'arriving' || notesPhase === 'open' ? 'is-notes-open' : '',
          homeAway ? 'is-home-away' : '',
        ].join(' ')}
        style={{ '--sweep-stagger': `${SWEEP_STAGGER}ms` } as CSSProperties}
        inert={flashActive || paperSheetOpen}
      >
        <div className="ambient-grid" aria-hidden="true" />
        <div className="page-grain" aria-hidden="true" />
        <header className="page-header">
          <div className="header-left">
            <Brand onHome={() => {
              if (notesPhase === 'open') leaveNotes('home')
              else if (notesActive) return
              else if (viewedProfile) returnToOwnPractice()
              else setMonth({ year: today.getFullYear(), month: today.getMonth() })
            }} />
          </div>
          <div className="header-actions">
            <button
              className="settings-trigger"
              onClick={() => openPanel('settings')}
              aria-label="Open settings"
              aria-expanded={panel === 'settings' && (phase === 'out' || phase === 'open')}
            >
              <SlidersHorizontal size={20} strokeWidth={1.4} />
              <span className="settings-hint" aria-hidden="true">Make it yours</span>
            </button>
            <button
              className="social-trigger account-trigger"
              onClick={() => openPanel('account')}
              aria-label={account ? `Open account details for ${account.username}` : 'Sign in or create an account'}
              aria-expanded={panel === 'account' && (phase === 'out' || phase === 'open')}
            >
              <UserRound size={19} strokeWidth={1.35} />
              <span className="social-hint" aria-hidden="true">
                {!authReady ? 'Restoring account' : account ? `@${account.username}` : 'Sign in'}
              </span>
            </button>
          </div>
        </header>

        <button
          ref={notesTrigger}
          className={`notes-trigger ${notesPhase === 'closed' && notesTriggerBlocked ? 'is-waiting' : ''}`}
          onClick={toggleNotes}
          aria-disabled={notesTriggerBlocked}
          aria-label={notesPhase === 'open' ? 'Put your notes to self away' : 'Open your notes to self'}
          aria-expanded={notesPhase === 'arriving' || notesPhase === 'open'}
        >
          <PaperBallIcon size={21} strokeWidth={1.3} />
          <span className="notes-trigger-hint" aria-hidden="true">{notesPhase === 'open' ? 'Back to practice' : 'Notes to self'}</span>
        </button>

        <button
          className="people-trigger"
          onClick={togglePeopleDrawer}
          disabled={phase !== 'closed' || switchPhase !== 'idle'}
          aria-label={`${peopleOpen ? 'Close' : 'Open'} ${account ? 'the people you follow' : 'public profile search'}`}
          aria-controls="people-drawer"
          aria-expanded={peopleOpen}
        >
          <UsersRound size={20} strokeWidth={1.35} />
          <span className="people-trigger-hint" aria-hidden="true">{account ? 'Your circle' : 'Find people'}</span>
        </button>

        <div className="home-layer" ref={workspaceLayer}>
        <main className="workspace" ref={workspace}>
          {displayTitle && (
            <div
              ref={heading}
              className={`hero-heading sweep-item ${displayTitle.length > 30 ? 'is-long' : ''}`}
              style={sweep(TEXT_SWEEP.heroHeading)}
            >
              {viewedProfile && (
                <div className="viewed-profile-context">
                  <button ref={returnToOwnButton} type="button" className="return-to-own" onClick={returnToOwnPractice}>
                    <ArrowLeft size={13} strokeWidth={1.5} /> My practice
                  </button>
                  <div className="viewed-profile-identity">
                    <span className="profile-avatar" aria-hidden="true">{viewedProfile.username.slice(0, 1).toUpperCase()}</span>
                    <span><strong>@{viewedProfile.username}</strong><small>{viewedProfile.followerCount} {viewedProfile.followerCount === 1 ? 'follower' : 'followers'}</small></span>
                  </div>
                  {account?.username !== viewedProfile.username && (
                    <button
                      type="button"
                      className={`follow-button profile-follow-button ${viewedProfileIsFollowing ? 'is-following' : ''}`}
                      disabled={relationshipBusy}
                      onClick={() => void toggleViewedProfileFollow()}
                    >
                      {relationshipBusy
                        ? <LoaderCircle className="social-spinner" size={13} />
                        : viewedProfileIsFollowing
                          ? <><Check size={13} /> Following</>
                          : <><Plus size={13} /> {account ? 'Follow' : 'Sign in to follow'}</>}
                    </button>
                  )}
                </div>
              )}
              <p className="eyebrow"><span /> {viewedProfile ? 'A PRACTICE IN YOUR CIRCLE.' : 'A LITTLE BETTER, EVERY DAY.'}</p>
              <h1>
                {titleWords.length > 0 && <span>{titleWords.join(' ')} </span>}
                <em>{titleLastWord}</em>
              </h1>
              <p className="hero-subtitle">{viewedProfile ? `A month in @${viewedProfile.username}'s rhythm.` : 'Less thinking. More showing up.'}</p>
              {relationshipError && <p className="profile-relationship-error" role="alert">{relationshipError}</p>}
            </div>
          )}
          <div className="tracker-stage">
            {empty ? (
              <div className="empty-tracker sweep-item" style={sweep(TEXT_SWEEP.emptyTracker)}>
                <svg viewBox="0 0 100 100" aria-hidden="true">
                  <path d="M50 8A42 42 0 1 1 8 50" />
                  <path d="M50 19A31 31 0 1 1 19 50" />
                  <path d="M50 30A20 20 0 1 1 30 50" />
                </svg>
                <h2>{viewedProfile ? <>A quiet month, <em>for now.</em></> : <>Every routine starts <em>somewhere.</em></>}</h2>
                <p>{viewedProfile ? `@${viewedProfile.username} has no habits in this month.` : 'One small habit is all it takes.'}</p>
                {viewedProfile
                  ? <button onClick={returnToOwnPractice}><ArrowLeft size={16} /> Back to my practice</button>
                  : <button onClick={() => openPanel('settings')}><Plus size={16} /> Add your first habit</button>}
              </div>
            ) : (
              <div className="tracker-month-frame" key={`${viewedProfile?.username ?? 'me'}-${monthKey(month)}-${habits.map((habit) => habit.id).join('-')}`}>
                <CircularTracker
                  state={displayState}
                  month={month}
                  today={today}
                  dailyVisits={viewedProfile ? EMPTY_DAILY_VISITS : dailyVisits}
                  dailyNotes={viewedProfile ? EMPTY_DAILY_NOTES : dailyNotes}
                  notesEnabled={!viewedProfile && phase === 'closed' && switchPhase === 'idle' && !flashActive && !notesActive}
                  onToggle={toggle}
                  onDailyNoteChange={setDailyNote}
                  onNoteVisibilityChange={setDateNoteOpen}
                  readOnly={Boolean(viewedProfile)}
                  ownerUsername={viewedProfile?.username}
                />
              </div>
            )}
          </div>

          <aside className="intention-note sweep-item" style={sweep(TEXT_SWEEP.intentionNote)} aria-hidden="true">
            <span className="small-cross">+</span>
            <p>Not perfect.<br /><em>Just consistent.</em></p>
            <span className="note-caption">THAT&apos;S THE WHOLE IDEA.</span>
          </aside>
          <aside
            className={`day-note sweep-item ${lockReminderVisible ? 'is-hidden' : ''} ${dateNoteOpen ? 'is-date-note-open' : ''}`}
            style={sweep(TEXT_SWEEP.dayNote)}
            aria-hidden={peopleOpen || lockReminderVisible || dateNoteOpen}
          >
            <div className="day-note-heading"><span />{isCurrentMonth ? 'TODAY IS A GOOD DAY' : 'ONE DAY AT A TIME'}</div>
            <p className="day-counter">{isCurrentMonth ? String(today.getDate()).padStart(2, '0') : String(daysInMonth(month)).padStart(2, '0')}<span> / {daysInMonth(month)}</span></p>
            <p className="day-note-copy">{isCurrentMonth ? <>A small step today.<br />A different you tomorrow.</> : <>A little intention.<br />A whole lot of possibility.</>}</p>
            <span className="day-note-line" />
          </aside>
          {!viewedProfile && (
            <>
              <button
                ref={flashOpener}
                className="flash-trigger sweep-item"
                style={sweep(TEXT_SWEEP.flashTrigger)}
                onClick={() => {
                  setLockReminderVisible(false)
                  setFlashMessage(pickReminder(state.reminders, Math.random))
                  setFlashActive(true)
                }}
                aria-label="Flash a push reminder"
              >
                <Eye size={19} strokeWidth={1.4} />
                <span className="flash-trigger-hint" aria-hidden="true">Need a push?</span>
              </button>
              <LockReminder
                paused={phase !== 'closed' || flashActive || notesActive}
                visible={lockReminderVisible}
                onVisibilityChange={setLockReminderVisible}
              />
            </>
          )}
        </main>
        </div>

        {panelShown && panel && (
          <div className={`inline-panel ${phase === 'exit' ? 'is-leaving' : ''}`}>
            {panel === 'settings' ? (
              <SettingsPanel
                state={state}
                today={today}
                persistenceLabel={account ? syncLabel.toLowerCase() : 'Saved on this device.'}
                onClose={closePanel}
                onStateChange={setState}
              />
            ) : (
              <AccountPanel
                account={account}
                busy={authBusy}
                error={authError}
                syncLabel={syncLabel.toLowerCase()}
                onClose={closePanel}
                onLogin={login}
                onSignup={signupWithNotes}
                onLogout={async () => {
                  await logout()
                  setViewedProfile((current) => current ? { ...current, isFollowing: false } : current)
                }}
                onVisibilityChange={setProfilePublic}
                onLoadSocialSummary={loadSocialSummary}
              />
            )}
          </div>
        )}

        {peopleOpen && (
          <aside
            id="people-drawer"
            className="people-drawer"
            aria-label="People you follow and profile search"
            aria-busy={switchPhase !== 'idle'}
            inert={switchPhase !== 'idle'}
          >
            <SocialPanel
              account={account}
              activeUsername={viewedProfile?.username}
              profileMonth={monthKey(month)}
              onClose={() => setPeopleOpen(false)}
              onOpenAccount={() => openPanel('account')}
              onLoadProfile={loadPublicProfile}
              onLoadFollowing={loadFollowingProfiles}
              onFollow={followUser}
              onUnfollow={unfollowUser}
              onViewProfile={viewProfile}
              onRelationshipChange={syncViewedRelationship}
            />
          </aside>
        )}

        <div className="home-layer" ref={footerLayer}>
        <footer className="page-footer">
          <div className="footer-guide sweep-item" style={sweep(TEXT_SWEEP.footerGuide)}>
            <div className="legend" aria-label="Cell legend">
              <span><i className="legend-done" /> Done</span>
              <span><i className="legend-undone" /> Not yet</span>
              <span><i className="legend-unavailable" /> Not available</span>
            </div>
            <p>{viewedProfile ? `Viewing @${viewedProfile.username}'s shared check-ins.` : 'Click a cell. Keep a promise.'}</p>
          </div>
          <div className="month-nav-slot sweep-item" style={sweep(TEXT_SWEEP.monthNavigation)}>
            <MonthPicker month={month} today={today} onChange={setMonth} />
          </div>
          <div className="footer-signoff sweep-item" style={sweep(TEXT_SWEEP.footerSignoff)}>
            {viewedProfile ? (
              <button className="viewing-label" onClick={() => setPeopleOpen(true)}>
                VIEWING @{viewedProfile.username} <ArrowUpRight size={12} strokeWidth={1.5} />
              </button>
            ) : state.isDemo ? (
              <button className="demo-label" onClick={() => openPanel('settings')}>
                SAMPLE PROGRESS <ArrowUpRight size={12} strokeWidth={1.5} />
              </button>
            ) : (
              <span className={`saved-label sync-${syncStatus}`}><Check size={12} /> {syncLabel}</span>
            )}
            <p>Little by little, a little becomes a lot.</p>
          </div>
        </footer>
        </div>

        {notesActive && (
          <PaperNotes
            phase={notesPhase}
            notes={paperNotes}
            dissolveTargets={() => notesFromPanel
              ? []
              : [workspaceLayer.current, footerLayer.current].filter((layer): layer is HTMLDivElement => Boolean(layer))}
            storageLabel={paperNotesStorageError ? 'IN THIS TAB ONLY' : 'SAVED ON THIS DEVICE'}
            onArrived={() => setNotesPhase('open')}
            onLeft={finishNotesExit}
            onExit={() => leaveNotes('home')}
            onSaveNote={savePaperNote}
            onDeleteNote={deletePaperNote}
            onSheetChange={setPaperSheetOpen}
          />
        )}
        {(storageError || notesStorageError || paperNotesStorageError || syncError) && (
          <p className="storage-warning" role="alert">{storageError || notesStorageError || paperNotesStorageError || syncError}</p>
        )}
      </div>
      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
      {flashActive && <FlashReminder message={flashMessage} onClose={closeFlash} />}
      <CustomCursor rejection={cursorRejection} />
    </>
  )
}

export default App

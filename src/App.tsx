import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, Eye, Plus, SlidersHorizontal, UsersRound } from 'lucide-react'
import type { CSSProperties } from 'react'
import { AccountLoadingScreen } from './components/AccountLoadingScreen'
import { Brand } from './components/Brand'
import { CircularTracker } from './components/CircularTracker'
import { CustomCursor } from './components/CustomCursor'
import type { CursorFeedback, CursorRejection } from './components/CustomCursor'
import { FlashReminder } from './components/FlashReminder'
import { LockReminder } from './components/LockReminder'
import { MonthPicker } from './components/MonthPicker'
import { SettingsPanel } from './components/SettingsPanel'
import { SocialPanel } from './components/SocialPanel'
import { useTrackerState } from './hooks/useTrackerState'
import { FLASH_REMINDER_MESSAGE, pickReminder } from './lib/flashReminder'
import { PANEL_EXIT_DURATION, SWEEP_IN_DURATION, SWEEP_OUT_DURATION, SWEEP_STAGGER, TEXT_SWEEP } from './lib/radialSweep'
import { clearTrackerProgress, dateKey, daysInMonth, formatFullDate, getHabitsForMonth, isFutureDate, isHabitAvailableOnDate, monthKey, toggleCompletion } from './lib/tracker'
import type { Month, MonthHabit } from './lib/tracker'
import './App.css'

type PanelKind = 'settings' | 'social'

// The homepage trades the tracker for a panel through a radial sweep:
// closed -> out (wheel and copy sweep away clockwise) -> open (panel lives
// inline) -> exit (panel fades) -> in (wheel sweeps back) -> closed.
type PanelPhase = 'closed' | 'out' | 'open' | 'exit' | 'in'

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
  } = useTrackerState()
  const [today, setToday] = useState(() => new Date())
  const [month, setMonth] = useState<Month>(() => ({ year: today.getFullYear(), month: today.getMonth() }))
  const [panel, setPanel] = useState<PanelKind | null>(null)
  const [phase, setPhase] = useState<PanelPhase>('closed')
  const [lockReminderVisible, setLockReminderVisible] = useState(false)
  const [flashActive, setFlashActive] = useState(false)
  const [flashMessage, setFlashMessage] = useState(FLASH_REMINDER_MESSAGE)
  const [announcement, setAnnouncement] = useState('')
  const [cursorRejection, setCursorRejection] = useState<CursorRejection | null>(null)
  const flashOpener = useRef<HTMLButtonElement | null>(null)
  const workspace = useRef<HTMLElement>(null)
  const heading = useRef<HTMLDivElement>(null)
  const habits = getHabitsForMonth(state, month)
  const dense = habits.length >= 7
  const empty = habits.length === 0
  const titleWords = state.title.split(' ')
  const titleLastWord = titleWords.pop()
  const isCurrentMonth = today.getFullYear() === month.year && today.getMonth() === month.month
  const panelShown = phase === 'open' || phase === 'exit'
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
  }, [authReady, state.title])

  useEffect(() => {
    const interval = setInterval(() => setToday(new Date()), 60_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (phase === 'closed' || phase === 'open') return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const delay = phase === 'out' ? SWEEP_OUT_DURATION : phase === 'exit' ? PANEL_EXIT_DURATION : SWEEP_IN_DURATION
    const timer = setTimeout(() => {
      if (phase === 'out') {
        setPhase('open')
      } else if (phase === 'exit') {
        setPhase('in')
      } else {
        setPhase('closed')
        setPanel(null)
      }
    }, reduced ? 0 : delay)
    return () => clearTimeout(timer)
  }, [phase])

  function openPanel(kind: PanelKind) {
    setLockReminderVisible(false)
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

  function closeFlash() {
    setFlashActive(false)
    requestAnimationFrame(() => flashOpener.current?.focus({ preventScroll: true }))
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
          state.title ? '' : 'no-title',
          phase === 'out' ? 'is-sweeping-out' : '',
          panelShown ? 'is-panel-open' : '',
          phase === 'in' ? 'is-sweeping-in' : '',
        ].join(' ')}
        style={{ '--sweep-stagger': `${SWEEP_STAGGER}ms` } as CSSProperties}
        inert={flashActive}
      >
        <div className="ambient-grid" aria-hidden="true" />
        <div className="page-grain" aria-hidden="true" />
        <header className="page-header">
          <div className="header-left">
            <Brand onHome={() => setMonth({ year: today.getFullYear(), month: today.getMonth() })} />
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
              className="social-trigger"
              onClick={() => openPanel('social')}
              aria-label={account ? `Open profiles and account for ${account.username}` : 'Search public profiles or sign in'}
              aria-expanded={panel === 'social' && (phase === 'out' || phase === 'open')}
            >
              <UsersRound size={19} strokeWidth={1.35} />
              <span className="social-hint" aria-hidden="true">
                {!authReady ? 'Restoring account' : account ? `@${account.username}` : 'Find your people'}
              </span>
            </button>
          </div>
        </header>

        <main className="workspace" ref={workspace}>
          {state.title && (
            <div
              ref={heading}
              className={`hero-heading sweep-item ${state.title.length > 30 ? 'is-long' : ''}`}
              style={sweep(TEXT_SWEEP.heroHeading)}
            >
              <p className="eyebrow"><span /> A LITTLE BETTER, EVERY DAY.</p>
              <h1>
                {titleWords.length > 0 && <span>{titleWords.join(' ')} </span>}
                <em>{titleLastWord}</em>
              </h1>
              <p className="hero-subtitle">Less thinking. More showing up.</p>
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
                <h2>Every routine starts <em>somewhere.</em></h2>
                <p>One small habit is all it takes.</p>
                <button onClick={() => openPanel('settings')}><Plus size={16} /> Add your first habit</button>
              </div>
            ) : (
              <div className="tracker-month-frame" key={`${monthKey(month)}-${habits.map((habit) => habit.id).join('-')}`}>
                <CircularTracker state={state} month={month} today={today} onToggle={toggle} />
              </div>
            )}
          </div>

          <aside className="intention-note sweep-item" style={sweep(TEXT_SWEEP.intentionNote)} aria-hidden="true">
            <span className="small-cross">+</span>
            <p>Not perfect.<br /><em>Just consistent.</em></p>
            <span className="note-caption">THAT&apos;S THE WHOLE IDEA.</span>
          </aside>
          <aside
            className={`day-note sweep-item ${lockReminderVisible ? 'is-hidden' : ''}`}
            style={sweep(TEXT_SWEEP.dayNote)}
            aria-hidden={lockReminderVisible}
          >
            <div className="day-note-heading"><span />{isCurrentMonth ? 'TODAY IS A GOOD DAY' : 'ONE DAY AT A TIME'}</div>
            <p className="day-counter">{isCurrentMonth ? String(today.getDate()).padStart(2, '0') : String(daysInMonth(month)).padStart(2, '0')}<span> / {daysInMonth(month)}</span></p>
            <p className="day-note-copy">{isCurrentMonth ? <>A small step today.<br />A different you tomorrow.</> : <>A little intention.<br />A whole lot of possibility.</>}</p>
            <span className="day-note-line" />
          </aside>
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
            paused={phase !== 'closed' || flashActive}
            visible={lockReminderVisible}
            onVisibilityChange={setLockReminderVisible}
          />
        </main>

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
              <SocialPanel
                account={account}
                busy={authBusy}
                error={authError}
                syncLabel={syncLabel.toLowerCase()}
                onClose={closePanel}
                onLogin={login}
                onSignup={signup}
                onLogout={logout}
                onVisibilityChange={setProfilePublic}
              />
            )}
          </div>
        )}

        <footer className="page-footer">
          <div className="footer-guide sweep-item" style={sweep(TEXT_SWEEP.footerGuide)}>
            <div className="legend" aria-label="Cell legend">
              <span><i className="legend-done" /> Done</span>
              <span><i className="legend-undone" /> Not yet</span>
              <span><i className="legend-unavailable" /> Not available</span>
            </div>
            <p>Click a cell. Keep a promise.</p>
          </div>
          <div className="month-nav-slot sweep-item" style={sweep(TEXT_SWEEP.monthNavigation)}>
            <MonthPicker month={month} today={today} onChange={setMonth} />
          </div>
          <div className="footer-signoff sweep-item" style={sweep(TEXT_SWEEP.footerSignoff)}>
            {state.isDemo ? (
              <button className="demo-label" onClick={() => openPanel('settings')}>
                SAMPLE PROGRESS <ArrowUpRight size={12} strokeWidth={1.5} />
              </button>
            ) : (
              <span className={`saved-label sync-${syncStatus}`}><Check size={12} /> {syncLabel}</span>
            )}
            <p>Little by little, a little becomes a lot.</p>
          </div>
        </footer>
        {(storageError || syncError) && <p className="storage-warning" role="alert">{storageError || syncError}</p>}
      </div>
      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
      {flashActive && <FlashReminder message={flashMessage} onClose={closeFlash} />}
      <CustomCursor rejection={cursorRejection} />
    </>
  )
}

export default App

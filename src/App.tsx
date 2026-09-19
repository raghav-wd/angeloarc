import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, Plus, SlidersHorizontal, UsersRound } from 'lucide-react'
import { Brand } from './components/Brand'
import { CircularTracker } from './components/CircularTracker'
import { CustomCursor } from './components/CustomCursor'
import type { CursorFeedback, CursorRejection } from './components/CustomCursor'
import { LockReminder } from './components/LockReminder'
import { MonthPicker } from './components/MonthPicker'
import { SettingsDialog } from './components/SettingsDialog'
import type { RoutineChanges } from './components/SettingsDialog'
import { SocialDialog } from './components/SocialDialog'
import { useTrackerState } from './hooks/useTrackerState'
import { dateKey, daysInMonth, formatFullDate, isFutureDate, monthKey, reconcileHabits, toggleCompletion } from './lib/tracker'
import type { Habit, Month } from './lib/tracker'
import './App.css'

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
  const [activeDialog, setActiveDialog] = useState<'settings' | 'social' | null>(null)
  const [lockReminderVisible, setLockReminderVisible] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [toast, setToast] = useState('')
  const [cursorRejection, setCursorRejection] = useState<CursorRejection | null>(null)
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const settingsOpener = useRef<HTMLButtonElement | null>(null)
  const socialOpener = useRef<HTMLButtonElement | null>(null)
  const focusAfterDialog = useRef<HTMLButtonElement | null>(null)
  const workspace = useRef<HTMLElement>(null)
  const heading = useRef<HTMLDivElement>(null)
  const dense = state.habits.length >= 7
  const empty = state.habits.length === 0
  const titleWords = state.title.split(' ')
  const titleLastWord = titleWords.pop()
  const isCurrentMonth = today.getFullYear() === month.year && today.getMonth() === month.month
  const settingsOpen = activeDialog === 'settings'
  const dialogOpen = activeDialog !== null
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
  }, [state.title])

  useEffect(() => {
    const interval = setInterval(() => setToday(new Date()), 60_000)
    return () => {
      clearInterval(interval)
      clearTimeout(toastTimeout.current)
    }
  }, [])

  useEffect(() => {
    if (activeDialog !== null || !focusAfterDialog.current) return
    const target = focusAfterDialog.current
    focusAfterDialog.current = null
    requestAnimationFrame(() => target.focus({ preventScroll: true }))
  }, [activeDialog])

  function openSettings(opener: HTMLButtonElement) {
    setLockReminderVisible(false)
    settingsOpener.current = opener
    setActiveDialog('settings')
  }

  function closeSettings() {
    focusAfterDialog.current = settingsOpener.current
    setActiveDialog(null)
  }

  function closeSocial() {
    focusAfterDialog.current = socialOpener.current
    setActiveDialog(null)
  }

  function saveRoutine(changes: RoutineChanges) {
    setState((previous) => ({
      ...reconcileHabits(previous, changes.habits),
      title: changes.title,
      ...(changes.clearProgress ? { completions: {}, isDemo: false } : {}),
    }))
    closeSettings()
    setToast(changes.clearProgress ? "A clean slate. You've got this." : 'Your routine, refined.')
    clearTimeout(toastTimeout.current)
    toastTimeout.current = setTimeout(() => setToast(''), 3200)
  }

  function toggle(day: number, habit: Habit, feedback: CursorFeedback): boolean {
    const now = new Date()
    if (isFutureDate(month, day, now)) {
      setCursorRejection((previous) => ({ ...feedback, id: (previous?.id ?? 0) + 1 }))
      setAnnouncement(`${habit.name} is locked until ${formatFullDate(month, day)}. You can only update today or earlier.`)
      return false
    }
    setState((previous) => toggleCompletion(previous, month, day, habit.id, now))
    const wasDone = state.completions[dateKey(month, day)]?.includes(habit.id)
    setAnnouncement(`${habit.name}, day ${day}, marked ${wasDone ? 'not done' : 'done'}.`)
    return true
  }

  return (
    <>
      <div className={`app ${dense ? 'is-dense' : ''} ${state.title ? '' : 'no-title'}`} inert={dialogOpen}>
        <div className="ambient-grid" aria-hidden="true" />
        <div className="page-grain" aria-hidden="true" />
        <header className="page-header">
          <div className="header-left">
            <Brand onHome={() => setMonth({ year: today.getFullYear(), month: today.getMonth() })} />
          </div>
          <div className="header-actions">
            <button
              className="settings-trigger"
              onClick={(event) => openSettings(event.currentTarget)}
              aria-label="Open settings"
              aria-haspopup="dialog"
            >
              <SlidersHorizontal size={20} strokeWidth={1.4} />
              <span className="settings-hint" aria-hidden="true">Make it yours</span>
            </button>
            <button
              className="social-trigger"
              onClick={(event) => {
                setLockReminderVisible(false)
                socialOpener.current = event.currentTarget
                setActiveDialog('social')
              }}
              aria-label={account ? `Open profiles and account for ${account.username}` : 'Search public profiles or sign in'}
              aria-haspopup="dialog"
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
            <div ref={heading} className={`hero-heading ${state.title.length > 30 ? 'is-long' : ''}`}>
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
              <div className="empty-tracker">
                <svg viewBox="0 0 100 100" aria-hidden="true">
                  <path d="M50 8A42 42 0 1 1 8 50" />
                  <path d="M50 19A31 31 0 1 1 19 50" />
                  <path d="M50 30A20 20 0 1 1 30 50" />
                </svg>
                <h2>Every routine starts <em>somewhere.</em></h2>
                <p>One small habit is all it takes.</p>
                <button onClick={(event) => openSettings(event.currentTarget)}><Plus size={16} /> Add your first habit</button>
              </div>
            ) : (
              <div className="tracker-month-frame" key={`${monthKey(month)}-${state.habits.length}`}>
                <CircularTracker state={state} month={month} today={today} onToggle={toggle} />
              </div>
            )}
          </div>

          <aside className="intention-note" aria-hidden="true">
            <span className="small-cross">+</span>
            <p>Not perfect.<br /><em>Just consistent.</em></p>
            <span className="note-caption">THAT&apos;S THE WHOLE IDEA.</span>
          </aside>
          <aside className={`day-note ${lockReminderVisible ? 'is-hidden' : ''}`} aria-hidden={lockReminderVisible}>
            <div className="day-note-heading"><span />{isCurrentMonth ? 'TODAY IS A GOOD DAY' : 'ONE DAY AT A TIME'}</div>
            <p className="day-counter">{isCurrentMonth ? String(today.getDate()).padStart(2, '0') : String(daysInMonth(month)).padStart(2, '0')}<span> / {daysInMonth(month)}</span></p>
            <p className="day-note-copy">{isCurrentMonth ? <>A small step today.<br />A different you tomorrow.</> : <>A little intention.<br />A whole lot of possibility.</>}</p>
            <span className="day-note-line" />
          </aside>
          <LockReminder
            paused={dialogOpen}
            visible={lockReminderVisible}
            onVisibilityChange={setLockReminderVisible}
          />
        </main>

        <footer className="page-footer">
          <div className="footer-guide">
            <div className="legend" aria-label="Cell legend">
              <span><i className="legend-done" /> Done</span>
              <span><i className="legend-undone" /> Not yet</span>
            </div>
            <p>Click a cell. Keep a promise.</p>
          </div>
          <MonthPicker month={month} today={today} onChange={setMonth} />
          <div className="footer-signoff">
            {state.isDemo ? (
              <button className="demo-label" onClick={(event) => openSettings(event.currentTarget)}>
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
      {toast && <div className="success-toast" role="status"><Check size={15} strokeWidth={1.5} /> {toast}</div>}
      {settingsOpen && (
        <SettingsDialog
          state={state}
          persistenceLabel={account ? syncLabel.toLowerCase() : 'Saved on this device.'}
          onClose={closeSettings}
          onSave={saveRoutine}
        />
      )}
      {activeDialog === 'social' && (
        <SocialDialog
          account={account}
          busy={authBusy}
          error={authError}
          syncLabel={syncLabel.toLowerCase()}
          onClose={closeSocial}
          onLogin={login}
          onSignup={signup}
          onLogout={logout}
          onVisibilityChange={setProfilePublic}
        />
      )}
      <CustomCursor rejection={cursorRejection} />
    </>
  )
}

export default App

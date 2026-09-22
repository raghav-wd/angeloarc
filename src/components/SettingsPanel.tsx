import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { ArrowRight, Check, ChevronLeft, ChevronRight, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { FLASH_REMINDER_MESSAGE } from '../lib/flashReminder'
import {
  MAX_HABITS,
  MAX_HABIT_NAME_LENGTH,
  MAX_REMINDERS,
  MAX_REMINDER_LENGTH,
  MAX_REMINDER_WORDS,
  MAX_TITLE_LENGTH,
  clearTrackerProgress,
  getHabitsForMonth,
  getReminderValidationError,
  monthKey,
  shiftMonth,
  updateHabitPlan,
} from '../lib/tracker'
import type { Habit, Month, TrackerState } from '../lib/tracker'

interface SettingsPanelProps {
  state: TrackerState
  today: Date
  persistenceLabel?: string
  onClose: () => void
  onStateChange: Dispatch<SetStateAction<TrackerState>>
}

const DEFAULT_TITLE = 'No Excuses Grind'

const monthFormatter = new Intl.DateTimeFormat('en', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

function monthFromDate(date: Date): Month {
  return { year: date.getFullYear(), month: date.getMonth() }
}

function monthFromKey(value: string): Month {
  return { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) - 1 }
}

function formatMonth(month: Month): string {
  const date = new Date(Date.UTC(2000, month.month, 1, 12))
  date.setUTCFullYear(month.year)
  return monthFormatter.format(date)
}

function editableHabits(state: TrackerState, month: Month): Habit[] {
  return getHabitsForMonth(state, month).map(({ id, name }) => ({ id, name }))
}

function validateHabits(habits: Habit[]): { habits: Habit[]; error: string } {
  if (habits.some((habit) => !habit.name.trim())) {
    return { habits, error: 'Each habit needs a name. Rename it or remove it to continue.' }
  }

  const normalized = habits.map((habit) => ({ ...habit, name: habit.name.trim() }))
  const names = normalized.map((habit) => habit.name.toLowerCase())
  if (new Set(names).size !== names.length) {
    return { habits, error: 'Each habit needs a different name.' }
  }

  return { habits: normalized, error: '' }
}

export function SettingsPanel({
  state,
  today,
  persistenceLabel = 'Saved on this device.',
  onClose,
  onStateChange,
}: SettingsPanelProps) {
  const currentMonth = monthFromDate(today)
  const firstMonth = monthFromKey(state.startedOn)
  const [selectedMonth, setSelectedMonth] = useState<Month>(currentMonth)
  const initialHabits = editableHabits(state, currentMonth)
  const [title, setTitle] = useState(state.title || DEFAULT_TITLE)
  const [showTitle, setShowTitle] = useState(Boolean(state.title))
  const [habits, setHabits] = useState<Habit[]>(initialHabits)
  const [newHabit, setNewHabit] = useState('')
  const [reminders, setReminders] = useState<string[]>(state.reminders)
  const [newReminder, setNewReminder] = useState('')
  const [error, setError] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [progressCleared, setProgressCleared] = useState(false)
  const committedTitle = useRef(state.title || DEFAULT_TITLE)
  const committedHabits = useRef(initialHabits)
  const committedReminders = useRef(state.reminders)
  const panel = useRef<HTMLElement>(null)
  const newHabitInput = useRef<HTMLInputElement>(null)
  const newReminderInput = useRef<HTMLInputElement>(null)
  const close = useEffectEvent(onClose)
  const selectedKey = monthKey(selectedMonth)
  const firstKey = monthKey(firstMonth)
  const currentKey = monthKey(currentMonth)
  const selectedMonthLabel = formatMonth(selectedMonth)
  const canGoBack = selectedKey > firstKey
  const canGoForward = selectedKey < currentKey

  useEffect(() => {
    const previousFocus = document.activeElement
    panel.current?.querySelector<HTMLButtonElement>('.modal-close')?.focus({ preventScroll: true })

    function keyboard(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }

    document.addEventListener('keydown', keyboard)
    return () => {
      document.removeEventListener('keydown', keyboard)
      if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  function commitTitle(nextTitle: string) {
    const normalized = nextTitle.trim()
    if (!normalized) return
    committedTitle.current = normalized
    onStateChange((previous) => {
      const active = previous.isDemo ? clearTrackerProgress(previous, today) : previous
      return active.title === normalized ? active : { ...active, title: normalized }
    })
  }

  function toggleTitle() {
    const nextVisible = !showTitle
    setShowTitle(nextVisible)
    setError('')
    if (!nextVisible) {
      onStateChange((previous) => {
        const active = previous.isDemo ? clearTrackerProgress(previous, today) : previous
        return active.title ? { ...active, title: '' } : active
      })
      return
    }

    const nextTitle = title.trim() || committedTitle.current || DEFAULT_TITLE
    setTitle(nextTitle)
    commitTitle(nextTitle)
  }

  function commitHabitDraft(nextDraft: Habit[]): boolean {
    setHabits(nextDraft)
    const result = validateHabits(nextDraft)
    if (result.error) return false

    committedHabits.current = result.habits
    onStateChange((previous) => updateHabitPlan(previous, selectedMonth, result.habits, today))
    return true
  }

  function settleHabitDraft() {
    const result = validateHabits(habits)
    if (result.error) {
      setHabits(committedHabits.current)
      setError(`${result.error} Your last saved names were restored.`)
      return
    }
    setHabits(result.habits)
  }

  function chooseMonth(nextMonth: Month) {
    const nextHabits = editableHabits(state, nextMonth)
    committedHabits.current = nextHabits
    setHabits(nextHabits)
    setSelectedMonth(nextMonth)
    setNewHabit('')
    setError('')
  }

  function addHabit() {
    const name = newHabit.trim()
    if (!name) {
      setError('Give your new habit a name first.')
      newHabitInput.current?.focus()
      return
    }
    if (habits.length >= MAX_HABITS) {
      setError('Nine habits is the limit. A little focus goes a long way.')
      return
    }

    const current = validateHabits(habits)
    if (current.error) {
      setError(`${current.error} Finish that edit before adding another habit.`)
      return
    }
    if (current.habits.some((habit) => habit.name.toLowerCase() === name.toLowerCase())) {
      setError('That habit is already in this routine.')
      newHabitInput.current?.focus()
      return
    }

    const nextHabits = [...current.habits, { id: crypto.randomUUID(), name }]
    commitHabitDraft(nextHabits)
    setNewHabit('')
    setError('')
    requestAnimationFrame(() => newHabitInput.current?.focus())
  }

  function removeHabit(habitId: string) {
    const nextHabits = committedHabits.current.filter((habit) => habit.id !== habitId)
    committedHabits.current = nextHabits
    setHabits(nextHabits)
    setError('')
    onStateChange((previous) => updateHabitPlan(previous, selectedMonth, nextHabits, today))
  }

  function commitReminderDraft(nextDraft: string[]) {
    setReminders(nextDraft)
    if (nextDraft.some((reminder) => getReminderValidationError(reminder))) return
    const normalized = nextDraft.map((reminder) => reminder.trim())
    committedReminders.current = normalized
    onStateChange((previous) => ({
      ...(previous.isDemo ? clearTrackerProgress(previous, today) : previous),
      reminders: normalized,
    }))
  }

  function settleReminderDraft() {
    const reminderError = reminders.map(getReminderValidationError).find(Boolean)
    if (reminderError) {
      setReminders(committedReminders.current)
      setError(`${reminderError} Your last saved reminders were restored.`)
      return
    }
    setReminders(reminders.map((reminder) => reminder.trim()))
  }

  function addReminder() {
    const text = newReminder.trim()
    if (!text) {
      setError('Give your new reminder a few words first.')
      newReminderInput.current?.focus()
      return
    }
    const reminderError = getReminderValidationError(text)
    if (reminderError) {
      setError(reminderError)
      newReminderInput.current?.focus()
      return
    }
    if (reminders.length >= MAX_REMINDERS) {
      setError('Ten reminders is plenty. Make each one count.')
      return
    }
    if (reminders.some((reminder) => getReminderValidationError(reminder))) {
      setError('Finish that reminder edit before adding another.')
      return
    }

    commitReminderDraft([...reminders.map((reminder) => reminder.trim()), text])
    setNewReminder('')
    setError('')
    requestAnimationFrame(() => newReminderInput.current?.focus())
  }

  function removeReminder(index: number) {
    commitReminderDraft(committedReminders.current.filter((_, position) => position !== index))
    setError('')
  }

  function clearProgress() {
    onStateChange((previous) => clearTrackerProgress(previous, today))
    setConfirmClear(false)
    setProgressCleared(true)
    setError('')
  }

  return (
    <section
      ref={panel}
      className="settings-panel"
      aria-labelledby="settings-heading"
      aria-describedby="settings-description"
    >
      <div className="settings-header">
        <div>
          <p className="eyebrow">A SPACE THAT&apos;S YOURS</p>
          <h2 id="settings-heading">Make it <em>personal.</em></h2>
          <p id="settings-description">Choose a month. Your changes save as you go.</p>
        </div>
        <button type="button" className="icon-button modal-close" aria-label="Close settings" onClick={onClose}>
          <X size={19} strokeWidth={1.5} />
        </button>
      </div>
      <form
        className="settings-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (newHabit.trim()) addHabit()
        }}
      >
        <div className="settings-body" data-scrollable>
          <section className="settings-section settings-month-section" aria-labelledby="routine-month-heading">
            <div className="settings-month-picker">
              <button
                type="button"
                className="settings-month-arrow"
                aria-label="Previous routine month"
                disabled={!canGoBack}
                onClick={() => chooseMonth(shiftMonth(selectedMonth, -1))}
              >
                <ChevronLeft size={17} strokeWidth={1.5} />
              </button>
              <div>
                <span id="routine-month-heading">ROUTINE FOR</span>
                <strong aria-live="polite">{selectedMonthLabel}</strong>
              </div>
              <button
                type="button"
                className="settings-month-arrow"
                aria-label="Next routine month"
                disabled={!canGoForward}
                onClick={() => chooseMonth(shiftMonth(selectedMonth, 1))}
              >
                <ChevronRight size={17} strokeWidth={1.5} />
              </button>
            </div>
            <p className="settings-month-note">
              Habit changes apply from {selectedMonthLabel} forward. New habits begin {selectedKey === currentKey ? 'today' : 'on the first day of this month'}.
            </p>
          </section>

          <section className="settings-section title-section">
            <div className="section-heading">
              <label htmlFor="routine-title">Your daily reminder</label>
              <button
                className="toggle"
                type="button"
                role="switch"
                aria-label="Show the main title"
                aria-checked={showTitle}
                onClick={toggleTitle}
              ><span /></button>
            </div>
            <input
              id="routine-title"
              className="title-input"
              value={title}
              disabled={!showTitle}
              maxLength={MAX_TITLE_LENGTH}
              onChange={(event) => {
                const nextTitle = event.target.value
                setTitle(nextTitle)
                setError('')
                commitTitle(nextTitle)
              }}
              onBlur={() => {
                if (!title.trim()) {
                  setTitle(committedTitle.current)
                  setError('Your reminder needs a few words. The last saved title was restored.')
                  return
                }
                setTitle(title.trim())
              }}
            />
            <p className="field-help">Your mantra, or nothing at all. A little white space is good, too.</p>
          </section>

          <section className="settings-section">
            <div className="section-heading">
              <h3>Your daily rituals</h3>
              <span className="habit-limit">{habits.length} <span>/ {MAX_HABITS}</span></span>
            </div>
            <div className="habit-editor-list">
              {habits.map((habit, index) => (
                <div className="habit-editor-row" key={habit.id}>
                  <span className="editor-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  <input
                    aria-label={`Habit ${index + 1}`}
                    value={habit.name}
                    maxLength={MAX_HABIT_NAME_LENGTH}
                    onChange={(event) => {
                      const nextHabits = habits.map((item) => item.id === habit.id
                        ? { ...item, name: event.target.value }
                        : item)
                      setError('')
                      commitHabitDraft(nextHabits)
                    }}
                    onBlur={settleHabitDraft}
                  />
                  <button
                    type="button"
                    className="remove-habit"
                    aria-label={`Remove ${habit.name || `habit ${index + 1}`} from ${selectedMonthLabel} onward`}
                    onClick={() => removeHabit(habit.id)}
                  >
                    <X size={15} strokeWidth={1.5} />
                  </button>
                </div>
              ))}
              {habits.length === 0 && <p className="empty-habits-hint">A blank slate. What will you show up for?</p>}
            </div>
            {habits.length < MAX_HABITS ? (
              <div className="add-habit-row">
                <input
                  ref={newHabitInput}
                  aria-label={`New habit name for ${selectedMonthLabel}`}
                  placeholder="Make room for a good habit..."
                  value={newHabit}
                  maxLength={MAX_HABIT_NAME_LENGTH}
                  onChange={(event) => {
                    setNewHabit(event.target.value)
                    setError('')
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addHabit()
                    }
                  }}
                />
                <button type="button" className="add-habit" aria-label="Add habit" onClick={addHabit}>
                  <Plus size={18} strokeWidth={1.4} />
                </button>
              </div>
            ) : (
              <p className="limit-note"><Check size={13} /> Nine is enough. Let&apos;s make them count.</p>
            )}
          </section>

          <section className="settings-section" aria-labelledby="reminders-heading">
            <div className="section-heading">
              <h3 id="reminders-heading">Your push reminders</h3>
              <span className="habit-limit">{reminders.length} <span>/ {MAX_REMINDERS}</span></span>
            </div>
            <div className="habit-editor-list">
              {reminders.map((reminder, index) => (
                <div className="habit-editor-row" key={index}>
                  <span className="editor-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  <input
                    aria-label={`Push reminder ${index + 1}`}
                    value={reminder}
                    maxLength={MAX_REMINDER_LENGTH}
                    onChange={(event) => {
                      const nextReminders = reminders.map((item, position) => (position === index ? event.target.value : item))
                      setError('')
                      commitReminderDraft(nextReminders)
                    }}
                    onBlur={settleReminderDraft}
                  />
                  <button
                    type="button"
                    className="remove-habit"
                    aria-label={`Remove push reminder ${index + 1}`}
                    onClick={() => removeReminder(index)}
                  >
                    <X size={15} strokeWidth={1.5} />
                  </button>
                </div>
              ))}
              {reminders.length === 0 && (
                <p className="empty-habits-hint">The eye falls back to the classic: {FLASH_REMINDER_MESSAGE}</p>
              )}
            </div>
            {reminders.length < MAX_REMINDERS ? (
              <div className="add-habit-row">
                <input
                  ref={newReminderInput}
                  aria-label="New push reminder"
                  placeholder="Words for the hard days..."
                  value={newReminder}
                  maxLength={MAX_REMINDER_LENGTH}
                  onChange={(event) => {
                    setNewReminder(event.target.value)
                    setError('')
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addReminder()
                    }
                  }}
                />
                <button type="button" className="add-habit" aria-label="Add push reminder" onClick={addReminder}>
                  <Plus size={18} strokeWidth={1.4} />
                </button>
              </div>
            ) : (
              <p className="limit-note"><Check size={13} /> Ten is plenty. Make each one count.</p>
            )}
            <p className="field-help">
              Click the eye on the home page and one of these flashes back, up to {MAX_REMINDER_WORDS} words each.
            </p>
          </section>

          <section className="reset-section">
            {progressCleared ? (
              <p className="reset-staged" role="status"><Check size={15} /> Your check-ins have been cleared.</p>
            ) : confirmClear ? (
              <div className="reset-confirmation">
                <p>Clear all check-ins, for every month?</p>
                <span>Your habits and title will stay. This saves immediately.</span>
                <div>
                  <button type="button" onClick={() => setConfirmClear(false)}>Keep my progress</button>
                  <button type="button" className="confirm-clear" onClick={clearProgress}>
                    <Trash2 size={12} /> Clear progress
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button type="button" className="reset-button" onClick={() => setConfirmClear(true)}>
                  <RotateCcw size={14} strokeWidth={1.4} />
                  {state.isDemo ? 'Clear sample progress' : 'Start with a clean slate'}
                  <ArrowRight size={14} strokeWidth={1.4} />
                </button>
                <p>{state.isDemo ? 'A little sample progress to show you around. Clear it to begin.' : 'A fresh start clears check-ins across all months.'}</p>
              </>
            )}
          </section>
          {error && <p className="settings-error" role="alert">{error}</p>}
        </div>
        <div className="settings-footer">
          <div className="settings-autosave">
            <Check size={14} strokeWidth={1.6} aria-hidden="true" />
            <span><strong>Changes save automatically.</strong> {persistenceLabel}</span>
          </div>
        </div>
      </form>
    </section>
  )
}

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { ArrowRight, Check, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { MAX_HABITS, MAX_HABIT_NAME_LENGTH, MAX_TITLE_LENGTH } from '../lib/tracker'
import type { Habit, TrackerState } from '../lib/tracker'

export interface RoutineChanges {
  title: string
  habits: Habit[]
  clearProgress: boolean
}

interface SettingsDialogProps {
  state: TrackerState
  persistenceLabel?: string
  onClose: () => void
  onSave: (changes: RoutineChanges) => void
}

export function SettingsDialog({ state, persistenceLabel = 'Saved on this device.', onClose, onSave }: SettingsDialogProps) {
  const [title, setTitle] = useState(state.title || 'No Excuses Grind')
  const [showTitle, setShowTitle] = useState(Boolean(state.title))
  const [habits, setHabits] = useState(() => state.habits.map((habit) => ({ ...habit })))
  const [newHabit, setNewHabit] = useState('')
  const [error, setError] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearProgress, setClearProgress] = useState(false)
  const dialog = useRef<HTMLDivElement>(null)
  const newHabitInput = useRef<HTMLInputElement>(null)
  const close = useEffectEvent(onClose)

  useEffect(() => {
    const previousFocus = document.activeElement
    dialog.current?.querySelector<HTMLButtonElement>('.modal-close')?.focus({ preventScroll: true })

    function keyboard(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
      if (event.key !== 'Tab') return
      const elements = dialog.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
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
      if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true })
    }
  }, [])

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
    if (habits.some((habit) => habit.name.trim().toLowerCase() === name.toLowerCase())) {
      setError('That habit is already in your routine.')
      newHabitInput.current?.focus()
      return
    }
    setHabits([...habits, { id: crypto.randomUUID(), name }])
    setNewHabit('')
    setError('')
    requestAnimationFrame(() => {
      const nextInput = newHabitInput.current ?? dialog.current?.querySelector<HTMLButtonElement>('.save-routine')
      nextInput?.focus()
    })
  }

  function save() {
    if (habits.some((habit) => !habit.name.trim())) {
      setError('Each habit needs a name. Rename it or remove it before saving.')
      return
    }
    const names = habits.map((habit) => habit.name.trim().toLowerCase())
    if (new Set(names).size !== names.length) {
      setError('Each habit needs a different name.')
      return
    }
    if (showTitle && !title.trim()) {
      setError('Add a title, or switch it off for a quieter space.')
      return
    }
    if (newHabit.trim()) {
      setError('Your new habit is not added yet. Press the plus button, or clear the field.')
      newHabitInput.current?.focus()
      return
    }
    onSave({
      title: showTitle ? title.trim() : '',
      habits: habits.map((habit) => ({ ...habit, name: habit.name.trim() })),
      clearProgress,
    })
  }

  return (
    <div
      className="modal-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialog}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-heading"
        aria-describedby="settings-description"
      >
        <div className="settings-header">
          <div>
            <p className="eyebrow">A SPACE THAT&apos;S YOURS</p>
            <h2 id="settings-heading">Make it <em>personal.</em></h2>
            <p id="settings-description">Small habits. On your terms.</p>
          </div>
          <button className="icon-button modal-close" aria-label="Close settings" onClick={onClose}>
            <X size={19} strokeWidth={1.5} />
          </button>
        </div>
        <form
          className="settings-form"
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <div className="settings-body" data-scrollable>
            <section className="settings-section title-section">
              <div className="section-heading">
                <label htmlFor="routine-title">Your daily reminder</label>
                <button
                  className="toggle"
                  type="button"
                  role="switch"
                  aria-label="Show the main title"
                  aria-checked={showTitle}
                  onClick={() => {
                    setShowTitle(!showTitle)
                    setError('')
                  }}
                ><span /></button>
              </div>
              <input
                id="routine-title"
                className="title-input"
                value={title}
                disabled={!showTitle}
                maxLength={MAX_TITLE_LENGTH}
                onChange={(event) => {
                  setTitle(event.target.value)
                  setError('')
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
                        setHabits(habits.map((item) => item.id === habit.id ? { ...item, name: event.target.value } : item))
                        setError('')
                      }}
                    />
                    <button
                      type="button"
                      className="remove-habit"
                      aria-label={`Remove ${habit.name || `habit ${index + 1}`}`}
                      onClick={() => {
                        setHabits(habits.filter((item) => item.id !== habit.id))
                        setError('')
                      }}
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
                    aria-label="New habit name"
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

            <section className="reset-section">
              {clearProgress ? (
                <p className="reset-staged"><Check size={15} /> A fresh start is ready. Save to clear your check-ins.</p>
              ) : confirmClear ? (
                <div className="reset-confirmation">
                  <p>Clear all check-ins, for every month?</p>
                  <span>Your habits and title will stay.</span>
                  <div>
                    <button type="button" onClick={() => setConfirmClear(false)}>Keep my progress</button>
                    <button type="button" className="confirm-clear" onClick={() => setClearProgress(true)}>
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
            <span>Just you. {persistenceLabel}</span>
            <button className="save-routine" type="submit">Save my routine <ArrowRight size={16} strokeWidth={1.5} /></button>
          </div>
        </form>
      </div>
    </div>
  )
}

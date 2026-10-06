import { Fragment, useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import '@fontsource-variable/caveat'
import { clampOnboardingStep, confettiPieces, ONBOARDING_STEPS } from '../../lib/onboarding'
import { AnriIcon } from '../AnriIcon'
import { AnriMascot } from './AnriMascot'
import type { AnriPose } from './AnriMascot'
import { Confetti } from './Confetti'
import type { ConfettiBurst } from './Confetti'
import {
  ArcHalo,
  Arrow,
  Checkbox,
  CurlyArrow,
  DoubleUnderline,
  Heart,
  LoopArrow,
  PaperPlane,
  QuestionMark,
  RoughCircle,
  Sparkle,
  Spiral,
  Squiggle,
  Star,
  StrikeThrough,
  Swoosh,
} from './Doodles'
import { WeekArc } from './WeekArc'
import './Onboarding.css'

export type OnboardingSource = 'welcome' | 'replay'
type Exit = 'skip' | 'complete'

const LAST_STEP = ONBOARDING_STEPS - 1
const PAGE_TURN = 560
const COMPLETE_HOLD = 560
const BURST_LIFE = 1700
const STEP_NAMES = ['Why bother', 'How it works', 'Your first week'] as const

const ACTIONS = [
  { label: 'Read 10 pages', goal: 'a sharper mind' },
  { label: 'Move your body', goal: 'a stronger me' },
  { label: '1 hour of deep work', goal: 'ship my side project' },
] as const

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function delay(ms: number): CSSProperties {
  return { '--delay': `${ms}ms` } as CSSProperties
}

function draw(ms: number, duration?: number): CSSProperties {
  return {
    '--draw-delay': `${ms}ms`,
    ...(duration ? { '--draw-duration': `${duration}ms` } : {}),
  } as CSSProperties
}

function Words({ text, from, gap = 55 }: { text: string; from: number; gap?: number }) {
  const words = text.split(' ')
  return (
    <>
      {words.map((word, index) => (
        <Fragment key={index}>
          <span className="ob-word" style={delay(from + index * gap)}>{word}</span>
          {index < words.length - 1 ? ' ' : null}
        </Fragment>
      ))}
    </>
  )
}

interface SlideProps {
  titleId: string
  active: boolean
}

const PROBLEM_POSES: readonly AnriPose[] = ['tired', 'thinking', 'excited']
const PROBLEM_LINES = ['ugh… broke my streak. again.', 'there has to be a better way…', 'wait, just one week? deal!']
const PROBLEM_POKES = ["hi! I'm Anri.", 'hehe, that tickles!', 'keep reading!']

function ProblemSlide({ titleId, active }: SlideProps) {
  const [beat, setBeat] = useState(() => (prefersReducedMotion() ? 2 : 0))
  const [speaking, setSpeaking] = useState(prefersReducedMotion)

  // Anri lives the copy: worn out, then puzzled, then all in.
  useEffect(() => {
    if (!active || prefersReducedMotion()) return
    const timers = [
      setTimeout(() => setSpeaking(true), 900),
      setTimeout(() => setBeat(1), 1750),
      setTimeout(() => setBeat(2), 3050),
    ]
    return () => timers.forEach(clearTimeout)
  }, [active])

  return (
    <div className="ob-problem">
      <div className="ob-problem-copy">
        <p className="ob-eyebrow ob-rise" style={delay(150)}><span aria-hidden="true" />A QUICK HELLO</p>
        <h2 id={titleId} className="ob-title">
          <Words text="Tired of being" from={280} />{' '}
          <span className="ob-word ob-inconsistent" style={delay(445)}>
            <em>inconsistent?</em>
            <Squiggle className="ob-inconsistent-line ob-boil" style={draw(1050, 760)} />
          </span>
        </h2>
        <p className="ob-lede">
          <Words text="Can't find a system that helps you stay motivated?" from={1750} gap={42} />
        </p>
        <div className="ob-punch-row">
          <p className="ob-punch ob-rise" style={delay(3050)}>
            Try <mark className="ob-highlight" style={delay(3300)}>Angelo Arc for a week</mark> then.
          </p>
          <p className="ob-deal" aria-hidden="true">
            <CurlyArrow className="ob-deal-arrow ob-boil" style={draw(3950, 620)} />
            <span className="ob-write" style={delay(4350)}>just 7 days. deal?</span>
          </p>
        </div>
      </div>
      <div className="ob-problem-art">
        <ArcHalo className="ob-problem-halo ob-boil" style={draw(250, 1300)} />
        {beat === 1 && (
          <span className="ob-thought" aria-hidden="true">
            <QuestionMark className="ob-thought-a ob-boil" />
            <QuestionMark className="ob-thought-b ob-boil" style={draw(180)} />
          </span>
        )}
        {beat === 2 && (
          <span className="ob-spark" aria-hidden="true">
            <Sparkle className="ob-spark-a ob-boil" />
            <Star className="ob-spark-b ob-boil" style={draw(120)} />
            <Sparkle className="ob-spark-c ob-boil" style={draw(220)} />
          </span>
        )}
        <AnriMascot
          className="ob-problem-anri"
          pose={PROBLEM_POSES[beat]}
          poses={PROBLEM_POSES}
          bubble={speaking ? PROBLEM_LINES[beat] : null}
          bubbleSide="left"
          pokeLines={PROBLEM_POKES}
        />
      </div>
    </div>
  )
}

const SYSTEM_POSES: readonly AnriPose[] = ['writing', 'cheer']
const SYSTEM_REACTIONS = ['one down!', 'ooh, keep going!', "that's it! see? easy."]
const SYSTEM_POKES = ['psst, tick a box!', "shh, I'm writing!", 'hehe!']

interface SystemSlideProps extends SlideProps {
  done: readonly boolean[]
  onToggle: (index: number) => void
  onCelebrate: (element: Element | null) => void
}

function SystemSlide({ titleId, active, done, onToggle, onCelebrate }: SystemSlideProps) {
  const week = useRef<HTMLDivElement>(null)
  const [line, setLine] = useState<string | null>(null)
  const count = done.filter(Boolean).length
  const complete = count === ACTIONS.length

  useEffect(() => {
    if (!active) return
    const timer = setTimeout(
      () => setLine((current) => current ?? "here's my list for today!"),
      prefersReducedMotion() ? 0 : 1700,
    )
    return () => clearTimeout(timer)
  }, [active])

  function tick(index: number) {
    const checking = !done[index]
    const nextCount = count + (checking ? 1 : -1)
    onToggle(index)
    setLine(checking ? SYSTEM_REACTIONS[nextCount - 1] : 'no worries, undo is fine too.')
    if (checking && nextCount === ACTIONS.length) onCelebrate(week.current)
  }

  return (
    <div className={`ob-system ${complete ? 'is-complete' : ''}`}>
      <header className="ob-system-head">
        <p className="ob-eyebrow ob-rise" style={delay(120)}><span aria-hidden="true" />HOW IT WORKS</p>
        <h2 id={titleId} className="ob-title ob-title-compact">
          <Words text="Here's the" from={240} />{' '}
          <span className="ob-word" style={delay(350)}><em>whole</em></span>{' '}
          <Words text="system." from={410} />
        </h2>
      </header>
      <div className="ob-blocks">
        <article className="ob-card ob-card-list" style={delay(380)} aria-labelledby={`${titleId}-a`}>
          <span className="ob-tape" aria-hidden="true" />
          <p className="ob-card-label">
            <span className="ob-badge" aria-hidden="true">A<RoughCircle style={draw(820)} /></span>
            LIST
          </p>
          <h3 id={`${titleId}-a`}>List your daily actions that align with your goals.</h3>
          <ul className="ob-list">
            {ACTIONS.map((action, index) => (
              <li key={action.label} style={{ ...delay(1050 + index * 280), ...draw(1050 + index * 280, 420) }}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={done[index]}
                  className={`ob-action ${done[index] ? 'is-done' : ''}`}
                  onClick={() => tick(index)}
                >
                  <span className="ob-action-index" aria-hidden="true">{`0${index + 1}`}</span>
                  <Checkbox checked={done[index]} />
                  <span className="ob-action-text">
                    <span className="ob-action-label">{action.label}<StrikeThrough /></span>
                    <span className="ob-action-goal">
                      <span aria-hidden="true">→ </span>
                      <span className="sr-only">, toward </span>
                      {action.goal}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className={`ob-try ${count > 0 ? 'is-gone' : ''}`} aria-hidden="true">
            <Arrow className="ob-try-arrow ob-boil" style={draw(2750, 520)} />
            <span><span className="ob-try-lead">try it, </span>tick one!</span>
          </p>
        </article>
        <LoopArrow className="ob-blocks-arrow ob-boil" style={draw(1600, 760)} />
        <article className="ob-card ob-card-track" style={delay(760)} aria-labelledby={`${titleId}-b`}>
          <span className="ob-tape" aria-hidden="true" />
          <p className="ob-card-label">
            <span className="ob-badge" aria-hidden="true">B<RoughCircle style={draw(1180)} /></span>
            COMMIT &amp; TRACK
          </p>
          <h3 id={`${titleId}-b`}>Commit daily to finish as many action items as you can, and track them here.</h3>
          <div ref={week} className="ob-week-wrap">
            <WeekArc done={done} />
            {complete && <p className="ob-week-note" aria-hidden="true">6 more days to go!</p>}
          </div>
          <p className={`ob-thats-it ${complete ? 'is-cheering' : ''}`}>
            That&apos;s it.
            <DoubleUnderline className="ob-boil" style={draw(2650, 520)} />
          </p>
        </article>
        <AnriMascot
          className="ob-system-anri"
          pose={complete ? 'cheer' : 'writing'}
          poses={SYSTEM_POSES}
          bubble={line}
          bubbleSide="right"
          pokeLines={SYSTEM_POKES}
        />
      </div>
    </div>
  )
}

const SENDOFF_POSES: readonly AnriPose[] = ['wave', 'point', 'cheer']
const SENDOFF_POKES = ['pinky promise?', 'see you tomorrow too!', 'hehe!']

interface SendOffSlideProps extends SlideProps {
  finishing: boolean
  cta: RefObject<HTMLButtonElement | null>
  onContinue: () => void
}

function SendOffSlide({ titleId, active, finishing, cta, onContinue }: SendOffSlideProps) {
  const [aimed, setAimed] = useState(false)
  const [speaking, setSpeaking] = useState(prefersReducedMotion)

  useEffect(() => {
    if (!active || prefersReducedMotion()) return
    const timer = setTimeout(() => setSpeaking(true), 2400)
    return () => clearTimeout(timer)
  }, [active])

  const pose: AnriPose = finishing ? 'cheer' : aimed ? 'point' : 'wave'
  const bubble = finishing
    ? 'see you inside!'
    : aimed
      ? 'right this way!'
      : speaking ? 'one week. you and me?' : null

  return (
    <div className="ob-sendoff">
      <div className="ob-sendoff-art">
        <ArcHalo className="ob-sendoff-halo ob-boil" style={draw(300, 1300)} />
        <AnriMascot
          className="ob-sendoff-anri"
          pose={pose}
          poses={SENDOFF_POSES}
          bubble={bubble}
          bubbleSide="right"
          pokeLines={SENDOFF_POKES}
        />
      </div>
      <div className="ob-sendoff-copy">
        <p className="ob-eyebrow ob-rise" style={delay(120)}><span aria-hidden="true" />ONE LAST THING</p>
        <figure className="ob-quote" style={delay(280)}>
          <span className="ob-tape" aria-hidden="true" />
          <div className="ob-quote-paper">
            <span className="ob-quote-mark" aria-hidden="true">&ldquo;</span>
            <blockquote>
              <p>
                Once you learn to quit, it becomes a{' '}
                <span className="ob-quote-habit">habit<Swoosh className="ob-boil" style={draw(1250, 620)} /></span>.
              </p>
            </blockquote>
            <figcaption>Vince Lombardi</figcaption>
          </div>
        </figure>
        <h2 id={titleId} className="ob-title ob-title-compact ob-sendoff-title">
          <Words text="So let's make" from={1500} />{' '}
          <span className="ob-word" style={delay(1665)}><em>showing up</em></span>{' '}
          <Words text="the habit." from={1720} />
        </h2>
        <p className="ob-sendoff-sub ob-rise" style={delay(1950)}>One week. A few small promises. Starting today.</p>
        <div className="ob-cta-row ob-rise" style={delay(2150)}>
          <button
            ref={cta}
            type="button"
            className="ob-cta"
            onClick={onContinue}
            onPointerEnter={() => setAimed(true)}
            onPointerLeave={() => setAimed(false)}
            onFocus={(event) => setAimed(event.currentTarget.matches(':focus-visible'))}
            onBlur={() => setAimed(false)}
          >
            Continue to app
            <ArrowRight size={18} strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}

function Backdrop() {
  return (
    <div className="ob-backdrop" aria-hidden="true">
      <Spiral className="ob-bg ob-bg-spiral" style={draw(500, 1500)} />
      <Star className="ob-bg ob-bg-star" style={draw(800, 900)} />
      <Sparkle className="ob-bg ob-bg-sparkle" style={draw(1000, 700)} />
      <Heart className="ob-bg ob-bg-heart" style={draw(1200, 900)} />
      <PaperPlane className="ob-bg ob-bg-plane" style={draw(700, 1100)} />
      <Sparkle className="ob-bg ob-bg-sparkle-2" style={draw(1400, 700)} />
      <Star className="ob-bg ob-bg-star-2" style={draw(1600, 800)} />
      <span className="ob-bg-coffee" />
    </div>
  )
}

interface OnboardingProps {
  source: OnboardingSource
  // Where the guide tucks itself away: the replay control in the corner.
  dock: () => DOMRect | null
  onClose: () => void
}

export function Onboarding({ source, dock, onClose }: OnboardingProps) {
  const root = useRef<HTMLDivElement>(null)
  const cta = useRef<HTMLButtonElement>(null)
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null)
  const leanFrame = useRef(0)
  const burstCount = useRef(0)
  const closed = useRef(false)
  const titleBase = useId()
  const [step, setStep] = useState(0)
  const [leavingStep, setLeavingStep] = useState<number | null>(null)
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const [visits, setVisits] = useState<readonly number[]>(() => Array.from({ length: ONBOARDING_STEPS }, () => 0))
  const [done, setDone] = useState<readonly boolean[]>(() => ACTIONS.map(() => false))
  const [exit, setExit] = useState<Exit | null>(null)
  const [bursts, setBursts] = useState<readonly ConfettiBurst[]>([])
  const [dockRect, setDockRect] = useState<DOMRect | null>(null)
  const [boiling] = useState(() => !prefersReducedMotion())
  const findDock = useEffectEvent(dock)
  const finish = useEffectEvent(onClose)

  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    element.focus({ preventScroll: true })
    const rect = findDock()
    setDockRect(rect)
    if (source !== 'replay' || !rect || prefersReducedMotion()) return
    // Replays grow out of the corner control they were opened from.
    element.style.transformOrigin = `${rect.left + rect.width / 2}px ${rect.top + rect.height / 2}px`
    const animation = element.animate([
      { transform: 'scale(0.04) rotate(-12deg)', opacity: 0, borderRadius: '50%' },
      { transform: 'scale(0.6) rotate(-3deg)', opacity: 1, borderRadius: '42px', offset: 0.5 },
      { transform: 'none', opacity: 1, borderRadius: '0px' },
    ], { duration: 640, easing: 'cubic-bezier(0.2, 0.75, 0.25, 1)' })
    return () => animation.cancel()
  }, [source])

  useEffect(() => {
    const update = () => setDockRect(findDock())
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => () => cancelAnimationFrame(leanFrame.current), [])

  useEffect(() => {
    if (leavingStep === null) return
    const timer = setTimeout(() => setLeavingStep(null), prefersReducedMotion() ? 0 : PAGE_TURN)
    return () => clearTimeout(timer)
  }, [leavingStep])

  useEffect(() => {
    if (bursts.length === 0) return
    const timer = setTimeout(() => setBursts((current) => current.slice(1)), BURST_LIFE)
    return () => clearTimeout(timer)
  }, [bursts])

  // A page that disappears takes keyboard focus with it, so hand focus to
  // something on the page that just arrived.
  useEffect(() => {
    const element = root.current
    if (!element) return
    const focused = document.activeElement
    const lost = !(focused instanceof HTMLElement)
      || focused === document.body
      || !element.contains(focused)
      || focused.closest('.ob-slide:not(.is-current)') !== null
    if (!lost) return
    if (step === LAST_STEP && cta.current) cta.current.focus({ preventScroll: true })
    else element.focus({ preventScroll: true })
  }, [step])

  // On the way out the whole sheet folds itself into the replay control, so
  // people see where to find it again.
  useEffect(() => {
    if (!exit) return
    const element = root.current
    if (!element) return
    const reduced = prefersReducedMotion()
    let animation: Animation | undefined
    const timer = setTimeout(() => {
      const rect = findDock()
      if (reduced) {
        animation = element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' })
      } else if (rect) {
        element.style.transformOrigin = `${rect.left + rect.width / 2}px ${rect.top + rect.height / 2}px`
        animation = element.animate([
          { transform: 'none', opacity: 1, borderRadius: '0px' },
          { transform: 'scale(0.6) rotate(-3deg)', opacity: 1, borderRadius: '42px', offset: 0.45 },
          { transform: 'scale(0.04) rotate(-12deg)', opacity: 0, borderRadius: '50%' },
        ], { duration: 660, easing: 'cubic-bezier(0.55, 0, 0.3, 1)', fill: 'forwards' })
      } else {
        animation = element.animate([
          { opacity: 1, transform: 'none' },
          { opacity: 0, transform: 'scale(0.98)' },
        ], { duration: 260, fill: 'forwards' })
      }
      animation.finished.then(() => {
        if (closed.current) return
        closed.current = true
        finish()
      }, () => {})
    }, exit === 'complete' && !reduced ? COMPLETE_HOLD : 0)
    return () => {
      clearTimeout(timer)
      animation?.cancel()
    }
  }, [exit])

  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    // Captured before anything underneath can react: Escape here must not
    // also close a panel or the notes page behind the guide.
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      leave('skip')
      return
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    event.stopPropagation()
    go(step + (event.key === 'ArrowRight' ? 1 : -1))
  })

  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleKey(event)
    window.addEventListener('keydown', listener, true)
    return () => window.removeEventListener('keydown', listener, true)
  }, [])

  function go(target: number) {
    const next = clampOnboardingStep(target)
    if (next === step || exit) return
    setDirection(next > step ? 'forward' : 'back')
    setLeavingStep(step)
    setStep(next)
    setVisits((current) => current.map((count, index) => (index === next ? count + 1 : count)))
  }

  function celebrate(element: Element | null, count = 22) {
    if (!element || prefersReducedMotion()) return
    const rect = element.getBoundingClientRect()
    burstCount.current += 1
    const burst: ConfettiBurst = {
      id: burstCount.current,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      pieces: confettiPieces(count, Math.random),
    }
    setBursts((current) => [...current, burst])
  }

  function leave(kind: Exit) {
    if (exit) return
    setExit(kind)
    if (kind === 'complete') celebrate(cta.current, 28)
  }

  function toggleAction(index: number) {
    setDone((current) => current.map((value, position) => (position === index ? !value : value)))
  }

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse') return
    swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
  }

  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const start = swipe.current
    swipe.current = null
    if (!start || start.id !== event.pointerId) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.4) return
    go(step + (dx < 0 ? 1 : -1))
  }

  // Anri and the doodles lean a touch toward the pointer.
  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse') return
    const x = (event.clientX / window.innerWidth) * 2 - 1
    const y = (event.clientY / window.innerHeight) * 2 - 1
    cancelAnimationFrame(leanFrame.current)
    leanFrame.current = requestAnimationFrame(() => {
      root.current?.style.setProperty('--ob-px', x.toFixed(3))
      root.current?.style.setProperty('--ob-py', y.toFixed(3))
    })
  }

  return (
    <div
      ref={root}
      className={[
        'onboarding',
        `is-${source}`,
        `is-step-${step}`,
        direction === 'back' ? 'is-back' : '',
        exit ? 'is-leaving' : '',
      ].join(' ')}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${titleBase}-title-${step}`}
      tabIndex={-1}
      style={{ '--ob-step': step } as CSSProperties}
      onPointerDown={pointerDown}
      onPointerUp={pointerUp}
      onPointerCancel={() => { swipe.current = null }}
      onPointerMove={pointerMove}
    >
      <svg className="ob-defs" aria-hidden="true" focusable="false">
        <filter id="ob-boil" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3" result="noise">
            {boiling && <animate attributeName="seed" values="3;9;15" dur="0.48s" calcMode="discrete" repeatCount="indefinite" />}
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.6" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>

      <Backdrop />

      <header className="ob-top">
        <span className="ob-brand" aria-hidden="true">
          <span>AN</span>
          <svg viewBox="0 0 36 36"><path d="M18 3.7A14.3 14.3 0 1 1 3.7 18H17" /></svg>
          <span>ELO</span>
        </span>
        <span className="ob-top-note" aria-hidden="true">a 30-second hello</span>
        {step < LAST_STEP && (
          <button type="button" className="ob-skip" onClick={() => leave('skip')}>Skip intro</button>
        )}
      </header>

      <div className="ob-stage">
        {STEP_NAMES.map((name, index) => {
          const active = index === step
          const state = active ? 'is-current' : index === leavingStep ? 'is-leaving' : 'is-idle'
          const titleId = `${titleBase}-title-${index}`
          return (
            // A fresh key on every visit replays the page's entrance from the top.
            <section
              key={`${name}-${visits[index]}`}
              className={`ob-slide ${state}`}
              aria-hidden={!active}
              inert={!active}
            >
              {index === 0 && <ProblemSlide titleId={titleId} active={active} />}
              {index === 1 && (
                <SystemSlide titleId={titleId} active={active} done={done} onToggle={toggleAction} onCelebrate={celebrate} />
              )}
              {index === 2 && (
                <SendOffSlide
                  titleId={titleId}
                  active={active}
                  finishing={exit === 'complete'}
                  cta={cta}
                  onContinue={() => leave('complete')}
                />
              )}
            </section>
          )
        })}
      </div>

      {dockRect && (
        <div
          className={`ob-dock ${step === LAST_STEP && !exit ? 'is-shown' : ''}`}
          style={{ left: dockRect.left, top: dockRect.top, width: dockRect.width, height: dockRect.height }}
          aria-hidden="true"
        >
          <span className="ob-dock-icon"><AnriIcon size={17} strokeWidth={1.35} /></span>
          <RoughCircle className="ob-dock-ring ob-boil" />
          <span className="ob-dock-note">
            <span>replay me anytime!</span>
            <CurlyArrow className="ob-dock-arrow ob-boil" />
          </span>
        </div>
      )}

      <nav className="ob-nav" aria-label="Welcome guide">
        <button type="button" className="ob-back" onClick={() => go(step - 1)} disabled={step === 0}>
          <ArrowLeft size={15} strokeWidth={1.7} aria-hidden="true" />
          Back
        </button>
        <ol className="ob-dots">
          {STEP_NAMES.map((name, index) => (
            <li key={name}>
              <button
                type="button"
                className={`ob-dot ${index === step ? 'is-current' : ''} ${index < step ? 'is-past' : ''}`}
                onClick={() => go(index)}
                aria-label={`Step ${index + 1} of ${ONBOARDING_STEPS}: ${name}`}
                aria-current={index === step ? 'step' : undefined}
              >
                <RoughCircle />
                <span className="ob-dot-fill" />
              </button>
            </li>
          ))}
        </ol>
        {step < LAST_STEP ? (
          <button type="button" className="ob-next" onClick={() => go(step + 1)}>
            Next
            <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        ) : <span aria-hidden="true" />}
      </nav>

      <Confetti bursts={bursts} />
      <p className="sr-only" aria-live="polite">{`Step ${step + 1} of ${ONBOARDING_STEPS}: ${STEP_NAMES[step]}.`}</p>
    </div>
  )
}

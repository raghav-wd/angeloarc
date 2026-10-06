import { useCallback, useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Check, Plus, Trash2, X } from 'lucide-react'
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import { setCursorMode } from '../lib/cursorMode'
import { haptic } from '../lib/haptics'
import {
  BIN_DRAWING,
  BIN_RIM_LIFT,
  binArrival,
  binFit,
  binPlacement,
  binSinkDepth,
  DRAG_SLOP,
  HELD_LIFT,
  HOLD_DELAY,
  hopPose,
  isFlickToward,
  isOverBin,
  nearestWithin,
  PERSPECTIVE,
  planBinToss,
  project,
  releaseVelocity,
  stepFall,
  stepSpring,
  TOUCH_DRAG_SLOP,
  trimSamples,
  unproject,
} from '../lib/paperGesture'
import type { BinPlacement, Hop, PointerSample, Vec } from '../lib/paperGesture'
import {
  DROP_BOUNCE_DURATION,
  DROP_FALL_DURATION,
  exitDistance,
  groupRollDistance,
  layoutCluster,
  planDrop,
} from '../lib/paperLayout'
import type { BallDrop, ClusterArea, ClusterLayout, ClusterPoint } from '../lib/paperLayout'
import {
  computePaperFrame,
  createPaperFrame,
  createPaperMesh,
  createRandom,
  paintPaperFrame,
  randomRotation,
  rollRotation,
} from '../lib/paperMesh'
import type { PaperFrame, PaperMesh, Rotation } from '../lib/paperMesh'
import {
  countPaperNotesByKind,
  createPaperNoteDraft,
  isBlankPaperNote,
  matchesPaperNoteFilter,
  MAX_PAPER_NOTE_BODY_LENGTH,
  MAX_PAPER_NOTE_TITLE_LENGTH,
  MAX_PAPER_NOTES,
  PAPER_NOTE_KIND_LABELS,
  PAPER_NOTE_KIND_PLURALS,
  PAPER_NOTE_KINDS,
  paperNoteLabel,
} from '../lib/paperNotes'
import type { PaperNote, PaperNoteFilter, PaperNotes as PaperNoteList } from '../lib/paperNotes'
import { PaperBallIcon } from './PaperBallIcon'
import { PaperBin } from './PaperBin'
import { PaperCategories } from './PaperCategories'
import './PaperNotes.css'

export type PaperNotesPhase = 'arriving' | 'open' | 'leaving'

interface PaperNotesProps {
  phase: PaperNotesPhase
  notes: PaperNoteList
  /** Homepage layers to dissolve while the balls land; empty when the homepage is already away. */
  dissolveTargets: () => HTMLElement[]
  storageLabel: string
  onArrived: () => void
  onLeft: () => void
  onExit: () => void
  onSaveNote: (note: PaperNote) => void
  onDeleteNote: (id: string) => void
  onSwapNotes: (firstId: string, secondId: string) => void
  onRestoreNote: (note: PaperNote, index: number) => void
  onSheetChange: (open: boolean) => void
}

interface Viewport {
  width: number
  height: number
}

type Motion =
  | { kind: 'drop'; start: number; plan: BallDrop; landed: boolean; settled: boolean }
  | { kind: 'roll'; start: number; duration: number; from: ClusterPoint }
  | { kind: 'exit'; start: number; duration: number; from: ClusterPoint; to: ClusterPoint }
  /** Rolls in from off screen to its spot, when its kind is shown again. */
  | { kind: 'enter'; start: number; duration: number; from: ClusterPoint }
  /** Follows the pointer that picked it up. */
  | { kind: 'held' }
  /** Springs towards a point, or home when there is none, falling and bouncing as it goes. */
  | { kind: 'spring'; target: ClusterPoint | null; pointerType: string | null }
  /** A series of arcs through the air, ending at its spot or in the bin. */
  | {
      kind: 'hops'
      start: number
      hops: Hop[]
      index: number
      then: 'rest' | 'bin'
      /** Starts from the bottom of the bin, as a note that was put back. */
      emerge: boolean
      fit: number
      sinkDepth: number
      pointerType: string | null
    }
  /** Drops through the mouth of the bin and out of sight. */
  | { kind: 'sink'; start: number; duration: number; depth: number; fit: number; pointerType: string | null }

interface Body {
  id: string
  x: number
  y: number
  /** Height above the page; 0 is resting on it. */
  lift: number
  rotation: Rotation
  opacity: number
  /** Time and strength of the latest impact, for squash and stretch. */
  splatAt: number
  splatForce: number
  motion: Motion | null
  /** Speed across the page (px/ms) and of the lift, for springs and throws. */
  vx: number
  vy: number
  vlift: number
  /** How far it has dropped into the bin, in screen pixels. */
  sink: number
  /** Extra scale, to squeeze through the mouth of the bin. */
  shrink: number
  /** How much of its shadow shows; inside the bin it casts none. */
  shade: number
  /** Stretch along the direction it is travelling. */
  stretch: number
  stretchAngle: number
}

interface BallElements {
  slot: HTMLDivElement
  button: HTMLButtonElement
  body: HTMLElement
  shadow: HTMLElement
  canvas: HTMLCanvasElement
  frame: PaperFrame
  drawnRotation: Rotation | null
  drawnSize: number
  moving: boolean
}

/** How a ball sits among the others while it is handled; it decides what it is drawn over. */
type BallLayer = 'held' | 'flying' | 'inside' | 'target'

interface Gesture {
  id: string
  pointerId: number
  pointerType: string
  start: Vec
  pointer: Vec
  /** Carried clear of where it was picked up; until then letting go never throws it away. */
  travelled: boolean
  /** Where the ball was gripped, relative to its centre on screen. */
  grab: Vec
  samples: PointerSample[]
  held: boolean
  heldAt: number
  timer: ReturnType<typeof setTimeout> | undefined
  swapId: string | null
  overBin: boolean
}

interface Binned {
  note: PaperNote
  index: number
}

interface DissolvePatch {
  x: number
  y: number
  start: number
  radius: number
}

interface Dissolve {
  layers: HTMLElement[]
  patches: DissolvePatch[]
  origin: number
  sweepStart: number
  done: boolean
}

interface OpenSheet {
  id: string
  isNew: boolean
  origin: { x: number; y: number; radius: number; rotation: Rotation }
}

// Gives the trigger's squeeze a moment to play before the first ball falls.
const ARRIVAL_DELAY = 150
const START_LIFT = 1.75
const BOUNCE_LIFT = 0.2
const DISSOLVE_SWEEP = 430
const DISSOLVE_FEATHER = 26
const EXIT_DURATION = 580
const RELAYOUT_DURATION = 520
const FILTER_EXIT_DURATION = 660
const FILTER_ENTER_DURATION = 780
const FILTER_ENTER_DELAY = 230
const SWAP_HOP_DURATION = 280
const SINK_DURATION = 340
const UNDO_WINDOW = 6000
const RETURN_LINGER = 900
// How far a raised ball rises on screen per unit of lift, relative to its size.
const RISE = 0.9
const SHEET_TRAVEL = 400
const SHEET_UNFOLD_START = 110
const SHEET_UNFOLD = 1020
const SHEET_CRUMPLE = 640
const SHEET_RETURN = 430
const SHEET_LIFT = 1.45
const ORIGIN: ClusterPoint = { x: 0, y: 0 }

// The bin swallows a ball: it squats, springs up and wobbles back still.
const GULP: Keyframe[] = [
  { transform: 'translateY(0) scale(1, 1) rotate(0deg)' },
  { transform: 'translateY(3px) scale(1.08, 0.9) rotate(-2deg)', offset: 0.2 },
  { transform: 'translateY(-3px) scale(0.95, 1.06) rotate(2.5deg)', offset: 0.45 },
  { transform: 'translateY(0) scale(1.02, 0.98) rotate(-1deg)', offset: 0.7 },
  { transform: 'translateY(0) scale(1, 1) rotate(0deg)' },
]
const POOF: Keyframe[] = [
  { opacity: 0, transform: 'translateY(6px) scale(0.6)' },
  { opacity: 1, transform: 'translateY(-1px) scale(1)', offset: 0.35 },
  { opacity: 0, transform: 'translateY(-8px) scale(1.15)' },
]

const meshes = new Map<string, PaperMesh>()
const rotations = new Map<string, Rotation>()

function meshFor(id: string): PaperMesh {
  let mesh = meshes.get(id)
  if (!mesh) {
    mesh = createPaperMesh(id)
    meshes.set(id, mesh)
  }
  return mesh
}

function rotationFor(id: string): Rotation {
  let rotation = rotations.get(id)
  if (!rotation) {
    rotation = randomRotation(createRandom(`turn:${id}`))
    rotations.set(id, rotation)
  }
  return rotation
}

function createBody(id: string, x: number, y: number, extra: Partial<Body> = {}): Body {
  return {
    id,
    x,
    y,
    lift: 0,
    rotation: rotationFor(id),
    opacity: 1,
    splatAt: -Infinity,
    splatForce: 0,
    motion: null,
    vx: 0,
    vy: 0,
    vlift: 0,
    sink: 0,
    shrink: 1,
    shade: 1,
    stretch: 0,
    stretchAngle: 0,
    ...extra,
  }
}

/** Puts a ball back on the page plainly: no flight, squeeze or stretch left over. */
function ground(body: Body) {
  body.lift = 0
  body.vx = 0
  body.vy = 0
  body.vlift = 0
  body.sink = 0
  body.shrink = 1
  body.shade = 1
  body.stretch = 0
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount
const easeOutCubic = (value: number) => 1 - (1 - value) ** 3
const easeInCubic = (value: number) => value ** 3
const easeInOutCubic = (value: number) => (value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2)
const easeInOutSine = (value: number) => -(Math.cos(Math.PI * value) - 1) / 2

function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(() => ({ width: window.innerWidth, height: window.innerHeight }))
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  return viewport
}

// Mirrors the heading, category list and footer positions in PaperNotes.css.
function clusterArea(viewport: Viewport): ClusterArea {
  const compact = viewport.width <= 600
  const short = viewport.height <= 760
  return {
    width: viewport.width,
    height: viewport.height,
    top: compact ? 196 : short ? 134 : 166,
    bottom: viewport.height - (compact ? 156 : short ? 94 : 116),
    // Wide enough to clear the list of kinds on the left; the bin mirrors it on the right.
    inset: compact ? 50 : viewport.width <= 1099 ? 192 : 204,
  }
}

function sheetRect(viewport: Viewport) {
  const compact = viewport.width <= 700
  const width = compact
    ? Math.max(260, viewport.width - 28)
    : Math.min(1040, Math.max(560, viewport.width * 0.7))
  const height = compact
    ? Math.min(660, Math.max(320, viewport.height * 0.74))
    : Math.min(720, Math.max(380, viewport.height * 0.7))
  return {
    x: viewport.width / 2,
    y: viewport.height / 2 + (compact ? 6 : 10),
    width: Math.min(width, viewport.width - 16),
    height: Math.min(height, viewport.height - 32),
  }
}

/** Where a ball shows on screen: raised balls grow, drift from the middle and float above their shadow. */
function screenCenter(body: Body, viewport: Viewport, ball: number): Vec {
  const point = project(body, viewport)
  const rise = body.motion?.kind === 'drop' ? 0 : Math.max(0, body.lift) * ball * RISE
  return { x: point.x, y: point.y + body.sink - rise }
}

/** The spot on the page a ball must reach to arrive at the mouth of the bin. */
function binEntry(bin: BinPlacement, ball: number, viewport: Viewport) {
  const fit = binFit(bin, ball)
  const radius = (ball / 2) * (1 + BIN_RIM_LIFT) * fit
  const arrival = binArrival(bin, radius)
  const page = unproject({ x: arrival.x, y: arrival.y + BIN_RIM_LIFT * ball * RISE }, BIN_RIM_LIFT, viewport)
  return { page, fit, depth: binSinkDepth(radius, radius * 0.86) }
}

function drawBall(elements: BallElements, mesh: PaperMesh, rotation: Rotation, diameter: number) {
  const { canvas, frame } = elements
  const box = Math.ceil(diameter + 6)
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const pixels = Math.round(box * ratio)
  if (canvas.width !== pixels || canvas.height !== pixels) {
    canvas.width = pixels
    canvas.height = pixels
    canvas.style.width = `${box}px`
    canvas.style.height = `${box}px`
  }
  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, box, box)
  computePaperFrame(mesh, {
    x: box / 2,
    y: box / 2,
    radius: diameter / 2,
    width: 1,
    height: 1,
    unfold: 0,
    rotation,
  }, frame)
  paintPaperFrame(context, mesh, frame, 0)
  elements.drawnRotation = rotation
  elements.drawnSize = diameter
}

function applyDissolve(dissolve: Dissolve, now: number, viewport: Viewport): boolean {
  const elapsed = now - dissolve.origin
  const reach = Math.hypot(viewport.width, viewport.height)
  const sweep = easeInCubic(clamp01((elapsed - dissolve.sweepStart) / DISSOLVE_SWEEP))
  const mask = dissolve.patches.map((patch) => {
    const grown = patch.radius * easeOutCubic(clamp01((elapsed - patch.start) / 300))
    const radius = grown + reach * sweep
    const inner = Math.max(0, radius - DISSOLVE_FEATHER)
    return `radial-gradient(circle at ${patch.x.toFixed(1)}px ${patch.y.toFixed(1)}px, transparent ${inner.toFixed(1)}px, #000 ${radius.toFixed(1)}px)`
  }).join(', ')
  const opacity = String(1 - clamp01((elapsed - dissolve.sweepStart - DISSOLVE_SWEEP * 0.45) / (DISSOLVE_SWEEP * 0.55)))
  for (const { style } of dissolve.layers) {
    style.setProperty('-webkit-mask-image', mask)
    style.setProperty('mask-image', mask)
    style.setProperty('-webkit-mask-composite', 'source-in')
    style.setProperty('mask-composite', 'intersect')
    style.opacity = opacity
  }
  return elapsed >= dissolve.sweepStart + DISSOLVE_SWEEP
}

function clearDissolve(layers: readonly HTMLElement[]) {
  for (const { style } of layers) {
    style.removeProperty('-webkit-mask-image')
    style.removeProperty('mask-image')
    style.removeProperty('-webkit-mask-composite')
    style.removeProperty('mask-composite')
    style.removeProperty('opacity')
  }
}

export function PaperNotes({
  phase,
  notes,
  dissolveTargets,
  storageLabel,
  onArrived,
  onLeft,
  onExit,
  onSaveNote,
  onDeleteNote,
  onSwapNotes,
  onRestoreNote,
  onSheetChange,
}: PaperNotesProps) {
  const viewport = useViewport()
  const hintId = useId()
  const [draft, setDraft] = useState<PaperNote | null>(null)
  const [sheet, setSheet] = useState<OpenSheet | null>(null)
  const [settled, setSettled] = useState(false)
  const [filter, setFilter] = useState<PaperNoteFilter>('all')
  const [holding, setHolding] = useState<string | null>(null)
  const [tossing, setTossing] = useState<string | null>(null)
  const [returning, setReturning] = useState<string | null>(null)
  const [binned, setBinned] = useState<Binned | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const bodies = useRef(new Map<string, Body>())
  const elements = useRef(new Map<string, BallElements>())
  const rests = useRef(new Map<string, ClusterPoint>())
  const layoutRef = useRef<ClusterLayout | null>(null)
  const viewportRef = useRef(viewport)
  const binRef = useRef<BinPlacement>({ x: 0, y: 0, scale: 1 })
  const dissolve = useRef<Dissolve | null>(null)
  const frameRequest = useRef(0)
  const lastFrame = useRef(0)
  const phaseRef = useRef(phase)
  const arrivedSent = useRef(false)
  const leftSent = useRef(false)
  const planned = useRef(false)
  const pendingOpen = useRef<string | null>(null)
  const pendingRestore = useRef<string | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const suppressClick = useRef<string | null>(null)
  const binBack = useRef<HTMLDivElement>(null)
  const binFront = useRef<HTMLDivElement>(null)
  const newNoteButton = useRef<HTMLButtonElement>(null)
  const callbacks = useRef<{
    onArrived: () => void
    onLeft: () => void
    dissolveTargets: () => HTMLElement[]
    onBinned: (id: string, pointerType: string | null) => void
  }>({ onArrived, onLeft, dissolveTargets, onBinned: () => {} })

  const displayNotes = useMemo(
    () => (draft && !notes.some((note) => note.id === draft.id) ? [...notes, draft] : notes),
    [draft, notes],
  )
  const sheetId = sheet?.id ?? null
  const draftId = draft?.id ?? null
  // An open sheet and a fresh draft stay on the page whatever their kind, so
  // they always have a spot to crumple back into.
  const visibleNotes = useMemo(
    () => displayNotes.filter((note) => matchesPaperNoteFilter(note, filter) || note.id === sheetId || note.id === draftId),
    [displayNotes, draftId, filter, sheetId],
  )
  const visibleIndex = useMemo(() => new Map(visibleNotes.map((note, index) => [note.id, index])), [visibleNotes])
  const area = useMemo(() => clusterArea(viewport), [viewport])
  const middle = (area.top + area.bottom) / 2
  const bin = useMemo(() => binPlacement(viewport, middle), [middle, viewport])
  const layout = useMemo(
    () => (visibleNotes.length > 0 ? layoutCluster(visibleNotes.length, area) : null),
    [area, visibleNotes.length],
  )
  const counts = useMemo(() => countPaperNotesByKind(notes), [notes])
  const full = notes.length >= MAX_PAPER_NOTES
  const binShown = holding !== null || tossing !== null || returning !== null || binned !== null

  // The animation loop runs outside React, so it reads the latest props here.
  useLayoutEffect(() => {
    layoutRef.current = layout
    viewportRef.current = viewport
    binRef.current = bin
    phaseRef.current = phase
    callbacks.current = { onArrived, onLeft, dissolveTargets, onBinned: finishBinning }
  })

  const setLayer = useCallback((id: string, layer: BallLayer | null) => {
    const slot = elements.current.get(id)?.slot
    if (!slot || (slot.dataset.gesture ?? null) === layer) return
    if (layer) slot.dataset.gesture = layer
    else delete slot.dataset.gesture
  }, [])

  const render = useCallback((body: Body, now: number) => {
    const parts = elements.current.get(body.id)
    const currentLayout = layoutRef.current
    if (!parts) return
    // Hidden balls have no spot, so they are placed from the corner of the page.
    const origin = rests.current.get(body.id) ?? ORIGIN
    const ball = currentLayout?.ball ?? 84
    const center = screenCenter(body, viewportRef.current, ball)
    const scale = (1 + body.lift) * body.shrink
    const since = now - body.splatAt
    const splat = since >= 0 && since < 320
      ? body.splatForce * Math.exp(-since / 85) * Math.cos(since / 34)
      : 0
    const dx = center.x - origin.x
    const dy = center.y - origin.y
    const still = !body.motion && body.lift === 0 && splat === 0 && body.sink === 0 && body.shrink === 1
      && body.stretch < 0.002 && Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01
    if (still) {
      parts.body.style.transform = ''
    } else {
      const stretch = body.stretch >= 0.002
        ? `rotate(${body.stretchAngle.toFixed(3)}rad) scale(${(1 + body.stretch).toFixed(4)}, ${(1 - body.stretch * 0.7).toFixed(4)}) rotate(${(-body.stretchAngle).toFixed(3)}rad) `
        : ''
      parts.body.style.transform = `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0) ${stretch}scale(${(scale * (1 + splat * 0.075)).toFixed(4)}, ${(scale * (1 - splat * 0.065)).toFixed(4)})`
    }
    parts.body.style.opacity = body.opacity >= 1 ? '' : body.opacity.toFixed(3)
    const lift = Math.max(0, body.lift)
    const shown = body.opacity * body.shade
    const grounded = !body.motion && lift === 0 && Math.abs(body.x - origin.x) < 0.01 && Math.abs(body.y - origin.y) < 0.01
    parts.shadow.style.transform = grounded
      ? ''
      : `translate3d(${(body.x - origin.x).toFixed(2)}px, ${(body.y - origin.y).toFixed(2)}px, 0) scale(${(1 + lift * 0.9).toFixed(3)})`
    parts.shadow.style.opacity = shown >= 1 && lift === 0 ? '' : (shown / (1 + lift * 2.4)).toFixed(3)
    const moving = body.motion !== null
    if (parts.moving !== moving) {
      parts.moving = moving
      if (moving) parts.slot.dataset.moving = 'true'
      else delete parts.slot.dataset.moving
    }
    if (currentLayout && (parts.drawnRotation !== body.rotation || Math.abs(parts.drawnSize - currentLayout.ball) > 0.01)) {
      drawBall(parts, meshFor(body.id), body.rotation, currentLayout.ball)
    }
  }, [])

  const advance = useCallback((body: Body, now: number, dt: number) => {
    const motion = body.motion
    if (!motion) return
    const rest = rests.current.get(body.id)
    const ball = layoutRef.current?.ball ?? 84
    const radius = ball / 2
    const fromX = body.x
    const fromY = body.y
    const roll = (x: number, y: number, amount = 1) => {
      body.rotation = rollRotation(body.rotation, (x - body.x) * amount, (y - body.y) * amount, radius * (1 + Math.max(0, body.lift)))
      body.x = x
      body.y = y
    }
    const splat = (force: number) => {
      body.splatAt = now
      body.splatForce = force
    }
    // Rolling into a ball that is staying put, it hops over it rather than through it.
    const vault = () => {
      let bump = 0
      for (const other of bodies.current.values()) {
        const kind = other.motion?.kind
        if (other === body || other.opacity === 0 || !rests.current.has(other.id) || kind === 'exit' || kind === 'enter') continue
        const distance = Math.hypot(other.x - body.x, other.y - body.y)
        if (distance < ball) bump = Math.max(bump, Math.cos((distance / ball) * (Math.PI / 2)) * 0.34)
      }
      body.lift = bump
      setLayer(body.id, bump > 0.001 ? 'flying' : null)
    }
    // Squash along the direction of travel, the faster the more.
    const streak = (amount = 1) => {
      const vx = (body.x - fromX) / Math.max(1, dt)
      const vy = (body.y - fromY) / Math.max(1, dt)
      const speed = Math.hypot(vx, vy)
      body.stretch += (Math.min(0.075, speed * 0.03 * amount) - body.stretch) * Math.min(1, dt / 60)
      if (speed > 0.02) body.stretchAngle = Math.atan2(vy, vx)
    }

    if (motion.kind === 'drop') {
      if (!rest) return
      const { plan } = motion
      const elapsed = now - motion.start - plan.start
      if (elapsed < 0) {
        body.opacity = 0
        body.lift = START_LIFT
        body.x = plan.impact.x
        body.y = plan.impact.y
        return
      }
      if (elapsed < DROP_FALL_DURATION) {
        const progress = elapsed / DROP_FALL_DURATION
        body.lift = START_LIFT * (1 - progress * progress)
        body.opacity = clamp01(progress / 0.18)
        // A lazy tumble on the way down.
        body.rotation = rollRotation(body.rotation, 1.6 * plan.force, -0.9, radius)
        return
      }
      if (!motion.landed) {
        motion.landed = true
        splat(plan.force)
      }
      body.opacity = 1
      const bounce = (elapsed - DROP_FALL_DURATION) / DROP_BOUNCE_DURATION
      if (bounce < 1) {
        const travel = easeInOutSine(bounce)
        roll(lerp(plan.impact.x, rest.x, travel), lerp(plan.impact.y, rest.y, travel))
        body.lift = 4 * BOUNCE_LIFT * plan.force * bounce * (1 - bounce)
        return
      }
      roll(rest.x, rest.y)
      body.lift = 0
      if (!motion.settled) {
        motion.settled = true
        splat(0.42 * plan.force)
      }
      body.motion = null
      return
    }

    if (motion.kind === 'roll') {
      if (!rest) {
        body.motion = null
        return
      }
      const progress = clamp01((now - motion.start) / motion.duration)
      const travel = easeInOutCubic(progress)
      roll(lerp(motion.from.x, rest.x, travel), lerp(motion.from.y, rest.y, travel))
      if (progress >= 1) body.motion = null
      return
    }

    if (motion.kind === 'enter') {
      if (!rest) {
        body.motion = null
        return
      }
      const progress = (now - motion.start) / motion.duration
      if (progress < 0) return
      const travel = 1 - (1 - Math.min(1, progress)) ** 4
      roll(lerp(motion.from.x, rest.x, travel), lerp(motion.from.y, rest.y, travel))
      vault()
      streak(0.6)
      if (progress >= 1) {
        ground(body)
        body.motion = null
        setLayer(body.id, null)
        splat(0.38)
      }
      return
    }

    if (motion.kind === 'held') {
      const drag = gesture.current
      if (!drag || drag.id !== body.id) {
        body.motion = { kind: 'spring', target: null, pointerType: null }
        return
      }
      // The grip slides towards the middle of the ball, as if it settled into the hand.
      const grip = 0.3 + 0.7 * Math.exp(-(now - drag.heldAt) / 170)
      let targetX = drag.pointer.x - drag.grab.x * grip
      let targetY = drag.pointer.y - drag.grab.y * grip
      let liftTarget = HELD_LIFT
      if (drag.overBin) {
        // Over the bin, it is drawn to hover just above the mouth, ready to drop.
        const mouth = binArrival(binRef.current, radius * (1 + Math.max(0, body.lift)))
        targetX = lerp(targetX, mouth.x, 0.75)
        targetY = lerp(targetY, mouth.y - 8, 0.75)
        liftTarget = HELD_LIFT + 0.06
      } else if (drag.swapId) {
        const spot = rests.current.get(drag.swapId)
        if (spot) {
          targetX = lerp(targetX, spot.x, 0.2)
          targetY = lerp(targetY, spot.y - ball * 0.12, 0.2)
        }
      }
      ;[body.lift, body.vlift] = stepSpring(body.lift, body.vlift, liftTarget, dt, 0.03, 0.42)
      const page = unproject(
        { x: targetX, y: targetY + Math.max(0, body.lift) * ball * RISE },
        body.lift,
        viewportRef.current,
      )
      const [x, vx] = stepSpring(body.x, body.vx, page.x, dt, 0.055, 0.8)
      const [y, vy] = stepSpring(body.y, body.vy, page.y, dt, 0.055, 0.8)
      body.vx = vx
      body.vy = vy
      roll(x, y, 0.45)
      streak()
      return
    }

    if (motion.kind === 'spring') {
      const target = motion.target ?? rest
      if (!target) {
        body.motion = null
        return
      }
      const [x, vx] = stepSpring(body.x, body.vx, target.x, dt, 0.024, 0.58)
      const [y, vy] = stepSpring(body.y, body.vy, target.y, dt, 0.024, 0.58)
      body.vx = vx
      body.vy = vy
      roll(x, y)
      const fall = stepFall(body.lift, body.vlift, dt)
      body.lift = fall.lift
      body.vlift = fall.velocity
      if (fall.impact > 0.0009) {
        splat(Math.min(0.85, fall.impact * 160))
        if (fall.impact > 0.002) haptic('bump', motion.pointerType)
      }
      streak()
      const settledHome = !motion.target
        && Math.hypot(body.x - target.x, body.y - target.y) < 0.35
        && Math.hypot(body.vx, body.vy) < 0.004
        && body.lift === 0
        && body.vlift === 0
      if (settledHome) {
        body.x = target.x
        body.y = target.y
        ground(body)
        body.motion = null
        setLayer(body.id, null)
      }
      return
    }

    if (motion.kind === 'hops') {
      const hop = motion.hops[motion.index]
      const progress = (now - motion.start) / hop.duration
      if (progress < 0) return
      const t = Math.min(1, progress)
      const pose = hopPose(hop, t)
      roll(pose.x, pose.y)
      body.lift = pose.lift
      streak(0.8)
      const last = motion.index === motion.hops.length - 1
      if (motion.emerge && motion.index === 0) {
        const out = easeOutCubic(clamp01(t / 0.45))
        body.sink = motion.sinkDepth * (1 - out)
        body.shrink = lerp(motion.fit * 0.86, 1, out)
        body.shade = clamp01((t - 0.3) / 0.3)
        if (t > 0.4) setLayer(body.id, 'flying')
      } else if (motion.then === 'bin' && last) {
        body.shrink = lerp(1, motion.fit, easeInOutSine(clamp01((t - 0.35) / 0.65)))
        body.shade = 1 - clamp01((t - 0.55) / 0.35)
      }
      if (progress < 1) return
      if (hop.to.lift === 0) {
        splat(motion.then === 'bin' ? 0.8 : 0.6)
        haptic('bump', motion.pointerType)
      }
      motion.start += hop.duration
      motion.index += 1
      if (motion.index < motion.hops.length) return
      if (motion.then === 'bin') {
        setLayer(body.id, 'inside')
        body.stretch = 0
        body.motion = {
          kind: 'sink',
          start: now,
          duration: SINK_DURATION,
          depth: motion.sinkDepth,
          fit: motion.fit,
          pointerType: motion.pointerType,
        }
        return
      }
      ground(body)
      body.motion = null
      setLayer(body.id, null)
      if (rest && Math.hypot(rest.x - body.x, rest.y - body.y) > 0.5) {
        body.motion = { kind: 'roll', start: now, duration: RELAYOUT_DURATION, from: { x: body.x, y: body.y } }
      }
      return
    }

    if (motion.kind === 'sink') {
      const progress = clamp01((now - motion.start) / motion.duration)
      const fall = easeInCubic(progress)
      body.sink = motion.depth * fall
      body.shrink = lerp(motion.fit, motion.fit * 0.86, fall)
      body.shade = 0
      body.rotation = rollRotation(body.rotation, 0, 2.4 * (1 - fall), radius)
      if (progress < 1) return
      body.motion = null
      body.opacity = 0
      callbacks.current.onBinned(body.id, motion.pointerType)
      return
    }

    const progress = (now - motion.start) / motion.duration
    if (progress < 0) return
    // A small wind-up, then the ball rolls away faster and faster.
    const travel = progress < 0.12
      ? -0.025 * Math.sin((progress / 0.12) * Math.PI / 2)
      : -0.025 + 1.025 * ((progress - 0.12) / 0.88) ** 1.8
    roll(lerp(motion.from.x, motion.to.x, Math.min(1, travel)), lerp(motion.from.y, motion.to.y, Math.min(1, travel)))
    vault()
    if (progress >= 1) {
      ground(body)
      body.opacity = 0
      body.motion = null
      setLayer(body.id, null)
    }
  }, [setLayer])

  const tick = useCallback(function step(now: number) {
    frameRequest.current = 0
    const dt = lastFrame.current ? Math.min(48, Math.max(0, now - lastFrame.current)) : 16
    lastFrame.current = now
    let moving = false
    for (const body of Array.from(bodies.current.values())) {
      if (body.motion) advance(body, now, dt)
      render(body, now)
      if (body.motion || now - body.splatAt < 320) moving = true
    }
    if (dissolve.current && !dissolve.current.done) {
      dissolve.current.done = applyDissolve(dissolve.current, now, viewportRef.current)
      if (!dissolve.current.done) moving = true
    }
    const anyDrop = Array.from(bodies.current.values()).some((body) => body.motion?.kind === 'drop')
    const anyExit = Array.from(bodies.current.values()).some((body) => body.motion?.kind === 'exit')
    if (phaseRef.current === 'arriving' && !anyDrop && (!dissolve.current || dissolve.current.done) && !arrivedSent.current) {
      arrivedSent.current = true
      callbacks.current.onArrived()
    }
    if (phaseRef.current === 'leaving' && !anyExit && !leftSent.current) {
      leftSent.current = true
      callbacks.current.onLeft()
    }
    if (moving) frameRequest.current = requestAnimationFrame(step)
    else lastFrame.current = 0
  }, [advance, render])

  const wake = useCallback(() => {
    if (!frameRequest.current) frameRequest.current = requestAnimationFrame(tick)
  }, [tick])

  useEffect(() => () => {
    cancelAnimationFrame(frameRequest.current)
    frameRequest.current = 0
    lastFrame.current = 0
    if (dissolve.current) clearDissolve(dissolve.current.layers)
    clearTimeout(gesture.current?.timer)
    gesture.current = null
    setCursorMode('pointer')
  }, [])

  // Keep every ball's body in step with the layout: new balls drop in, moved
  // balls roll to their new spot, balls of another kind roll off together and
  // roll back in when their kind is shown again, removed balls are forgotten.
  useLayoutEffect(() => {
    const now = performance.now()
    const reduced = prefersReducedMotion()
    const nextRests = new Map<string, ClusterPoint>()
    visibleNotes.forEach((note, index) => {
      const point = layout?.positions[index]
      if (point) nextRests.set(note.id, point)
    })
    const previousRests = rests.current
    rests.current = nextRests

    if (!planned.current) {
      planned.current = true
      const arrival = now + (reduced ? 0 : ARRIVAL_DELAY)
      const random = createRandom(`drop:${now}`)
      const drops = layout ? planDrop(layout, viewport, random) : []
      visibleNotes.forEach((note, index) => {
        const rest = nextRests.get(note.id)
        if (!rest) return
        const plan = drops[index]
        const still = reduced || !plan
        bodies.current.set(note.id, createBody(note.id, still ? rest.x : plan.impact.x, still ? rest.y : plan.impact.y, {
          lift: still ? 0 : START_LIFT,
          opacity: still ? 1 : 0,
          motion: still ? null : { kind: 'drop', start: arrival, plan, landed: false, settled: false },
        }))
      })
      const layers = callbacks.current.dissolveTargets()
      if (layers.length > 0 && !reduced) {
        const ball = layout?.ball ?? 84
        const patches: DissolvePatch[] = drops.flatMap((drop) => [
          { x: drop.impact.x, y: drop.impact.y, start: drop.start + DROP_FALL_DURATION, radius: ball * (1.3 + random() * 0.55) },
          { x: drop.rest.x, y: drop.rest.y, start: drop.start + DROP_FALL_DURATION + DROP_BOUNCE_DURATION * 0.85, radius: ball * 0.95 },
        ])
        if (patches.length === 0) {
          // Nothing to drop: the page still comes apart in patches.
          for (let index = 0; index < 5; index += 1) {
            patches.push({
              x: viewport.width * (0.2 + random() * 0.6),
              y: viewport.height * (0.2 + random() * 0.6),
              start: index * 55,
              radius: 120 + random() * 80,
            })
          }
        }
        const lastImpact = Math.max(...patches.map((patch) => patch.start))
        dissolve.current = {
          layers,
          patches,
          origin: arrival,
          sweepStart: Math.max(120, lastImpact - DROP_BOUNCE_DURATION * 0.5),
          done: false,
        }
      }
      // Place every ball before the first paint so nothing flashes at rest.
      for (const body of bodies.current.values()) {
        advance(body, now, 16)
        render(body, now)
      }
      wake()
      return
    }

    const ball = layout?.ball ?? 84
    const radius = ball / 2
    const { width } = viewport
    const known = new Set(displayNotes.map((note) => note.id))
    const entering: Array<[Body, ClusterPoint]> = []
    const leaving: Body[] = []
    for (const id of previousRests.keys()) {
      const body = bodies.current.get(id)
      if (body && !nextRests.has(id) && known.has(id)) leaving.push(body)
    }

    for (const note of visibleNotes) {
      const rest = nextRests.get(note.id)
      if (!rest) continue
      const body = bodies.current.get(note.id)
      if (!body) {
        if (pendingRestore.current === note.id && !reduced) {
          // A note put back climbs out of the bin and hops home.
          pendingRestore.current = null
          const entry = binEntry(binRef.current, ball, viewport)
          const start = { ...entry.page, lift: BIN_RIM_LIFT }
          const midway = { x: lerp(start.x, rest.x, 0.6), y: lerp(start.y, rest.y, 0.6), lift: 0 }
          bodies.current.set(note.id, createBody(note.id, start.x, start.y, {
            lift: BIN_RIM_LIFT,
            sink: entry.depth,
            shrink: entry.fit * 0.86,
            shade: 0,
            motion: {
              kind: 'hops',
              start: now + 60,
              hops: [
                { from: start, to: midway, height: 0.5, duration: 520 },
                { from: midway, to: { ...rest, lift: 0 }, height: 0.12, duration: 300 },
              ],
              index: 0,
              then: 'rest',
              emerge: true,
              fit: entry.fit,
              sinkDepth: entry.depth,
              pointerType: null,
            },
          }))
          setLayer(note.id, 'inside')
          continue
        }
        if (pendingRestore.current === note.id) pendingRestore.current = null
        bodies.current.set(note.id, createBody(note.id, rest.x, rest.y, {
          lift: reduced ? 0 : START_LIFT,
          opacity: reduced ? 1 : 0,
          motion: reduced
            ? null
            : {
                kind: 'drop',
                start: now,
                plan: { start: 0, impact: rest, rest, force: 0.85 },
                landed: false,
                settled: false,
              },
        }))
        continue
      }
      if (!previousRests.has(note.id)) {
        entering.push([body, rest])
        continue
      }
      const previous = previousRests.get(note.id)
      const moved = !previous || Math.hypot(previous.x - rest.x, previous.y - rest.y) > 0.5
      const busy = body.motion && body.motion.kind !== 'roll'
        && !(body.motion.kind === 'spring' && body.motion.target)
      if (!moved || busy) continue
      if (reduced) {
        body.x = rest.x
        body.y = rest.y
        ground(body)
        body.motion = null
        continue
      }
      body.motion = {
        kind: 'roll',
        start: now + (leaving.length > 0 ? 70 : 0),
        duration: RELAYOUT_DURATION,
        from: { x: body.x, y: body.y },
      }
    }

    // Balls of another kind roll off to the right as one group.
    if (leaving.length > 0) {
      const distance = groupRollDistance(leaving, width, radius * 1.3, 1)
      for (const body of leaving) {
        ground(body)
        setLayer(body.id, null)
        if (reduced) {
          body.x += distance
          body.opacity = 0
          body.motion = null
          continue
        }
        body.motion = {
          kind: 'exit',
          start: now,
          duration: FILTER_EXIT_DURATION,
          from: { x: body.x, y: body.y },
          to: { x: body.x + distance, y: body.y },
        }
      }
    }

    // The kind being shown rolls in from the left, behind any that are leaving.
    if (entering.length > 0) {
      const distance = groupRollDistance(entering.map(([, rest]) => rest), width, radius * 1.3, -1)
      const start = now + (leaving.length > 0 ? FILTER_ENTER_DELAY : 0)
      for (const [body, rest] of entering) {
        body.opacity = 1
        if (reduced) {
          body.x = rest.x
          body.y = rest.y
          ground(body)
          body.motion = null
          continue
        }
        if (body.motion?.kind === 'exit') {
          // Still on its way out: it turns around instead.
          ground(body)
          setLayer(body.id, null)
          body.motion = { kind: 'roll', start: now, duration: RELAYOUT_DURATION + 140, from: { x: body.x, y: body.y } }
          continue
        }
        ground(body)
        body.x = rest.x - distance
        body.y = rest.y
        body.motion = { kind: 'enter', start, duration: FILTER_ENTER_DURATION, from: { x: body.x, y: body.y } }
      }
    }

    for (const id of Array.from(bodies.current.keys())) {
      if (!known.has(id)) {
        const motion = bodies.current.get(id)?.motion
        // Thrown away in another tab while flying at the bin here: the throw is over.
        if (motion?.kind === 'sink' || (motion?.kind === 'hops' && motion.then === 'bin')) releaseBin(id)
        rotations.set(id, bodies.current.get(id)?.rotation ?? rotationFor(id))
        bodies.current.delete(id)
      }
    }
    for (const body of bodies.current.values()) {
      advance(body, now, 0)
      render(body, now)
    }
    wake()
  }, [advance, displayNotes, layout, render, setLayer, viewport, visibleNotes, wake])

  const abandonForExit = useEffectEvent(() => {
    const drag = gesture.current
    if (drag) {
      clearTimeout(drag.timer)
      gesture.current = null
      if (drag.swapId) unlean(drag.swapId)
      setCursorMode('pointer')
      setHolding(null)
      armBin(false)
    }
    // A ball already flying at the bin is thrown away, not carried off.
    for (const body of bodies.current.values()) {
      const motion = body.motion
      if (motion?.kind === 'sink' || (motion?.kind === 'hops' && motion.then === 'bin')) {
        body.motion = null
        body.opacity = 0
        finishBinning(body.id, null)
      }
    }
  })

  useEffect(() => {
    if (phase === 'open') {
      const frame = requestAnimationFrame(() => setSettled(true))
      return () => cancelAnimationFrame(frame)
    }
    if (phase !== 'leaving') return
    const frame = requestAnimationFrame(() => setSettled(false))
    abandonForExit()
    const now = performance.now()
    const { width, height } = viewportRef.current
    const center = layoutRef.current?.center ?? { x: width / 2, y: height / 2 }
    const random = createRandom(`exit:${now}`)
    const radius = (layoutRef.current?.ball ?? 84) / 2
    if (prefersReducedMotion()) {
      leftSent.current = true
      callbacks.current.onLeft()
      return () => cancelAnimationFrame(frame)
    }
    for (const body of bodies.current.values()) {
      // Balls of another kind are already off the page.
      if (!rests.current.has(body.id) || body.opacity === 0) continue
      let angle = Math.atan2(body.y - center.y, body.x - center.x)
      if (Math.hypot(body.x - center.x, body.y - center.y) < 1) angle = random() * Math.PI * 2
      angle += (random() - 0.5) * 0.5
      const from = { x: body.x, y: body.y }
      const distance = exitDistance(from, angle, viewportRef.current, radius * 2.2)
      ground(body)
      setLayer(body.id, null)
      body.motion = {
        kind: 'exit',
        start: now + random() * 90,
        duration: EXIT_DURATION * (0.85 + random() * 0.3),
        from,
        to: { x: from.x + Math.cos(angle) * distance, y: from.y + Math.sin(angle) * distance },
      }
    }
    wake()
    return () => cancelAnimationFrame(frame)
  }, [phase, setLayer, wake])

  // Re-measure every canvas when the balls change size.
  useLayoutEffect(() => {
    for (const body of bodies.current.values()) render(body, performance.now())
  }, [layout?.ball, render])

  const handleEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    const drag = gesture.current
    if (drag) {
      // Escape puts a held ball back where it came from.
      event.preventDefault()
      clearTimeout(drag.timer)
      gesture.current = null
      suppressClick.current = drag.id
      try {
        elements.current.get(drag.id)?.button.releasePointerCapture(drag.pointerId)
      } catch {
        // The pointer has already gone.
      }
      if (drag.held) letGo(drag, { x: 0, y: 0 }, true)
      return
    }
    if (sheet || phase !== 'open') return
    event.preventDefault()
    onExit()
  })

  // Leaving the window mid-drag puts the ball back rather than leaving it in the air.
  const dropOnBlur = useEffectEvent(() => {
    const drag = gesture.current
    if (!drag) return
    clearTimeout(drag.timer)
    gesture.current = null
    suppressClick.current = drag.id
    if (drag.held) letGo(drag, { x: 0, y: 0 }, true)
  })

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => handleEscape(event)
    const blur = () => dropOnBlur()
    window.addEventListener('keydown', keyDown)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('blur', blur)
    }
  }, [])

  // The undo offer lasts a few moments; after that the paper is gone for good.
  useEffect(() => {
    if (!binned) return
    const timer = setTimeout(() => {
      setBinned(null)
      meshes.delete(binned.note.id)
      rotations.delete(binned.note.id)
    }, UNDO_WINDOW)
    return () => clearTimeout(timer)
  }, [binned])

  // The bin stays a moment while a note that was put back climbs out.
  useEffect(() => {
    if (!returning) return
    const timer = setTimeout(() => setReturning(null), RETURN_LINGER)
    return () => clearTimeout(timer)
  }, [returning])

  const registerSlot = useCallback((id: string, slot: HTMLDivElement | null) => {
    if (!slot) {
      elements.current.delete(id)
      return
    }
    const button = slot.querySelector<HTMLButtonElement>('.paper-ball')
    const body = slot.querySelector<HTMLElement>('.paper-ball-body')
    const shadow = slot.querySelector<HTMLElement>('.paper-ball-shadow')
    const canvas = slot.querySelector<HTMLCanvasElement>('canvas')
    if (!button || !body || !shadow || !canvas) return
    elements.current.set(id, {
      slot,
      button,
      body,
      shadow,
      canvas,
      frame: createPaperFrame(meshFor(id)),
      drawnRotation: null,
      drawnSize: 0,
      moving: false,
    })
    const ball = bodies.current.get(id)
    if (ball) render(ball, performance.now())
  }, [render])

  function announce(message: string) {
    // A repeated message still gets read out.
    setAnnouncement((current) => (current === message ? `${message}\u00a0` : message))
  }

  function labelOf(id: string): string {
    const note = displayNotes.find((item) => item.id === id)
    return note ? paperNoteLabel(note) : 'this note'
  }

  function releaseBin(id: string) {
    setTossing((current) => (current === id ? null : current))
    armBin(false)
  }

  function armBin(armed: boolean) {
    for (const layer of [binBack.current, binFront.current]) {
      if (!layer) continue
      if (armed) layer.dataset.armed = 'true'
      else delete layer.dataset.armed
    }
  }

  function gulpBin() {
    if (prefersReducedMotion()) return
    for (const layer of [binBack.current, binFront.current]) {
      const wobble = layer?.querySelector<HTMLElement>('.paper-bin-wobble')
      if (!wobble) continue
      wobble.getAnimations().forEach((animation) => animation.cancel())
      wobble.animate(GULP, { duration: 620, easing: 'cubic-bezier(0.25, 0.8, 0.3, 1)' })
    }
    binFront.current?.querySelector('.paper-bin-poof')?.animate(POOF, { duration: 520, easing: 'ease-out' })
  }

  function openNote(id: string, isNew = false) {
    if (sheet || phase !== 'open' || gesture.current || tossing) return
    const body = bodies.current.get(id)
    const rest = rests.current.get(id)
    const motion = body?.motion
    // A ball rolling away or already on its way into the bin is past opening.
    if (!body || !rest || motion?.kind === 'exit' || motion?.kind === 'sink' || (motion?.kind === 'hops' && motion.then === 'bin')) return
    body.motion = null
    ground(body)
    body.x = rest.x
    body.y = rest.y
    setLayer(id, null)
    setSheet({
      id,
      isNew,
      origin: { x: rest.x, y: rest.y, radius: (layoutRef.current?.ball ?? 84) / 2, rotation: body.rotation },
    })
    onSheetChange(true)
  }

  function clickBall(id: string, event: ReactMouseEvent<HTMLButtonElement>) {
    // A press that turned into a hold already did its job.
    if (event.detail !== 0 && suppressClick.current === id) {
      suppressClick.current = null
      return
    }
    openNote(id)
  }

  function lean(id: string, towardId: string) {
    const body = bodies.current.get(id)
    const rest = rests.current.get(id)
    const home = rests.current.get(towardId)
    if (!body || !rest || !home) return
    const dx = home.x - rest.x
    const dy = home.y - rest.y
    const distance = Math.hypot(dx, dy) || 1
    const reach = prefersReducedMotion() ? 0 : Math.min(16, distance * 0.12)
    // It shuffles towards the spot it would move to, with a little hop.
    body.motion = { kind: 'spring', target: { x: rest.x + (dx / distance) * reach, y: rest.y + (dy / distance) * reach }, pointerType: null }
    if (body.lift === 0 && reach > 0) body.vlift = 0.0017
    setLayer(id, 'target')
    wake()
  }

  function unlean(id: string) {
    const body = bodies.current.get(id)
    if (body?.motion?.kind === 'spring') body.motion = { kind: 'spring', target: null, pointerType: null }
    setLayer(id, null)
    wake()
  }

  function updateTargets(drag: Gesture) {
    const ball = layoutRef.current?.ball ?? 84
    // On narrow screens the bin sits close to the nearest balls, so picking one
    // up beside it, or letting go without moving, must not count as a throw.
    if (!drag.travelled && Math.hypot(drag.pointer.x - drag.start.x, drag.pointer.y - drag.start.y) > ball * 0.5) {
      drag.travelled = true
    }
    const overBin = drag.travelled && isOverBin(drag.pointer, binRef.current)
    if (overBin !== drag.overBin) {
      drag.overBin = overBin
      armBin(overBin)
      if (overBin) haptic('tick', drag.pointerType)
    }
    let target: string | null = null
    if (!overBin) {
      const candidates: Array<Vec & { id: string }> = []
      for (const [id, rest] of rests.current) {
        const other = bodies.current.get(id)
        if (id === drag.id || !other || (other.motion && other.motion.kind !== 'spring')) continue
        candidates.push({ id, x: rest.x, y: rest.y })
      }
      target = nearestWithin(drag.pointer, candidates, ball * 0.62)?.id ?? null
    }
    if (target === drag.swapId) return
    if (drag.swapId) unlean(drag.swapId)
    drag.swapId = target
    if (target) {
      lean(target, drag.id)
      haptic('tick', drag.pointerType)
    }
    setCursorMode(target ? 'switch' : 'grab')
  }

  function pickUp() {
    const drag = gesture.current
    if (!drag || drag.held) return
    clearTimeout(drag.timer)
    const body = bodies.current.get(drag.id)
    if (!body || !rests.current.has(drag.id) || phaseRef.current !== 'open') {
      gesture.current = null
      return
    }
    const now = performance.now()
    const center = screenCenter(body, viewportRef.current, layoutRef.current?.ball ?? 84)
    drag.held = true
    drag.heldAt = now
    drag.grab = { x: drag.start.x - center.x, y: drag.start.y - center.y }
    suppressClick.current = drag.id
    ground(body)
    body.motion = { kind: 'held' }
    if (prefersReducedMotion()) {
      body.lift = HELD_LIFT
    } else {
      // Plucked off the page: it stretches up and springs into the air.
      body.vlift = 0.0022
      body.splatAt = now
      body.splatForce = -0.5
    }
    setLayer(drag.id, 'held')
    setCursorMode('grab')
    haptic('pickup', drag.pointerType)
    setHolding(drag.id)
    updateTargets(drag)
    wake()
  }

  function pressBall(id: string, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !event.isPrimary) return
    // Not every long press ends in a click, so a fresh press always starts clean.
    suppressClick.current = null
    if (phase !== 'open' || sheet || gesture.current || tossing) return
    const body = bodies.current.get(id)
    if (!body || !rests.current.has(id)) return
    // A ball can be caught as it rolls or springs home, but not mid-throw.
    if (body.motion && body.motion.kind !== 'spring' && body.motion.kind !== 'roll') return
    const now = performance.now()
    const pointer = { x: event.clientX, y: event.clientY }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Without capture the press still works while the pointer stays on the ball.
    }
    gesture.current = {
      id,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      start: pointer,
      pointer,
      travelled: false,
      grab: { x: 0, y: 0 },
      samples: [{ ...pointer, t: now }],
      held: false,
      heldAt: 0,
      timer: setTimeout(pickUp, HOLD_DELAY),
      swapId: null,
      overBin: false,
    }
  }

  function dragBall(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = gesture.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const now = performance.now()
    drag.pointer = { x: event.clientX, y: event.clientY }
    drag.samples.push({ ...drag.pointer, t: now })
    trimSamples(drag.samples, now)
    if (!drag.held) {
      const slop = drag.pointerType === 'mouse' ? DRAG_SLOP : TOUCH_DRAG_SLOP
      if (Math.hypot(drag.pointer.x - drag.start.x, drag.pointer.y - drag.start.y) > slop) pickUp()
      return
    }
    updateTargets(drag)
    wake()
  }

  function releaseBall(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = gesture.current
    if (!drag || drag.pointerId !== event.pointerId) return
    clearTimeout(drag.timer)
    gesture.current = null
    if (!drag.held) return
    const now = performance.now()
    drag.pointer = { x: event.clientX, y: event.clientY }
    drag.samples.push({ ...drag.pointer, t: now })
    letGo(drag, releaseVelocity(drag.samples, now), false)
  }

  function cancelBall(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = gesture.current
    if (!drag || drag.pointerId !== event.pointerId) return
    clearTimeout(drag.timer)
    gesture.current = null
    if (drag.held) letGo(drag, { x: 0, y: 0 }, true)
  }

  function letGo(drag: Gesture, velocity: Vec, cancelled: boolean) {
    setCursorMode('pointer')
    setHolding(null)
    armBin(false)
    const swapId = drag.swapId
    const body = bodies.current.get(drag.id)
    if (!body) {
      if (swapId) unlean(swapId)
      return
    }
    const ball = layoutRef.current?.ball ?? 84
    const bin = binRef.current
    const center = screenCenter(body, viewportRef.current, ball)
    const mouth = binArrival(bin, ball / 2)
    const thrown = !cancelled
      && (drag.overBin || isFlickToward(center, velocity, mouth, BIN_DRAWING.mouthRx * bin.scale))
    if (thrown) {
      if (swapId) unlean(swapId)
      tossIntoBin(drag.id, drag.pointerType, velocity)
      return
    }
    if (swapId) {
      if (!cancelled && swapBalls(drag.id, swapId, drag.pointerType)) return
      unlean(swapId)
    }
    const rest = rests.current.get(drag.id)
    if (prefersReducedMotion() && rest) {
      ground(body)
      body.x = rest.x
      body.y = rest.y
      body.motion = null
      setLayer(drag.id, null)
      wake()
      return
    }
    // Back home: it keeps the momentum it was let go with, drops and bounces.
    const depth = 1 + Math.max(0, body.lift) * PERSPECTIVE
    body.vx = velocity.x / depth
    body.vy = velocity.y / depth
    body.vlift = 0
    body.motion = { kind: 'spring', target: null, pointerType: drag.pointerType }
    setLayer(drag.id, 'flying')
    wake()
  }

  function swapBalls(id: string, otherId: string, pointerType: string | null): boolean {
    const body = bodies.current.get(id)
    const other = bodies.current.get(otherId)
    const home = rests.current.get(id)
    const spot = rests.current.get(otherId)
    if (!body || !other || !home || !spot || !notes.some((note) => note.id === id) || !notes.some((note) => note.id === otherId)) {
      return false
    }
    const now = performance.now()
    if (prefersReducedMotion()) {
      for (const each of [body, other]) {
        ground(each)
        each.motion = null
        setLayer(each.id, null)
      }
    } else {
      // The held ball drops into the other's spot as that one hops over to take its place.
      body.motion = {
        kind: 'hops',
        start: now,
        hops: [{ from: { x: body.x, y: body.y, lift: Math.max(0, body.lift) }, to: { ...spot, lift: 0 }, height: 0.12, duration: SWAP_HOP_DURATION }],
        index: 0,
        then: 'rest',
        emerge: false,
        fit: 1,
        sinkDepth: 0,
        pointerType,
      }
      other.vlift = 0
      other.motion = {
        kind: 'hops',
        start: now + 40,
        hops: [{ from: { x: other.x, y: other.y, lift: Math.max(0, other.lift) }, to: { ...home, lift: 0 }, height: 0.22, duration: SWAP_HOP_DURATION + 160 }],
        index: 0,
        then: 'rest',
        emerge: false,
        fit: 1,
        sinkDepth: 0,
        pointerType: null,
      }
      setLayer(id, 'flying')
      setLayer(otherId, null)
    }
    onSwapNotes(id, otherId)
    haptic('swap', pointerType)
    announce(`Swapped “${labelOf(id)}” with “${labelOf(otherId)}”.`)
    wake()
    return true
  }

  function tossIntoBin(id: string, pointerType: string | null, velocity: Vec) {
    const body = bodies.current.get(id)
    if (!body) return
    if (!notes.some((note) => note.id === id)) {
      body.motion = { kind: 'spring', target: null, pointerType }
      wake()
      return
    }
    setTossing(id)
    if (prefersReducedMotion()) {
      body.motion = null
      body.opacity = 0
      finishBinning(id, pointerType)
      return
    }
    const ball = layoutRef.current?.ball ?? 84
    const entry = binEntry(binRef.current, ball, viewportRef.current)
    body.motion = {
      kind: 'hops',
      start: performance.now(),
      hops: planBinToss({ x: body.x, y: body.y, lift: Math.max(0, body.lift) }, entry.page, Math.hypot(velocity.x, velocity.y), ball),
      index: 0,
      then: 'bin',
      emerge: false,
      fit: entry.fit,
      sinkDepth: entry.depth,
      pointerType,
    }
    body.vlift = 0
    setLayer(id, 'flying')
    armBin(true)
    wake()
  }

  function finishBinning(id: string, pointerType: string | null) {
    setTossing(null)
    armBin(false)
    gulpBin()
    haptic('thud', pointerType)
    setLayer(id, null)
    const index = notes.findIndex((note) => note.id === id)
    if (index === -1) return
    const note = notes[index]
    onDeleteNote(id)
    setBinned({ note, index })
    announce(`Threw away “${paperNoteLabel(note)}”. You can undo this for a few seconds.`)
  }

  function undoBin() {
    if (!binned || full || phase !== 'open' || sheet) return
    const { note, index } = binned
    pendingRestore.current = note.id
    try {
      onRestoreNote(note, index)
    } catch (error) {
      pendingRestore.current = null
      console.error('ANGELO could not put this note back:', error)
      return
    }
    if (!matchesPaperNoteFilter(note, filter)) setFilter('all')
    setBinned(null)
    setReturning(note.id)
    announce(`Put “${paperNoteLabel(note)}” back.`)
  }

  function ballKeyDown(id: string, event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (phase !== 'open' || sheet || gesture.current || tossing) return
    const body = bodies.current.get(id)
    if (!body || !rests.current.has(id) || (body.motion && body.motion.kind !== 'roll' && body.motion.kind !== 'spring')) return
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      tossIntoBin(id, null, { x: 0, y: 0 })
      return
    }
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }
    if (!event.altKey || !(event.key in steps)) return
    event.preventDefault()
    const order = visibleNotes.map((note) => note.id)
    const otherId = order[order.indexOf(id) + steps[event.key]]
    if (!otherId || !swapBalls(id, otherId, null)) return
    // The list reorders underneath, so focus follows the ball that moved.
    requestAnimationFrame(() => elements.current.get(id)?.button.focus({ preventScroll: true }))
  }

  function preventMenu(event: ReactMouseEvent<HTMLButtonElement>) {
    // A long press on a touch screen picks the ball up rather than opening a menu.
    if (gesture.current) event.preventDefault()
  }

  function chooseFilter(next: PaperNoteFilter) {
    if (next === filter || phase !== 'open' || sheet || gesture.current || tossing) return
    setFilter(next)
    announce(next === 'all'
      ? `Showing all ${counts.all} notes.`
      : `Showing ${PAPER_NOTE_KIND_PLURALS[next].toLowerCase()}: ${counts[next]}.`)
  }

  function startNewNote() {
    if (sheet || phase !== 'open' || full || draft || gesture.current) return
    const next = createPaperNoteDraft(new Date(), undefined, filter === 'all' ? 'note' : filter)
    pendingOpen.current = next.id
    setDraft(next)
  }

  const openPendingDraft = useEffectEvent((id: string) => {
    pendingOpen.current = null
    const body = bodies.current.get(id)
    if (body && body.motion?.kind === 'drop') {
      const rest = rests.current.get(id)
      if (rest) {
        body.x = rest.x
        body.y = rest.y
      }
      body.lift = 0
      body.opacity = 1
      body.motion = null
    }
    openNote(id, true)
  })

  // A new paper drops into its spot, then unwraps for writing.
  useEffect(() => {
    const id = pendingOpen.current
    if (!id || !draft || draft.id !== id) return
    const wait = prefersReducedMotion() ? 0 : DROP_FALL_DURATION + DROP_BOUNCE_DURATION * 0.35
    const timer = setTimeout(() => openPendingDraft(id), wait)
    return () => clearTimeout(timer)
  }, [draft])

  function finishSheet(id: string, rotation: Rotation, discarded: boolean) {
    setSheet(null)
    onSheetChange(false)
    const body = bodies.current.get(id)
    if (discarded) {
      if (notes.some((note) => note.id === id)) onDeleteNote(id)
      if (draft?.id === id) setDraft(null)
      bodies.current.delete(id)
      meshes.delete(id)
      rotations.delete(id)
      requestAnimationFrame(() => newNoteButton.current?.focus({ preventScroll: true }))
      return
    }
    rotations.set(id, rotation)
    if (draft?.id === id) setDraft(null)
    if (body) {
      body.rotation = rotation
      body.splatAt = performance.now()
      body.splatForce = 0.5
      render(body, performance.now())
      wake()
    }
    requestAnimationFrame(() => elements.current.get(id)?.button.focus({ preventScroll: true }))
  }

  const openSheetNote = sheet ? displayNotes.find((note) => note.id === sheet.id) ?? null : null
  const sheetLost = Boolean(sheet && !openSheetNote)
  const reportSheetChange = useEffectEvent(onSheetChange)

  // The unfolded note can vanish underneath its sheet when another tab throws
  // it away or the account changes. There is nothing left to crumple, so the
  // sheet simply goes, rather than leaving the page locked behind it.
  useEffect(() => {
    if (!sheetLost) return
    const frame = requestAnimationFrame(() => {
      setSheet(null)
      reportSheetChange(false)
      // Focus once the page behind the sheet is no longer inert.
      requestAnimationFrame(() => newNoteButton.current?.focus({ preventScroll: true }))
    })
    return () => cancelAnimationFrame(frame)
  }, [sheetLost])

  const emptyKind = filter === 'all' ? null : PAPER_NOTE_KIND_PLURALS[filter].toLowerCase()

  return (
    <section
      className={[
        'paper-notes',
        `is-${phase}`,
        settled ? 'is-settled' : '',
        sheet ? 'has-open-sheet' : '',
        holding ? 'is-holding' : '',
        binShown ? 'has-bin' : '',
      ].join(' ')}
      aria-label="Notes to self"
      style={{
        '--paper-ball': `${layout?.ball ?? 84}px`,
        '--paper-label': `${layout?.labelWidth ?? 150}px`,
        '--cluster-middle': `${middle}px`,
      } as CSSProperties}
    >
      <header className="paper-notes-heading">
        <p className="eyebrow"><span /> WORDS TO LIVE BY.</p>
        <h1><span>Notes to</span> <em>self</em></h1>
        <p className="paper-notes-subtitle">Principles, goals and quotes worth keeping close.</p>
      </header>

      <PaperCategories filter={filter} counts={counts} onChange={chooseFilter} />

      <div className="paper-cluster">
        {displayNotes.map((note) => {
          const index = visibleIndex.get(note.id)
          const rest = index === undefined ? undefined : layout?.positions[index]
          return (
            <PaperBall
              key={note.id}
              note={note}
              rest={rest}
              index={index ?? 0}
              unwrapped={sheet?.id === note.id}
              disabled={phase !== 'open'}
              describedBy={hintId}
              register={registerSlot}
              onOpen={clickBall}
              onPress={pressBall}
              onDrag={dragBall}
              onRelease={releaseBall}
              onCancel={cancelBall}
              onKeyDown={ballKeyDown}
              onContextMenu={preventMenu}
            />
          )
        })}
        <PaperBin
          placement={bin}
          shown={binShown}
          undo={binned ? { label: paperNoteLabel(binned.note), disabled: full, onUndo: undoBin } : null}
          backRef={binBack}
          frontRef={binFront}
        />
      </div>

      {visibleNotes.length === 0 && (
        <div className={`paper-empty ${emptyKind ? 'is-filtered' : ''}`}>
          <span className="paper-empty-mark" aria-hidden="true"><PaperBallIcon size={30} strokeWidth={0.9} /></span>
          {emptyKind ? (
            <>
              <h2>No {emptyKind} <em>yet.</em></h2>
              <p>Write one down and it lands here.</p>
            </>
          ) : (
            <>
              <h2>Nothing kept <em>yet.</em></h2>
              <p>Write down a principle, a goal or a line<br />that keeps you on track.</p>
            </>
          )}
        </div>
      )}

      <footer className="paper-notes-footer">
        <div className="paper-notes-guide">
          <button type="button" className="paper-back" onClick={onExit} disabled={phase !== 'open'}>
            <ArrowLeft size={13} strokeWidth={1.5} /> My practice
          </button>
          <p>Click to unfold. Hold to swap or toss.</p>
        </div>
        <div className="paper-notes-actions">
          <button
            ref={newNoteButton}
            type="button"
            className="paper-new-note"
            onClick={startNewNote}
            disabled={phase !== 'open' || full || Boolean(sheet) || Boolean(draft)}
          >
            <Plus size={15} strokeWidth={1.5} /> New note
          </button>
          <p className="paper-notes-count">
            {full
              ? `${MAX_PAPER_NOTES} OF ${MAX_PAPER_NOTES} · THROW ONE AWAY TO MAKE ROOM`
              : `${String(notes.length).padStart(2, '0')} OF ${MAX_PAPER_NOTES} KEPT`}
          </p>
        </div>
        <div className="paper-notes-signoff">
          <span className="saved-label"><Check size={12} /> {storageLabel}</span>
          <p>Keep what keeps you going.</p>
        </div>
      </footer>

      <p id={hintId} hidden>
        Hold to pick it up: drop it on another note to swap places, or toss it into the bin. Press Delete to throw it away, or Alt and an arrow key to swap it with its neighbor.
      </p>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>

      {sheet && openSheetNote && (
        <PaperSheet
          key={sheet.id}
          note={openSheetNote}
          origin={sheet.origin}
          isNew={sheet.isNew}
          storageLabel={storageLabel}
          returnTarget={() => {
            const rest = rests.current.get(sheet.id)
            return rest ? { ...rest, radius: (layoutRef.current?.ball ?? 84) / 2 } : null
          }}
          onChange={(note) => {
            onSaveNote(note)
          }}
          onClosed={(rotation, discarded) => finishSheet(sheet.id, rotation, discarded)}
        />
      )}
    </section>
  )
}

interface PaperBallProps {
  note: PaperNote
  /** Its spot in the cluster; none while its kind is not shown. */
  rest: ClusterPoint | undefined
  index: number
  unwrapped: boolean
  disabled: boolean
  describedBy: string
  register: (id: string, slot: HTMLDivElement | null) => void
  onOpen: (id: string, event: ReactMouseEvent<HTMLButtonElement>) => void
  onPress: (id: string, event: ReactPointerEvent<HTMLButtonElement>) => void
  onDrag: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onRelease: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onKeyDown: (id: string, event: ReactKeyboardEvent<HTMLButtonElement>) => void
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void
}

function PaperBall({
  note,
  rest,
  index,
  unwrapped,
  disabled,
  describedBy,
  register,
  onOpen,
  onPress,
  onDrag,
  onRelease,
  onCancel,
  onKeyDown,
  onContextMenu,
}: PaperBallProps) {
  const { id } = note
  const slot = useCallback((element: HTMLDivElement | null) => register(id, element), [id, register])
  const label = paperNoteLabel(note)
  const blank = isBlankPaperNote(note)
  const filtered = !rest
  return (
    <div
      ref={slot}
      className={['paper-ball-slot', unwrapped ? 'is-unwrapped' : '', filtered ? 'is-filtered' : ''].join(' ')}
      style={{ left: rest?.x ?? 0, top: rest?.y ?? 0, '--label-delay': `${index * 45}ms` } as CSSProperties}
      inert={filtered}
    >
      <button
        type="button"
        className="paper-ball"
        onClick={(event) => onOpen(id, event)}
        onPointerDown={(event) => onPress(id, event)}
        onPointerMove={onDrag}
        onPointerUp={onRelease}
        onPointerCancel={onCancel}
        onLostPointerCapture={onCancel}
        onKeyDown={(event) => onKeyDown(id, event)}
        onContextMenu={onContextMenu}
        disabled={disabled}
        aria-label={blank ? 'Open your new note' : `Unfold ${PAPER_NOTE_KIND_LABELS[note.kind].toLowerCase()}: ${label}`}
        aria-describedby={blank ? undefined : describedBy}
      >
        <span className="paper-ball-shadow" aria-hidden="true"><span /></span>
        <span className="paper-ball-body">
          <span className="paper-ball-lift">
            <canvas aria-hidden="true" />
          </span>
        </span>
        <span className="paper-ball-label" aria-hidden="true">
          <small>{blank ? 'NEW' : PAPER_NOTE_KIND_LABELS[note.kind].toUpperCase()}</small>
          <span>{blank ? 'A blank page' : label}</span>
        </span>
      </button>
    </div>
  )
}

interface PaperSheetProps {
  note: PaperNote
  origin: OpenSheet['origin']
  isNew: boolean
  storageLabel: string
  returnTarget: () => { x: number; y: number; radius: number } | null
  onChange: (note: PaperNote) => void
  onClosed: (rotation: Rotation, discarded: boolean) => void
}

type SheetStage = 'opening' | 'open' | 'closing'

function PaperSheet({ note, origin, isNew, storageLabel, returnTarget, onChange, onClosed }: PaperSheetProps) {
  const viewport = useViewport()
  const [current, setCurrent] = useState(note)
  const [stage, setStage] = useState<SheetStage>('opening')
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [saveError, setSaveError] = useState('')
  const canvas = useRef<HTMLCanvasElement>(null)
  const paperLayer = useRef<HTMLCanvasElement | null>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const mesh = useMemo(() => meshFor(note.id), [note.id])
  const frame = useMemo(() => createPaperFrame(mesh), [mesh])
  const rect = useMemo(() => sheetRect(viewport), [viewport])
  const rectRef = useRef(rect)
  const rotation = useRef(origin.rotation)
  const animation = useRef(0)
  const closedRef = useRef(onClosed)
  useLayoutEffect(() => {
    closedRef.current = onClosed
    rectRef.current = rect
  })
  const keptSince = useMemo(
    () => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(note.createdAt)),
    [note.createdAt],
  )

  const paint = useCallback((pose: { x: number; y: number; radius: number; unfold: number; height: number; opacity?: number }) => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const width = window.innerWidth
    const height = window.innerHeight
    if (element.width !== Math.round(width * ratio) || element.height !== Math.round(height * ratio)) {
      element.width = Math.round(width * ratio)
      element.height = Math.round(height * ratio)
      element.style.width = `${width}px`
      element.style.height = `${height}px`
    }
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, element.width, element.height)
    if (pose.opacity === 0) return

    // The paper is painted on its own layer first so its shadow follows the
    // real, ragged silhouette rather than a rough outline.
    let layer = paperLayer.current
    if (!layer) {
      layer = document.createElement('canvas')
      paperLayer.current = layer
    }
    if (layer.width !== element.width || layer.height !== element.height) {
      layer.width = element.width
      layer.height = element.height
    }
    const paper = layer.getContext('2d')
    if (!paper) return
    paper.setTransform(ratio, 0, 0, ratio, 0, 0)
    paper.clearRect(0, 0, width, height)
    const sheet = rectRef.current
    computePaperFrame(mesh, {
      x: pose.x,
      y: pose.y,
      radius: pose.radius,
      width: sheet.width,
      height: sheet.height,
      unfold: pose.unfold,
      rotation: rotation.current,
    }, frame)
    paintPaperFrame(paper, mesh, frame, pose.unfold)

    const lifted = pose.height
    context.save()
    context.globalAlpha = pose.opacity ?? 1
    context.shadowColor = `rgba(0, 0, 0, ${(0.19 - lifted * 0.06).toFixed(3)})`
    context.shadowBlur = (14 + lifted * 22 + pose.unfold * 18) * ratio
    context.shadowOffsetX = (2 + lifted * 10) * ratio
    context.shadowOffsetY = (7 + lifted * 22 + pose.unfold * 7) * ratio
    context.drawImage(layer, 0, 0)
    context.shadowColor = 'rgba(0, 0, 0, 0.1)'
    context.shadowBlur = 3 * ratio
    context.shadowOffsetX = 0
    context.shadowOffsetY = 1.5 * ratio
    context.drawImage(layer, 0, 0)
    context.restore()
  }, [frame, mesh])

  // Unwrap: lift the ball to the middle of the page, loosen it and open it flat.
  // The first frame paints before the browser does, so the handover from the
  // ball in the cluster to this canvas never flickers.
  useLayoutEffect(() => {
    const reduced = prefersReducedMotion()
    const started = performance.now()
    let last = { x: origin.x, y: origin.y }
    const step = (now: number) => {
      const sheet = rectRef.current
      const elapsed = reduced ? Infinity : now - started
      const travel = clamp01(elapsed / SHEET_TRAVEL)
      const x = lerp(origin.x, sheet.x, easeInOutCubic(travel))
      const y = lerp(origin.y, sheet.y, easeInOutCubic(travel))
      const radius = origin.radius * lerp(1, SHEET_LIFT, easeOutCubic(travel))
      rotation.current = rollRotation(rotation.current, x - last.x, y - last.y, radius)
      last = { x, y }
      const unfold = clamp01((elapsed - SHEET_UNFOLD_START) / SHEET_UNFOLD)
      paint({ x, y, radius, unfold, height: easeOutCubic(travel) * (1 - unfold) })
      if (unfold < 1) {
        animation.current = requestAnimationFrame(step)
      } else {
        animation.current = 0
        setStage('open')
      }
    }
    step(started)
    return () => cancelAnimationFrame(animation.current)
  }, [origin, paint])

  useEffect(() => {
    if (stage !== 'open') return
    const sheet = rectRef.current
    paint({ x: sheet.x, y: sheet.y, radius: origin.radius * SHEET_LIFT, unfold: 1, height: 0 })
  }, [origin.radius, paint, rect, stage])

  useEffect(() => {
    if (stage !== 'open') return
    const frameId = requestAnimationFrame(() => {
      if (isNew) titleInput.current?.focus({ preventScroll: true })
      else dialog.current?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frameId)
  }, [isNew, stage])

  useEffect(() => {
    if (!confirmingDiscard) return
    const timer = setTimeout(() => setConfirmingDiscard(false), 3200)
    return () => clearTimeout(timer)
  }, [confirmingDiscard])

  const close = useCallback((discard: boolean) => {
    if (stage !== 'open') return
    setStage('closing')
    const reduced = prefersReducedMotion()
    const sheet = rectRef.current
    const lifted = origin.radius * SHEET_LIFT
    const target = discard ? null : returnTarget()
    const started = performance.now() + (reduced ? 0 : 120)
    const throwAngle = Math.PI * (0.12 + Math.random() * 0.18)
    const away = {
      x: sheet.x + Math.cos(throwAngle) * Math.hypot(window.innerWidth, window.innerHeight),
      y: sheet.y + Math.sin(throwAngle) * Math.hypot(window.innerWidth, window.innerHeight),
    }
    let last = { x: sheet.x, y: sheet.y }
    const step = (now: number) => {
      const elapsed = reduced ? Infinity : Math.max(0, now - started)
      const crumple = clamp01(elapsed / SHEET_CRUMPLE)
      const travel = clamp01((elapsed - SHEET_CRUMPLE * 0.88) / SHEET_RETURN)
      let x = sheet.x
      let y = sheet.y
      let radius = lifted
      let height = 0
      if (discard) {
        const toss = easeInCubic(travel)
        x = lerp(sheet.x, away.x, toss)
        y = lerp(sheet.y, away.y, toss)
        radius = lifted * (1 + Math.sin(travel * Math.PI) * 0.35)
        height = 0.5 + Math.sin(travel * Math.PI) * 0.6
      } else if (target) {
        const glide = easeInOutCubic(travel)
        x = lerp(sheet.x, target.x, glide)
        y = lerp(sheet.y, target.y, glide)
        radius = lerp(lifted, target.radius, easeInOutCubic(travel))
        height = 1 - glide
      }
      if (crumple < 1) height = Math.max(height, easeOutCubic(crumple))
      rotation.current = rollRotation(rotation.current, x - last.x, y - last.y, radius)
      last = { x, y }
      const finished = travel >= 1 || reduced
      paint({ x, y, radius, unfold: 1 - crumple, height, opacity: finished && !target ? 0 : 1 })
      if (!finished) {
        animation.current = requestAnimationFrame(step)
        return
      }
      animation.current = 0
      closedRef.current(rotation.current, discard || !target)
    }
    animation.current = requestAnimationFrame(step)
  }, [origin.radius, paint, returnTarget, stage])

  useEffect(() => () => cancelAnimationFrame(animation.current), [])

  function update(change: Partial<Pick<PaperNote, 'kind' | 'title' | 'body'>>) {
    const next = { ...current, ...change, updatedAt: new Date().toISOString() }
    setCurrent(next)
    if (isBlankPaperNote(next)) return
    try {
      onChange(next)
      setSaveError('')
    } catch (error) {
      console.error('ANGELO could not keep this note:', error)
      setSaveError(error instanceof Error ? error.message : 'This note could not be kept.')
    }
  }

  function keyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    close(isBlankPaperNote(current))
  }

  const titleLength = current.title.length
  const bodyLength = current.body.length
  const label = isBlankPaperNote(current) ? 'New note' : paperNoteLabel(current)

  return createPortal(
    <div
      className={`paper-sheet-layer is-${stage}`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close(isBlankPaperNote(current))
      }}
    >
      <canvas ref={canvas} className="paper-sheet-canvas" aria-hidden="true" />
      <div
        ref={dialog}
        className="paper-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${PAPER_NOTE_KIND_LABELS[current.kind]}: ${label}`}
        tabIndex={-1}
        onKeyDown={keyDown}
        style={{
          left: rect.x - rect.width / 2,
          top: rect.y - rect.height / 2,
          width: rect.width,
          height: rect.height,
        }}
        inert={stage !== 'open'}
      >
        <header className="paper-sheet-header">
          <div className="paper-kinds" role="group" aria-label="Kind of note">
            {PAPER_NOTE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className={current.kind === kind ? 'is-selected' : ''}
                aria-pressed={current.kind === kind}
                onClick={() => update({ kind })}
              >
                {PAPER_NOTE_KIND_LABELS[kind]}
              </button>
            ))}
          </div>
          <div className="paper-sheet-meta">
            <span>{isNew && isBlankPaperNote(current) ? 'A FRESH SHEET' : `KEPT SINCE ${keptSince.toUpperCase()}`}</span>
            <button
              type="button"
              className="paper-sheet-close"
              onClick={() => close(isBlankPaperNote(current))}
              aria-label={isBlankPaperNote(current) ? 'Close this blank page' : 'Crumple this note and put it back'}
            >
              <X size={16} strokeWidth={1.35} />
              <span className="paper-sheet-close-hint" aria-hidden="true">Crumple it up</span>
            </button>
          </div>
        </header>
        <input
          ref={titleInput}
          className="paper-sheet-title"
          value={current.title}
          maxLength={MAX_PAPER_NOTE_TITLE_LENGTH}
          onChange={(event) => update({ title: event.target.value })}
          placeholder="Give it a title"
          aria-label="Title"
          spellCheck="true"
        />
        <textarea
          className="paper-sheet-body"
          value={current.body}
          maxLength={MAX_PAPER_NOTE_BODY_LENGTH}
          onChange={(event) => update({ body: event.target.value })}
          placeholder="Write the principle, goal or words you want to keep close…"
          aria-label="Note"
          spellCheck="true"
        />
        <footer className="paper-sheet-footer">
          <span className={`paper-sheet-saved ${saveError ? 'is-error' : ''}`} role={saveError ? 'alert' : undefined}>
            {saveError || (isBlankPaperNote(current) ? 'WRITE SOMETHING TO KEEP IT' : storageLabel)}
            {(titleLength > MAX_PAPER_NOTE_TITLE_LENGTH - 10 || bodyLength > MAX_PAPER_NOTE_BODY_LENGTH - 120) && (
              <> · {bodyLength} / {MAX_PAPER_NOTE_BODY_LENGTH}</>
            )}
          </span>
          {!(isNew && isBlankPaperNote(current)) && (
            <button
              type="button"
              className={`paper-sheet-discard ${confirmingDiscard ? 'is-confirming' : ''}`}
              onClick={() => {
                if (confirmingDiscard) close(true)
                else setConfirmingDiscard(true)
              }}
            >
              <Trash2 size={13} strokeWidth={1.4} />
              {confirmingDiscard ? 'Click again to throw it away' : 'Throw away'}
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  )
}

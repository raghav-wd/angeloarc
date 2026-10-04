import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Check, Plus, Trash2, X } from 'lucide-react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  DROP_BOUNCE_DURATION,
  DROP_FALL_DURATION,
  exitDistance,
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
  createPaperNoteDraft,
  isBlankPaperNote,
  MAX_PAPER_NOTE_BODY_LENGTH,
  MAX_PAPER_NOTE_TITLE_LENGTH,
  MAX_PAPER_NOTES,
  PAPER_NOTE_KIND_LABELS,
  PAPER_NOTE_KINDS,
  paperNoteLabel,
} from '../lib/paperNotes'
import type { PaperNote, PaperNotes as PaperNoteList } from '../lib/paperNotes'
import { PaperBallIcon } from './PaperBallIcon'
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
}

interface BallElements {
  button: HTMLButtonElement
  body: HTMLElement
  shadow: HTMLElement
  canvas: HTMLCanvasElement
  frame: PaperFrame
  drawnRotation: Rotation | null
  drawnSize: number
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
const PERSPECTIVE = 0.42
const DISSOLVE_SWEEP = 430
const DISSOLVE_FEATHER = 26
const EXIT_DURATION = 580
const RELAYOUT_DURATION = 520
const SHEET_TRAVEL = 400
const SHEET_UNFOLD_START = 110
const SHEET_UNFOLD = 1020
const SHEET_CRUMPLE = 640
const SHEET_RETURN = 430
const SHEET_LIFT = 1.45

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

// Mirrors the heading and footer positions in PaperNotes.css.
function clusterArea(viewport: Viewport): ClusterArea {
  const compact = viewport.width <= 600
  const short = viewport.height <= 760
  return {
    width: viewport.width,
    height: viewport.height,
    top: compact ? 150 : short ? 134 : 166,
    bottom: viewport.height - (compact ? 156 : short ? 94 : 116),
    inset: compact ? 50 : 78,
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
  onSheetChange,
}: PaperNotesProps) {
  const viewport = useViewport()
  const [draft, setDraft] = useState<PaperNote | null>(null)
  const [sheet, setSheet] = useState<OpenSheet | null>(null)
  const [settled, setSettled] = useState(false)
  const bodies = useRef(new Map<string, Body>())
  const elements = useRef(new Map<string, BallElements>())
  const rests = useRef(new Map<string, ClusterPoint>())
  const layoutRef = useRef<ClusterLayout | null>(null)
  const viewportRef = useRef(viewport)
  const dissolve = useRef<Dissolve | null>(null)
  const frameRequest = useRef(0)
  const phaseRef = useRef(phase)
  const arrivedSent = useRef(false)
  const leftSent = useRef(false)
  const planned = useRef(false)
  const pendingOpen = useRef<string | null>(null)
  const newNoteButton = useRef<HTMLButtonElement>(null)
  const callbacks = useRef({ onArrived, onLeft, dissolveTargets })

  const displayNotes = useMemo(
    () => (draft && !notes.some((note) => note.id === draft.id) ? [...notes, draft] : notes),
    [draft, notes],
  )
  const area = useMemo(() => clusterArea(viewport), [viewport])
  const layout = useMemo(
    () => (displayNotes.length > 0 ? layoutCluster(displayNotes.length, area) : null),
    [area, displayNotes.length],
  )
  const full = notes.length >= MAX_PAPER_NOTES

  // The animation loop runs outside React, so it reads the latest props here.
  useLayoutEffect(() => {
    layoutRef.current = layout
    viewportRef.current = viewport
    phaseRef.current = phase
    callbacks.current = { onArrived, onLeft, dissolveTargets }
  })

  const render = useCallback((body: Body, now: number) => {
    const parts = elements.current.get(body.id)
    const rest = rests.current.get(body.id)
    const currentLayout = layoutRef.current
    if (!parts || !rest || !currentLayout) return
    const { width, height } = viewportRef.current
    const depth = 1 + body.lift * PERSPECTIVE
    const apparentX = width / 2 + (body.x - width / 2) * depth
    const apparentY = height / 2 + (body.y - height / 2) * depth
    const scale = 1 + body.lift
    const since = now - body.splatAt
    const splat = since >= 0 && since < 320
      ? body.splatForce * Math.exp(-since / 85) * Math.cos(since / 34)
      : 0
    parts.body.style.transform = body.motion || body.lift > 0 || splat !== 0
      ? `translate3d(${(apparentX - rest.x).toFixed(2)}px, ${(apparentY - rest.y).toFixed(2)}px, 0) scale(${(scale * (1 + splat * 0.075)).toFixed(4)}, ${(scale * (1 - splat * 0.065)).toFixed(4)})`
      : ''
    parts.body.style.opacity = body.opacity >= 1 ? '' : body.opacity.toFixed(3)
    parts.shadow.style.transform = body.motion || body.lift > 0
      ? `translate3d(${(body.x - rest.x).toFixed(2)}px, ${(body.y - rest.y).toFixed(2)}px, 0) scale(${(1 + body.lift * 0.9).toFixed(3)})`
      : ''
    parts.shadow.style.opacity = body.opacity >= 1 && body.lift === 0
      ? ''
      : (body.opacity / (1 + body.lift * 2.4)).toFixed(3)
    if (parts.drawnRotation !== body.rotation || Math.abs(parts.drawnSize - currentLayout.ball) > 0.01) {
      drawBall(parts, meshFor(body.id), body.rotation, currentLayout.ball)
    }
  }, [])

  const advance = useCallback((body: Body, now: number) => {
    const motion = body.motion
    const rest = rests.current.get(body.id)
    const radius = (layoutRef.current?.ball ?? 80) / 2
    if (!motion || !rest) return
    const roll = (x: number, y: number) => {
      body.rotation = rollRotation(body.rotation, x - body.x, y - body.y, radius * (1 + body.lift))
      body.x = x
      body.y = y
    }

    if (motion.kind === 'drop') {
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
        body.splatAt = now
        body.splatForce = plan.force
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
        body.splatAt = now
        body.splatForce = 0.42 * plan.force
      }
      body.motion = null
      return
    }

    if (motion.kind === 'roll') {
      const progress = clamp01((now - motion.start) / motion.duration)
      const travel = easeInOutCubic(progress)
      roll(lerp(motion.from.x, rest.x, travel), lerp(motion.from.y, rest.y, travel))
      if (progress >= 1) body.motion = null
      return
    }

    const progress = (now - motion.start) / motion.duration
    if (progress < 0) return
    // A small wind-up, then the ball rolls away faster and faster.
    const travel = progress < 0.12
      ? -0.025 * Math.sin((progress / 0.12) * Math.PI / 2)
      : -0.025 + 1.025 * ((progress - 0.12) / 0.88) ** 1.8
    roll(lerp(motion.from.x, motion.to.x, Math.min(1, travel)), lerp(motion.from.y, motion.to.y, Math.min(1, travel)))
    if (progress >= 1) {
      body.opacity = 0
      body.motion = null
    }
  }, [])

  const tick = useCallback(function step(now: number) {
    frameRequest.current = 0
    let moving = false
    for (const body of bodies.current.values()) {
      if (body.motion) advance(body, now)
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
  }, [advance, render])

  const wake = useCallback(() => {
    if (!frameRequest.current) frameRequest.current = requestAnimationFrame(tick)
  }, [tick])

  useEffect(() => () => {
    cancelAnimationFrame(frameRequest.current)
    frameRequest.current = 0
    if (dissolve.current) clearDissolve(dissolve.current.layers)
  }, [])

  // Keep every ball's body in step with the layout: new balls drop in,
  // moved balls roll to their new spot, removed balls are forgotten.
  useLayoutEffect(() => {
    const now = performance.now()
    const reduced = prefersReducedMotion()
    const nextRests = new Map<string, ClusterPoint>()
    displayNotes.forEach((note, index) => {
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
      displayNotes.forEach((note, index) => {
        const rest = nextRests.get(note.id)
        if (!rest) return
        const plan = drops[index]
        bodies.current.set(note.id, {
          id: note.id,
          x: reduced || !plan ? rest.x : plan.impact.x,
          y: reduced || !plan ? rest.y : plan.impact.y,
          lift: reduced || !plan ? 0 : START_LIFT,
          rotation: rotationFor(note.id),
          opacity: reduced || !plan ? 1 : 0,
          splatAt: -Infinity,
          splatForce: 0,
          motion: reduced || !plan ? null : { kind: 'drop', start: arrival, plan, landed: false, settled: false },
        })
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
        advance(body, now)
        render(body, now)
      }
      wake()
      return
    }

    for (const note of displayNotes) {
      const rest = nextRests.get(note.id)
      if (!rest) continue
      const body = bodies.current.get(note.id)
      if (!body) {
        bodies.current.set(note.id, {
          id: note.id,
          x: rest.x,
          y: rest.y,
          lift: reduced ? 0 : START_LIFT,
          rotation: rotationFor(note.id),
          opacity: reduced ? 1 : 0,
          splatAt: -Infinity,
          splatForce: 0,
          motion: reduced
            ? null
            : {
                kind: 'drop',
                start: now,
                plan: { start: 0, impact: rest, rest, force: 0.85 },
                landed: false,
                settled: false,
              },
        })
        continue
      }
      const previous = previousRests.get(note.id)
      const moved = !previous || Math.hypot(previous.x - rest.x, previous.y - rest.y) > 0.5
      if (!moved || body.motion?.kind === 'drop' || body.motion?.kind === 'exit') continue
      if (reduced) {
        body.x = rest.x
        body.y = rest.y
        continue
      }
      body.motion = { kind: 'roll', start: now, duration: RELAYOUT_DURATION, from: { x: body.x, y: body.y } }
    }
    for (const id of Array.from(bodies.current.keys())) {
      if (!nextRests.has(id)) {
        rotations.set(id, bodies.current.get(id)?.rotation ?? rotationFor(id))
        bodies.current.delete(id)
      }
    }
    for (const body of bodies.current.values()) {
      advance(body, now)
      render(body, now)
    }
    wake()
  }, [advance, displayNotes, layout, render, viewport, wake])

  useEffect(() => {
    if (phase === 'open') {
      const frame = requestAnimationFrame(() => setSettled(true))
      return () => cancelAnimationFrame(frame)
    }
    if (phase !== 'leaving') return
    const frame = requestAnimationFrame(() => setSettled(false))
    const now = performance.now()
    const { width, height } = viewportRef.current
    const center = layoutRef.current?.center ?? { x: width / 2, y: height / 2 }
    const random = createRandom(`exit:${now}`)
    const radius = (layoutRef.current?.ball ?? 84) / 2
    if (prefersReducedMotion() || bodies.current.size === 0) {
      leftSent.current = true
      callbacks.current.onLeft()
      return () => cancelAnimationFrame(frame)
    }
    for (const body of bodies.current.values()) {
      let angle = Math.atan2(body.y - center.y, body.x - center.x)
      if (Math.hypot(body.x - center.x, body.y - center.y) < 1) angle = random() * Math.PI * 2
      angle += (random() - 0.5) * 0.5
      const from = { x: body.x, y: body.y }
      const distance = exitDistance(from, angle, viewportRef.current, radius * 2.2)
      body.lift = 0
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
  }, [phase, wake])

  // Re-measure every canvas when the balls change size.
  useLayoutEffect(() => {
    for (const body of bodies.current.values()) render(body, performance.now())
  }, [layout?.ball, render])

  const exitWithKeyboard = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented || sheet || phase !== 'open') return
    event.preventDefault()
    onExit()
  })

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => exitWithKeyboard(event)
    window.addEventListener('keydown', keyDown)
    return () => window.removeEventListener('keydown', keyDown)
  }, [])

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
      button,
      body,
      shadow,
      canvas,
      frame: createPaperFrame(meshFor(id)),
      drawnRotation: null,
      drawnSize: 0,
    })
    const ball = bodies.current.get(id)
    if (ball) render(ball, performance.now())
  }, [render])

  function openNote(id: string, isNew = false) {
    if (sheet || phase !== 'open') return
    const body = bodies.current.get(id)
    const rest = rests.current.get(id)
    if (!body || !rest || body.motion?.kind === 'exit') return
    body.motion = null
    body.lift = 0
    body.x = rest.x
    body.y = rest.y
    setSheet({
      id,
      isNew,
      origin: { x: rest.x, y: rest.y, radius: (layoutRef.current?.ball ?? 84) / 2, rotation: body.rotation },
    })
    onSheetChange(true)
  }

  function startNewNote() {
    if (sheet || phase !== 'open' || full || draft) return
    const next = createPaperNoteDraft()
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

  return (
    <section
      className={[
        'paper-notes',
        `is-${phase}`,
        settled ? 'is-settled' : '',
        sheet ? 'has-open-sheet' : '',
      ].join(' ')}
      aria-label="Notes to self"
      style={{
        '--paper-ball': `${layout?.ball ?? 84}px`,
        '--paper-label': `${layout?.labelWidth ?? 150}px`,
      } as CSSProperties}
    >
      <header className="paper-notes-heading">
        <p className="eyebrow"><span /> WORDS TO LIVE BY.</p>
        <h1><span>Notes to</span> <em>self</em></h1>
        <p className="paper-notes-subtitle">Principles, goals and quotes worth keeping close.</p>
      </header>

      <div className="paper-cluster">
        {displayNotes.map((note, index) => {
          const rest = layout?.positions[index]
          if (!rest) return null
          return (
            <PaperBall
              key={note.id}
              note={note}
              rest={rest}
              index={index}
              unwrapped={sheet?.id === note.id}
              disabled={phase !== 'open'}
              register={registerSlot}
              onOpen={openNote}
            />
          )
        })}
      </div>

      {displayNotes.length === 0 && (
        <div className="paper-empty">
          <span className="paper-empty-mark" aria-hidden="true"><PaperBallIcon size={30} strokeWidth={0.9} /></span>
          <h2>Nothing kept <em>yet.</em></h2>
          <p>Write down a principle, a goal or a line<br />that keeps you on track.</p>
        </div>
      )}

      <footer className="paper-notes-footer">
        <div className="paper-notes-guide">
          <button type="button" className="paper-back" onClick={onExit} disabled={phase !== 'open'}>
            <ArrowLeft size={13} strokeWidth={1.5} /> My practice
          </button>
          <p>Click a paper. Remember why.</p>
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
  rest: ClusterPoint
  index: number
  unwrapped: boolean
  disabled: boolean
  register: (id: string, slot: HTMLDivElement | null) => void
  onOpen: (id: string) => void
}

function PaperBall({ note, rest, index, unwrapped, disabled, register, onOpen }: PaperBallProps) {
  const { id } = note
  const slot = useCallback((element: HTMLDivElement | null) => register(id, element), [id, register])
  const label = paperNoteLabel(note)
  const blank = isBlankPaperNote(note)
  return (
    <div
      ref={slot}
      className={`paper-ball-slot ${unwrapped ? 'is-unwrapped' : ''}`}
      style={{ left: rest.x, top: rest.y, '--label-delay': `${index * 45}ms` } as CSSProperties}
    >
      <button
        type="button"
        className="paper-ball"
        onClick={() => onOpen(id)}
        disabled={disabled}
        aria-label={blank ? 'Open your new note' : `Unfold ${PAPER_NOTE_KIND_LABELS[note.kind].toLowerCase()}: ${label}`}
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

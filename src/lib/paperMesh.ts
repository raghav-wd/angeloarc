// A sheet of paper as a small triangle mesh with two shapes: crumpled into a
// ball and lying flat. Drawing interpolates between them, so the same mesh
// rolls around as a ball, unwraps into a sheet and crumples back up.
//
// Coordinates: x to the right, y down the screen, z towards the viewer.

export type Rotation = readonly [w: number, x: number, y: number, z: number]

export const IDENTITY_ROTATION: Rotation = [1, 0, 0, 0]

/** FNV-1a, so every note id maps to the same crumple on every visit. */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Mulberry32: tiny, fast and good enough for visual noise. */
export function createRandom(seed: string | number): () => number {
  let state = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed)
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function rotationFromAxisAngle(x: number, y: number, z: number, angle: number): Rotation {
  const length = Math.hypot(x, y, z)
  if (length < 1e-9 || !Number.isFinite(angle)) return IDENTITY_ROTATION
  const half = angle / 2
  const scale = Math.sin(half) / length
  return [Math.cos(half), x * scale, y * scale, z * scale]
}

/** Applies `b` first, then `a`. */
export function multiplyRotations(a: Rotation, b: Rotation): Rotation {
  const [aw, ax, ay, az] = a
  const [bw, bx, by, bz] = b
  const w = aw * bw - ax * bx - ay * by - az * bz
  const x = aw * bx + ax * bw + ay * bz - az * by
  const y = aw * by - ax * bz + ay * bw + az * bx
  const z = aw * bz + ax * by - ay * bx + az * bw
  const length = Math.hypot(w, x, y, z) || 1
  return [w / length, x / length, y / length, z / length]
}

export function rotateVector(rotation: Rotation, x: number, y: number, z: number): [number, number, number] {
  const [w, qx, qy, qz] = rotation
  const tx = 2 * (qy * z - qz * y)
  const ty = 2 * (qz * x - qx * z)
  const tz = 2 * (qx * y - qy * x)
  return [
    x + w * tx + (qy * tz - qz * ty),
    y + w * ty + (qz * tx - qx * tz),
    z + w * tz + (qx * ty - qy * tx),
  ]
}

export function randomRotation(random: () => number): Rotation {
  const u1 = random()
  const u2 = random() * Math.PI * 2
  const u3 = random() * Math.PI * 2
  const a = Math.sqrt(1 - u1)
  const b = Math.sqrt(u1)
  return [a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)]
}

/**
 * Turns a ball that rolls (without slipping) `dx`, `dy` pixels across the page.
 * The point facing the viewer travels in the direction of motion.
 */
export function rollRotation(rotation: Rotation, dx: number, dy: number, radius: number): Rotation {
  const distance = Math.hypot(dx, dy)
  if (distance < 1e-6 || radius <= 0) return rotation
  return multiplyRotations(rotationFromAxisAngle(-dy, dx, 0, distance / radius), rotation)
}

export interface PaperMesh {
  vertexCount: number
  triangleCount: number
  /** Flat sheet: x, y as fractions of the sheet size (-0.5..0.5), z as a crinkle fraction. */
  flat: Float32Array
  /** Crumpled ball: x, y, z inside the unit sphere. */
  ball: Float32Array
  /** When each vertex starts to unfold, as a fraction of the whole unfold. */
  delay: Float32Array
  /** How far each vertex billows out of plane while it unfolds. */
  billow: Float32Array
  triangles: Uint16Array
  /** Small per-facet variation in the paper's tone. */
  tone: Float32Array
  /** Vertices around the sheet's cut edge, in order. */
  edge: Uint16Array
}

export const UNFOLD_DELAY = 0.32

function smootherstep(value: number): number {
  const t = Math.min(1, Math.max(0, value))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

export function createPaperMesh(seed: string, columns = 16, rows = 11): PaperMesh {
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 2 || rows < 2) {
    throw new Error('A paper mesh needs at least two columns and two rows.')
  }
  const random = createRandom(`paper:${seed}`)
  const vertexCount = (columns + 1) * (rows + 1)
  const flat = new Float32Array(vertexCount * 3)
  const ball = new Float32Array(vertexCount * 3)
  const delay = new Float32Array(vertexCount)
  const billow = new Float32Array(vertexCount)

  // Low-frequency waves fold whole regions of the sheet together, so the
  // crumple has big creases as well as small ones.
  const waves = Array.from({ length: 4 }, () => ({
    fu: 1 + Math.floor(random() * 3),
    fv: 1 + Math.floor(random() * 3),
    phase: random() * Math.PI * 2,
    theta: (random() - 0.5) * 1.1,
    phi: (random() - 0.5) * 0.7,
    radius: (random() - 0.5) * 0.3,
  }))
  const turns = 1.15 + random() * 0.35
  const thetaOffset = random() * Math.PI * 2

  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const index = row * (columns + 1) + column
      const onLeft = column === 0
      const onRight = column === columns
      const onTop = row === 0
      const onBottom = row === rows
      let u = column / columns
      let v = row / rows
      // Jitter breaks up the grid; edge vertices only slide along their edge.
      if (!onLeft && !onRight) u += ((random() - 0.5) * 0.7) / columns
      if (!onTop && !onBottom) v += ((random() - 0.5) * 0.7) / rows
      flat[index * 3] = u - 0.5
      flat[index * 3 + 1] = v - 0.5
      flat[index * 3 + 2] = (random() - 0.5) * 2

      let theta = thetaOffset + u * Math.PI * 2 * turns
      let phi = (0.07 + 0.86 * v) * Math.PI
      let radius = 0.8 + random() * 0.2
      for (const wave of waves) {
        const value = Math.sin((wave.fu * u + wave.fv * v) * Math.PI * 2 + wave.phase)
        theta += wave.theta * value
        phi += wave.phi * value
        radius += wave.radius * value * 0.5
      }
      theta += (random() - 0.5) * 0.26
      phi += (random() - 0.5) * 0.2
      radius = Math.min(1, Math.max(0.66, radius))
      ball[index * 3] = radius * Math.sin(phi) * Math.cos(theta)
      ball[index * 3 + 1] = radius * Math.cos(phi)
      ball[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta)

      const fromCenter = Math.min(1, Math.hypot(u - 0.5, v - 0.5) / Math.SQRT1_2)
      delay[index] = UNFOLD_DELAY * Math.min(1, 0.75 * fromCenter + 0.25 * random())
      billow[index] = (random() - 0.5) * 2
    }
  }

  const triangleCount = columns * rows * 2
  const triangles = new Uint16Array(triangleCount * 3)
  const tone = new Float32Array(triangleCount)
  let cursor = 0
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column
      const b = a + 1
      const c = a + columns + 1
      const d = c + 1
      const quad = random() < 0.5 ? [a, b, d, a, d, c] : [a, b, c, b, d, c]
      triangles.set(quad, cursor * 3)
      tone[cursor] = (random() - 0.5) * 2
      tone[cursor + 1] = (random() - 0.5) * 2
      cursor += 2
    }
  }

  const edge: number[] = []
  for (let column = 0; column < columns; column += 1) edge.push(column)
  for (let row = 0; row < rows; row += 1) edge.push(row * (columns + 1) + columns)
  for (let column = columns; column > 0; column -= 1) edge.push(rows * (columns + 1) + column)
  for (let row = rows; row > 0; row -= 1) edge.push(row * (columns + 1))

  return {
    vertexCount,
    triangleCount,
    flat,
    ball,
    delay,
    billow,
    triangles,
    tone,
    edge: Uint16Array.from(edge),
  }
}

export interface PaperPose {
  /** Centre of the ball or sheet, in canvas pixels. */
  x: number
  y: number
  /** Ball radius in pixels while crumpled. */
  radius: number
  /** Sheet size in pixels once flat. */
  width: number
  height: number
  /** 0 is a crumpled ball, 1 is a flat sheet. */
  unfold: number
  rotation: Rotation
  /** Squash and stretch for impacts; 1 leaves the shape alone. */
  scaleX?: number
  scaleY?: number
}

export interface PaperFrame {
  /** Projected x, y and depth for every vertex. */
  points: Float32Array
  depth: Float32Array
  shade: Float32Array
  order: Uint16Array
}

export function createPaperFrame(mesh: PaperMesh): PaperFrame {
  return {
    points: new Float32Array(mesh.vertexCount * 3),
    depth: new Float32Array(mesh.triangleCount),
    shade: new Float32Array(mesh.triangleCount),
    order: new Uint16Array(mesh.triangleCount),
  }
}

const LIGHT = (() => {
  const x = -0.48
  const y = -0.62
  const z = 0.62
  const length = Math.hypot(x, y, z)
  return [x / length, y / length, z / length] as const
})()

/** Vertex progress through the unfold, eased so every vertex lands gently. */
export function vertexUnfold(unfold: number, delay: number): number {
  return smootherstep((unfold - delay) / (1 - UNFOLD_DELAY))
}

/**
 * Projects the mesh for `pose` and works out each facet's shade and draw
 * order. Shading uses the facet's real orientation, so creases catch the
 * light while crumpled and fade to a faint crinkle once flat.
 */
export function computePaperFrame(mesh: PaperMesh, pose: PaperPose, frame: PaperFrame): PaperFrame {
  const { flat, ball, delay, billow } = mesh
  const { points } = frame
  const scaleX = pose.scaleX ?? 1
  const scaleY = pose.scaleY ?? 1
  const unfold = Math.min(1, Math.max(0, pose.unfold))
  const crinkle = Math.min(pose.width, pose.height) * 0.0055
  const sheetHalf = Math.min(pose.width, pose.height) / 2
  // The ball loosens and puffs up a little before it opens out.
  const ballRadius = pose.radius * (1 + 0.42 * smootherstep(unfold / 0.38))
  const [w, qx, qy, qz] = pose.rotation

  for (let index = 0; index < mesh.vertexCount; index += 1) {
    const offset = index * 3
    const progress = unfold <= 0 ? 0 : unfold >= 1 ? 1 : vertexUnfold(unfold, delay[index])
    let x = 0
    let y = 0
    let z = 0
    if (progress < 1) {
      const bx = ball[offset]
      const by = ball[offset + 1]
      const bz = ball[offset + 2]
      const tx = 2 * (qy * bz - qz * by)
      const ty = 2 * (qz * bx - qx * bz)
      const tz = 2 * (qx * by - qy * bx)
      x = (bx + w * tx + (qy * tz - qz * ty)) * ballRadius
      y = (by + w * ty + (qz * tx - qx * tz)) * ballRadius
      z = (bz + w * tz + (qx * ty - qy * tx)) * ballRadius
    }
    if (progress > 0) {
      const fx = flat[offset] * pose.width
      const fy = flat[offset + 1] * pose.height
      const fz = flat[offset + 2] * crinkle
      x += (fx - x) * progress
      y += (fy - y) * progress
      z += (fz - z) * progress
      if (progress < 1) {
        const lift = Math.sin(progress * Math.PI)
        const reach = ballRadius + (sheetHalf - ballRadius) * progress
        z += lift * billow[index] * reach * 0.34
        x += lift * billow[index] * reach * 0.06
      }
    }
    points[offset] = pose.x + x * scaleX
    points[offset + 1] = pose.y + y * scaleY
    points[offset + 2] = z
  }

  const { triangles, tone } = mesh
  const rimStrength = 0.24 * (1 - smootherstep(unfold * 1.6))
  for (let triangle = 0; triangle < mesh.triangleCount; triangle += 1) {
    const a = triangles[triangle * 3] * 3
    const b = triangles[triangle * 3 + 1] * 3
    const c = triangles[triangle * 3 + 2] * 3
    const abx = points[b] - points[a]
    const aby = points[b + 1] - points[a + 1]
    const abz = points[b + 2] - points[a + 2]
    const acx = points[c] - points[a]
    const acy = points[c + 1] - points[a + 1]
    const acz = points[c + 2] - points[a + 2]
    let nx = aby * acz - abz * acy
    let ny = abz * acx - abx * acz
    let nz = abx * acy - aby * acx
    const length = Math.hypot(nx, ny, nz) || 1
    nx /= length
    ny /= length
    nz /= length
    // Paper has two good sides; always light the side facing the viewer.
    if (nz < 0) {
      nx = -nx
      ny = -ny
      nz = -nz
    }
    const diffuse = Math.max(-0.12, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2])
    let shade = 1 + 0.62 * (diffuse - LIGHT[2])
    if (rimStrength > 0) {
      const cx = (points[a] + points[b] + points[c]) / 3 - pose.x
      const cy = (points[a + 1] + points[b + 1] + points[c + 1]) / 3 - pose.y
      const rim = Math.min(1, Math.hypot(cx / scaleX, cy / scaleY) / Math.max(1, ballRadius))
      shade *= 1 - rimStrength * smootherstep((rim - 0.45) / 0.55)
    }
    frame.shade[triangle] = shade * (1 + tone[triangle] * 0.011)
    frame.depth[triangle] = points[a + 2] + points[b + 2] + points[c + 2]
    frame.order[triangle] = triangle
  }
  const { depth } = frame
  frame.order.sort((left, right) => depth[left] - depth[right])
  return frame
}

export interface PaperInk {
  /** Paper colour as 0-255 RGB. */
  paper: readonly [number, number, number]
  /** Colour shadows fall towards. */
  shadow: readonly [number, number, number]
}

export const PAPER_INK: PaperInk = {
  paper: [253, 253, 251],
  shadow: [118, 118, 114],
}

function facetColor(shade: number, ink: PaperInk): string {
  if (shade >= 1) {
    const lift = Math.min(1, (shade - 1) * 3)
    const r = Math.round(ink.paper[0] + (255 - ink.paper[0]) * lift)
    const g = Math.round(ink.paper[1] + (255 - ink.paper[1]) * lift)
    const b = Math.round(ink.paper[2] + (255 - ink.paper[2]) * lift)
    return `rgb(${r},${g},${b})`
  }
  const dark = Math.min(1, (1 - shade) * 1.45)
  const r = Math.round(ink.paper[0] + (ink.shadow[0] - ink.paper[0]) * dark)
  const g = Math.round(ink.paper[1] + (ink.shadow[1] - ink.paper[1]) * dark)
  const b = Math.round(ink.paper[2] + (ink.shadow[2] - ink.paper[2]) * dark)
  return `rgb(${r},${g},${b})`
}

/** Paints a frame computed by `computePaperFrame`. */
export function paintPaperFrame(
  context: CanvasRenderingContext2D,
  mesh: PaperMesh,
  frame: PaperFrame,
  unfold: number,
  ink: PaperInk = PAPER_INK,
): void {
  const { points, order, shade } = frame
  const { triangles } = mesh
  context.lineJoin = 'round'
  // A hairline in the facet's own colour hides anti-aliasing seams.
  context.lineWidth = 0.7
  for (let rank = 0; rank < order.length; rank += 1) {
    const triangle = order[rank]
    const a = triangles[triangle * 3] * 3
    const b = triangles[triangle * 3 + 1] * 3
    const c = triangles[triangle * 3 + 2] * 3
    const color = facetColor(shade[triangle], ink)
    context.beginPath()
    context.moveTo(points[a], points[a + 1])
    context.lineTo(points[b], points[b + 1])
    context.lineTo(points[c], points[c + 1])
    context.closePath()
    context.fillStyle = color
    context.strokeStyle = color
    context.fill()
    context.stroke()
  }

  const edgeAlpha = smootherstep((unfold - 0.82) / 0.18)
  if (edgeAlpha > 0) {
    context.beginPath()
    mesh.edge.forEach((vertex, index) => {
      const x = points[vertex * 3]
      const y = points[vertex * 3 + 1]
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    })
    context.closePath()
    context.lineWidth = 1
    context.strokeStyle = `rgba(160, 160, 154, ${0.75 * edgeAlpha})`
    context.stroke()
  }
}

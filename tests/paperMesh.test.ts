import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  computePaperFrame,
  createPaperFrame,
  createPaperMesh,
  createRandom,
  hashSeed,
  IDENTITY_ROTATION,
  multiplyRotations,
  rollRotation,
  rotateVector,
  rotationFromAxisAngle,
  vertexUnfold,
} from '../src/lib/paperMesh.ts'
import type { PaperPose, Rotation } from '../src/lib/paperMesh.ts'

function close(actual: number, expected: number, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`)
}

const POSE: PaperPose = { x: 200, y: 150, radius: 40, width: 600, height: 400, unfold: 0, rotation: IDENTITY_ROTATION }

describe('seeded randomness', () => {
  it('repeats exactly for the same seed and differs between seeds', () => {
    const first = createRandom('note-a')
    const second = createRandom('note-a')
    const other = createRandom('note-b')
    const a = Array.from({ length: 5 }, first)
    assert.deepEqual(a, Array.from({ length: 5 }, second))
    assert.notDeepEqual(a, Array.from({ length: 5 }, other))
    for (const value of a) assert.ok(value >= 0 && value < 1)
    assert.equal(hashSeed('abc'), hashSeed('abc'))
  })
})

describe('ball rotations', () => {
  it('rotates vectors around an axis', () => {
    const quarter = rotationFromAxisAngle(0, 0, 1, Math.PI / 2)
    const [x, y, z] = rotateVector(quarter, 1, 0, 0)
    close(x, 0)
    close(y, 1)
    close(z, 0)
    assert.deepEqual(rotationFromAxisAngle(0, 0, 0, 1), IDENTITY_ROTATION)
  })

  it('composes rotations, applying the right-hand one first', () => {
    const aboutZ = rotationFromAxisAngle(0, 0, 1, Math.PI / 2)
    const aboutX = rotationFromAxisAngle(1, 0, 0, Math.PI / 2)
    const [x, y, z] = rotateVector(multiplyRotations(aboutX, aboutZ), 1, 0, 0)
    close(x, 0)
    close(y, 0)
    close(z, 1)
  })

  it('rolls without slipping: the front of the ball moves with the ball', () => {
    const radius = 40
    // Rolling a quarter turn to the right carries the front point (+z) to the right side (+x).
    const rolled = rollRotation(IDENTITY_ROTATION, (Math.PI / 2) * radius, 0, radius)
    const [x, y, z] = rotateVector(rolled, 0, 0, 1)
    close(x, 1)
    close(y, 0)
    close(z, 0)
    const down = rollRotation(IDENTITY_ROTATION, 0, (Math.PI / 2) * radius, radius)
    close(rotateVector(down, 0, 0, 1)[1], 1)
    assert.equal(rollRotation(IDENTITY_ROTATION, 0, 0, radius), IDENTITY_ROTATION)
  })

  it('keeps rotations normalized over many rolls', () => {
    let rotation: Rotation = IDENTITY_ROTATION
    for (let step = 0; step < 2000; step += 1) rotation = rollRotation(rotation, 3.7, -1.3, 20)
    close(Math.hypot(...rotation), 1, 1e-9)
  })
})

describe('paper mesh', () => {
  it('is deterministic per note and different between notes', () => {
    const a = createPaperMesh('note-a')
    assert.deepEqual(a.ball, createPaperMesh('note-a').ball)
    assert.notDeepEqual(a.ball, createPaperMesh('note-b').ball)
    assert.throws(() => createPaperMesh('x', 1, 4), /two columns/)
  })

  it('crumples inside the unit sphere and lies flat across the whole sheet', () => {
    const mesh = createPaperMesh('shape')
    for (let index = 0; index < mesh.vertexCount; index += 1) {
      const [x, y, z] = mesh.ball.slice(index * 3, index * 3 + 3)
      assert.ok(Math.hypot(x, y, z) <= 1 + 1e-6)
      const [fx, fy] = mesh.flat.slice(index * 3, index * 3 + 2)
      assert.ok(Math.abs(fx) <= 0.5 + 1e-6 && Math.abs(fy) <= 0.5 + 1e-6)
    }
    assert.equal(mesh.triangles.length, mesh.triangleCount * 3)
    assert.ok(Math.max(...mesh.triangles) < mesh.vertexCount)
    assert.equal(new Set(mesh.edge).size, mesh.edge.length)
  })

  it('projects a ball within its radius and a flat sheet across its full size', () => {
    const mesh = createPaperMesh('frame')
    const frame = createPaperFrame(mesh)
    computePaperFrame(mesh, POSE, frame)
    for (let index = 0; index < mesh.vertexCount; index += 1) {
      assert.ok(Math.hypot(frame.points[index * 3] - POSE.x, frame.points[index * 3 + 1] - POSE.y) <= POSE.radius + 1e-3)
    }

    computePaperFrame(mesh, { ...POSE, unfold: 1 }, frame)
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (let index = 0; index < mesh.vertexCount; index += 1) {
      minX = Math.min(minX, frame.points[index * 3])
      maxX = Math.max(maxX, frame.points[index * 3])
      minY = Math.min(minY, frame.points[index * 3 + 1])
      maxY = Math.max(maxY, frame.points[index * 3 + 1])
    }
    close(minX, POSE.x - POSE.width / 2, 1e-3)
    close(maxX, POSE.x + POSE.width / 2, 1e-3)
    close(minY, POSE.y - POSE.height / 2, 1e-3)
    close(maxY, POSE.y + POSE.height / 2, 1e-3)
  })

  it('draws facets back to front with finite shading', () => {
    const mesh = createPaperMesh('order')
    const frame = computePaperFrame(mesh, { ...POSE, unfold: 0.4 }, createPaperFrame(mesh))
    for (let rank = 1; rank < frame.order.length; rank += 1) {
      assert.ok(frame.depth[frame.order[rank]] >= frame.depth[frame.order[rank - 1]])
    }
    for (const shade of frame.shade) assert.ok(Number.isFinite(shade) && shade > 0)
  })

  it('unfolds every vertex from 0 to 1 over the animation', () => {
    for (const delay of [0, 0.1, 0.32]) {
      assert.equal(vertexUnfold(0, delay), 0)
      assert.equal(vertexUnfold(1, delay), 1)
      assert.ok(vertexUnfold(0.5, delay) > 0 && vertexUnfold(0.5, delay) < 1)
    }
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  claimCursorGuide,
  getCursorGuide,
  getCursorMode,
  setCursorMode,
  subscribeCursorGuide,
  subscribeCursorMode,
} from '../src/lib/cursorMode.ts'
import type { CursorGuide } from '../src/lib/cursorMode.ts'

describe('cursor mode', () => {
  it('tells listeners about each new mode once', () => {
    const heard: string[] = []
    const unsubscribe = subscribeCursorMode((mode) => heard.push(mode))
    setCursorMode('pencil')
    setCursorMode('pencil')
    setCursorMode('eraser')
    setCursorMode('pointer')
    unsubscribe()
    setCursorMode('grab')
    setCursorMode('pointer')
    assert.deepEqual(heard, ['pencil', 'eraser', 'pointer'])
    assert.equal(getCursorMode(), 'pointer')
  })
})

describe('guiding the cursor', () => {
  function listen() {
    const heard: Array<[CursorGuide | null, number]> = []
    const unsubscribe = subscribeCursorGuide((guide, owner) => heard.push([guide, owner]))
    return { heard, unsubscribe }
  }

  it('moves the cursor for whoever holds it, then gives it back to the pointer', () => {
    const { heard, unsubscribe } = listen()
    const guide = claimCursorGuide()
    assert.equal(guide.move({ x: 10, y: 20, tilt: 4 }), true)
    assert.equal(guide.move({ x: 12, y: 21, tilt: 3 }), true)
    assert.deepEqual(getCursorGuide(), { x: 12, y: 21, tilt: 3 })
    guide.release()
    assert.equal(getCursorGuide(), null)
    const [[, owner]] = heard
    assert.deepEqual(heard, [[{ x: 10, y: 20, tilt: 4 }, owner], [{ x: 12, y: 21, tilt: 3 }, owner], [null, owner]])
    // A guide that has let go cannot take the cursor back.
    assert.equal(guide.move({ x: 1, y: 1, tilt: 0 }), false)
    guide.release()
    assert.equal(heard.length, 3)
    unsubscribe()
  })

  it('lets the newest guide take over from an older one', () => {
    const { heard, unsubscribe } = listen()
    const older = claimCursorGuide()
    older.move({ x: 1, y: 2, tilt: 0 })
    const newer = claimCursorGuide()
    assert.equal(older.move({ x: 3, y: 4, tilt: 0 }), false)
    assert.equal(newer.move({ x: 5, y: 6, tilt: 1 }), true)
    // The older guide letting go must not pull the cursor away from the newer one.
    older.release()
    assert.deepEqual(getCursorGuide(), { x: 5, y: 6, tilt: 1 })
    newer.release()
    assert.equal(getCursorGuide(), null)
    const owners = heard.map(([, owner]) => owner)
    assert.notEqual(owners[0], owners[1])
    assert.deepEqual(heard.map(([guide]) => guide), [{ x: 1, y: 2, tilt: 0 }, { x: 5, y: 6, tilt: 1 }, null])
    unsubscribe()
  })

  it('gives the cursor back even when the newest guide never moved it', () => {
    const { heard, unsubscribe } = listen()
    const older = claimCursorGuide()
    older.move({ x: 1, y: 1, tilt: 0 })
    const newer = claimCursorGuide()
    newer.release()
    assert.equal(getCursorGuide(), null)
    assert.equal(heard[heard.length - 1][0], null)
    unsubscribe()
  })

  it('stops telling listeners that have gone, and refuses places it cannot put the cursor', () => {
    const { heard, unsubscribe } = listen()
    unsubscribe()
    const guide = claimCursorGuide()
    guide.move({ x: 0, y: 0, tilt: 0 })
    assert.equal(heard.length, 0)
    for (const bad of [{ x: NaN, y: 0, tilt: 0 }, { x: 0, y: Infinity, tilt: 0 }, { x: 0, y: 0, tilt: NaN }]) {
      assert.throws(() => guide.move(bad), /finite/)
    }
    guide.release()
  })
})

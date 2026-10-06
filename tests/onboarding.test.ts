import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  annularSectorPath,
  clampOnboardingStep,
  CONFETTI_SHAPES,
  CONFETTI_TONES,
  confettiPieces,
  ONBOARDING_STORAGE_KEY,
  onboardingConsistency,
  polarPoint,
  recordOnboardingProgress,
  shouldShowOnboarding,
  weekArcSpans,
} from '../src/lib/onboarding.ts'

class MemoryStorage {
  readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

class BrokenStorage extends MemoryStorage {
  override getItem(): string | null {
    throw new Error('SecurityError')
  }

  override setItem(): void {
    throw new Error('QuotaExceededError')
  }
}

describe('who sees the welcome guide', () => {
  it('greets a browser that has never used ANGELO', () => {
    const storage = new MemoryStorage()
    storage.setItem('some-other-site-key', '1')
    assert.equal(shouldShowOnboarding(storage), true)
  })

  it('leaves people who already used the app alone', () => {
    for (const key of ['angelo-routine-v1', 'angelo-session-v1', 'angelo-daily-visits-v1', 'angelo-paper-notes-v1:guest']) {
      const storage = new MemoryStorage()
      storage.setItem(key, '[]')
      assert.equal(shouldShowOnboarding(storage), false, key)
    }
  })

  it('comes back until the guide is finished or skipped', () => {
    const storage = new MemoryStorage()
    recordOnboardingProgress(storage, 'started')
    storage.setItem('angelo-routine-v1', '{}')
    assert.equal(shouldShowOnboarding(storage), true)

    recordOnboardingProgress(storage, 'done')
    assert.equal(storage.getItem(ONBOARDING_STORAGE_KEY), 'done')
    assert.equal(shouldShowOnboarding(storage), false)
  })

  it('never turns a finished guide back into an unfinished one', () => {
    const storage = new MemoryStorage()
    recordOnboardingProgress(storage, 'done')
    recordOnboardingProgress(storage, 'started')
    assert.equal(storage.getItem(ONBOARDING_STORAGE_KEY), 'done')
  })

  it('treats an unknown saved value like no record at all', () => {
    const fresh = new MemoryStorage()
    fresh.setItem(ONBOARDING_STORAGE_KEY, 'maybe')
    assert.equal(shouldShowOnboarding(fresh), true)

    fresh.setItem('angelo-routine-v1', '{}')
    assert.equal(shouldShowOnboarding(fresh), false)
  })

  it('stays quiet when storage is missing or refuses access', () => {
    assert.equal(shouldShowOnboarding(null), false)
    assert.equal(shouldShowOnboarding(new BrokenStorage()), false)
    assert.doesNotThrow(() => recordOnboardingProgress(new BrokenStorage(), 'done'))
    assert.doesNotThrow(() => recordOnboardingProgress(null, 'done'))
  })
})

describe('guide steps', () => {
  it('keeps navigation inside the three steps', () => {
    assert.equal(clampOnboardingStep(-1), 0)
    assert.equal(clampOnboardingStep(1), 1)
    assert.equal(clampOnboardingStep(1.7), 1)
    assert.equal(clampOnboardingStep(3), 2)
    assert.equal(clampOnboardingStep(Number.NaN), 0)
  })

  it('reports how much of the demo list is ticked', () => {
    assert.equal(onboardingConsistency([]), 0)
    assert.equal(onboardingConsistency([false, false, false]), 0)
    assert.equal(onboardingConsistency([true, false, false]), 33)
    assert.equal(onboardingConsistency([true, true, false]), 67)
    assert.equal(onboardingConsistency([true, true, true]), 100)
  })
})

describe('celebration confetti', () => {
  it('scatters every shape and tone from the same seed the same way', () => {
    const seeded = () => {
      let seed = 7
      return () => {
        seed = (seed * 16807) % 2147483647
        return (seed - 1) / 2147483646
      }
    }
    const first = confettiPieces(20, seeded())
    assert.deepEqual(first, confettiPieces(20, seeded()))
    assert.equal(first.length, 20)
    assert.deepEqual(new Set(first.map((piece) => piece.shape)), new Set(CONFETTI_SHAPES))
    assert.deepEqual(new Set(first.map((piece) => piece.tone)), new Set(CONFETTI_TONES))
    for (const piece of first) {
      assert.ok(piece.scale >= 0.55 && piece.scale <= 1.2, `scale ${piece.scale}`)
      assert.ok(piece.delay >= 0 && piece.delay <= 110, `delay ${piece.delay}`)
      assert.ok(Math.hypot(piece.dx, piece.dy + 36) <= 200, `distance ${piece.dx},${piece.dy}`)
    }
  })

  it('throws nothing for empty or odd counts', () => {
    assert.deepEqual(confettiPieces(0, Math.random), [])
    assert.deepEqual(confettiPieces(-3, Math.random), [])
    assert.equal(confettiPieces(2.9, Math.random).length, 2)
  })
})

describe('week arc geometry', () => {
  it('splits the open circle into seven equal days with gaps between them', () => {
    const spans = weekArcSpans()
    assert.equal(spans.length, 7)
    assert.deepEqual(spans[0], [1.5, 37.07])
    assert.deepEqual(spans[6], [232.93, 268.5])
    const widths = spans.map(([start, end]) => Math.round((end - start) * 10) / 10)
    assert.ok(widths.every((width) => width === widths[0]))
  })

  it('measures angles clockwise from twelve o\'clock', () => {
    assert.deepEqual(polarPoint(100, 100, 50, 0), [100, 50])
    assert.deepEqual(polarPoint(100, 100, 50, 90), [150, 100])
    assert.deepEqual(polarPoint(100, 100, 50, 180), [100, 150])
    assert.deepEqual(polarPoint(100, 100, 50, 270), [50, 100])
  })

  it('draws a closed ring cell between two radii', () => {
    assert.equal(
      annularSectorPath(100, 100, 40, 50, 0, 90),
      'M100 50A50 50 0 0 1 150 100L140 100A40 40 0 0 0 100 60Z',
    )
    assert.match(annularSectorPath(100, 100, 40, 50, 0, 200), /A50 50 0 1 1/)
  })
})

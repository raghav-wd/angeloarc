import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildFlashTimeline,
  fillNoise,
  FLASH_PALETTES,
  FLASH_REMINDER_DURATION,
  FLASH_REMINDER_MESSAGE,
  FLASH_WORDS,
  flashDuration,
  flashWordAt,
  pickReminder,
} from '../src/lib/flashReminder.ts'

function stubRandom(values: number[]): () => number {
  let call = 0
  return () => values[call++ % values.length]
}

describe('full page flash reminder', () => {
  it('spells the default reminder one flashed word at a time', () => {
    assert.equal(FLASH_REMINDER_MESSAGE, 'No excuses, just do it.')
    assert.deepEqual(FLASH_WORDS.map((word) => word.text), ['NO', 'EXCUSES,', 'JUST', 'DO', 'IT.'])
    assert.equal(FLASH_WORDS.map((word) => word.text).join(' '), FLASH_REMINDER_MESSAGE.toUpperCase())
    assert.deepEqual(FLASH_WORDS, buildFlashTimeline(FLASH_REMINDER_MESSAGE))
    assert.equal(FLASH_REMINDER_DURATION, flashDuration(FLASH_WORDS))
  })

  it('builds a timeline for any custom sentence', () => {
    const timeline = buildFlashTimeline('  Show   up anyway ')
    assert.deepEqual(timeline.map((word) => word.text), ['SHOW', 'UP', 'ANYWAY'])
    assert.deepEqual(timeline.map((word) => word.palette), ['black', 'white', 'brown'])
    const single = buildFlashTimeline('go')
    assert.equal(single.length, 1)
    assert.equal(single[0].start, 0)
    for (const invalid of ['', '   ', '\n\t']) {
      assert.throws(() => buildFlashTimeline(invalid), /at least one word/)
    }
  })

  it('cuts between bright mono palettes without repeating a background', () => {
    for (const message of [FLASH_REMINDER_MESSAGE, 'one two three four five six seven eight nine ten']) {
      const timeline = buildFlashTimeline(message)
      for (const word of timeline) {
        assert.equal(word.background, FLASH_PALETTES[word.palette].background)
        assert.equal(word.ink, FLASH_PALETTES[word.palette].ink)
      }
      for (let index = 1; index < timeline.length; index += 1) {
        assert.notEqual(timeline[index].background, timeline[index - 1].background)
      }
    }
    assert.deepEqual(FLASH_WORDS.map((word) => word.palette), ['black', 'white', 'brown', 'white', 'black'])
  })

  it('scales the typography up while long words still fit the viewport', () => {
    for (let index = 1; index < FLASH_WORDS.length; index += 1) {
      assert.ok(FLASH_WORDS[index].fontSizeVw > FLASH_WORDS[index - 1].fontSizeVw)
      assert.ok(FLASH_WORDS[index].stretch > FLASH_WORDS[index - 1].stretch)
    }
    assert.ok(FLASH_WORDS[FLASH_WORDS.length - 1].fontSizeVw >= FLASH_WORDS[0].fontSizeVw * 4)
    const longWords = buildFlashTimeline('extraordinary determination extraordinary determination')
    for (const word of longWords) {
      assert.ok(word.fontSizeVw * word.text.length <= 174.5)
      assert.ok(word.fontSizeVw > 0)
      assert.ok(word.stretch >= 1.32 && word.stretch <= 1.64)
    }
  })

  it('keeps every timeline quick but under photosensitivity limits', () => {
    assert.deepEqual(FLASH_WORDS.map((word) => word.start), [0, 520, 1115, 1635, 2155])
    assert.equal(FLASH_REMINDER_DURATION, 3025)
    for (const message of [FLASH_REMINDER_MESSAGE, 'go', 'a bb ccc dddd eeeee ffffff ggggggg hhhhhhhh interminable justonemore']) {
      const timeline = buildFlashTimeline(message)
      for (const word of timeline) {
        assert.ok(word.duration >= 520)
        assert.ok(word.duration <= 870)
      }
      assert.equal(timeline[timeline.length - 1].duration, 870)
      // Any three consecutive background cuts must span more than one second,
      // so no one-second window ever holds more than two flashes.
      for (let index = 2; index < timeline.length; index += 1) {
        assert.ok(timeline[index].start - timeline[index - 2].start > 1000)
      }
    }
  })

  it('reports the active word for any point of the animation', () => {
    for (const word of FLASH_WORDS) {
      assert.equal(flashWordAt(FLASH_WORDS, word.start)?.text, word.text)
      assert.equal(flashWordAt(FLASH_WORDS, word.start + word.duration - 1)?.text, word.text)
    }
    assert.equal(flashWordAt(FLASH_WORDS, FLASH_REMINDER_DURATION), null)
    assert.equal(flashWordAt(FLASH_WORDS, 60_000), null)
    for (const invalid of [-1, NaN, Infinity]) {
      assert.throws(() => flashWordAt(FLASH_WORDS, invalid), /timing/)
    }
  })

  it('picks a random reminder and falls back to the classic line', () => {
    const reminders = ['One more rep.', 'Show up anyway.', 'Future you is watching.']
    assert.equal(pickReminder(reminders, () => 0), 'One more rep.')
    assert.equal(pickReminder(reminders, () => 0.5), 'Show up anyway.')
    assert.equal(pickReminder(reminders, () => 0.999), 'Future you is watching.')
    assert.equal(pickReminder([], Math.random), FLASH_REMINDER_MESSAGE)
    assert.equal(pickReminder(['   ', ''], Math.random), FLASH_REMINDER_MESSAGE)
    assert.equal(pickReminder(['  ', 'Keep going.'], () => 0.9), 'Keep going.')
    for (const invalid of [-0.1, 1, NaN]) {
      assert.throws(() => pickReminder(reminders, () => invalid), /random/)
    }
  })

  it('generates deterministic salt-and-pepper static', () => {
    const speckled = fillNoise(new Uint8ClampedArray(8), stubRandom([0.1, 0.05, 0.5]))
    assert.deepEqual([...speckled], [0, 0, 0, 190, 0, 0, 0, 190])
    const dust = fillNoise(new Uint8ClampedArray(8), stubRandom([0.9, 0.5, 0.2]))
    assert.deepEqual([...dust], [255, 255, 255, 6, 255, 255, 255, 6])
    const silent = fillNoise(new Uint8ClampedArray(400), stubRandom([0.3, 0.6, 0.99]), 0)
    assert.ok([...silent].every((byte, index) => index % 4 !== 3 ? byte === 0 || byte === 255 : byte === 0))
  })

  it('rejects buffers and intensities the canvas could not draw', () => {
    assert.throws(() => fillNoise(new Uint8ClampedArray(0), Math.random), /RGBA/)
    assert.throws(() => fillNoise(new Uint8ClampedArray(7), Math.random), /RGBA/)
    for (const intensity of [-0.1, 1.1, NaN, Infinity]) {
      assert.throws(() => fillNoise(new Uint8ClampedArray(8), Math.random, intensity), /intensity/)
    }
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createRandom,
  ERASER_PACE,
  eraserStrokes,
  eraserWidth,
  measureStroke,
  PENCIL_PACE,
  planStrokes,
  pointAlong,
  SCRIBBLE_BOTTOM,
  SCRIBBLE_TOP,
  scribbleSeed,
  scribbleStrokes,
  strokeFrame,
  strokePath,
  strokeTurns,
  travelDuration,
} from '../src/lib/scribble.ts'
import type { ScribbleLine, ScribblePoint, ScribbleStroke } from '../src/lib/scribble.ts'

// A line of 12.5px text in an 18px row: the box its letters sit in.
const line: ScribbleLine = { left: 0, right: 112, top: 0.85, bottom: 17.15 }
const wrapped: ScribbleLine[] = [
  { left: 0, right: 168, top: 0.85, bottom: 17.15 },
  { left: 0, right: 64, top: 18.85, bottom: 35.15 },
]

function distanceToStroke([x, y]: ScribblePoint, stroke: ScribbleStroke): number {
  let best = Infinity
  for (let index = 1; index < stroke.points.length; index += 1) {
    const [ax, ay] = stroke.points[index - 1]
    const [bx, by] = stroke.points[index]
    const length = (bx - ax) ** 2 + (by - ay) ** 2
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / length))
    best = Math.min(best, Math.hypot(x - (ax + (bx - ax) * t), y - (ay + (by - ay) * t)))
  }
  return best
}

function directionChanges(stroke: ScribbleStroke): number {
  let changes = 0
  let direction = 0
  for (let index = 1; index < stroke.points.length; index += 1) {
    const dy = stroke.points[index][1] - stroke.points[index - 1][1]
    if (Math.abs(dy) < 1e-6) continue
    if (direction !== 0 && Math.sign(dy) !== direction) changes += 1
    direction = Math.sign(dy)
  }
  return changes
}

describe('scribble seeds and randomness', () => {
  it('turns the same labels into the same seed, and different ones into different seeds', () => {
    assert.equal(scribbleSeed('habit-1', '2026-10-10'), scribbleSeed('habit-1', '2026-10-10'))
    assert.notEqual(scribbleSeed('habit-1', '2026-10-10'), scribbleSeed('habit-1', '2026-10-11'))
    assert.notEqual(scribbleSeed('habit-1', '2026-10-10'), scribbleSeed('habit-2', '2026-10-10'))
    assert.notEqual(scribbleSeed('ab', 'c'), scribbleSeed('a', 'bc'))
    const seed = scribbleSeed('anything')
    assert.ok(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32)
  })

  it('repeats the same numbers for the same seed, all within [0, 1)', () => {
    const first = createRandom(42)
    const second = createRandom(42)
    const other = createRandom(43)
    const run = Array.from({ length: 200 }, () => first())
    assert.deepEqual(run, Array.from({ length: 200 }, () => second()))
    assert.notDeepEqual(run.slice(0, 5), Array.from({ length: 5 }, () => other()))
    assert.ok(run.every((value) => value >= 0 && value < 1))
    assert.throws(() => createRandom(NaN), /finite/)
  })
})

describe('hand-drawn zig-zag', () => {
  it('draws one stroke per line, the same way every time for one seed', () => {
    const strokes = scribbleStrokes(wrapped, 7)
    assert.equal(strokes.length, 2)
    assert.deepEqual(scribbleStrokes(wrapped, 7), strokes)
    assert.notDeepEqual(scribbleStrokes(wrapped, 8)[0].points, strokes[0].points)
    // Each line of a wrapped name gets its own look.
    assert.notDeepEqual(
      strokes[0].points.slice(0, 6).map(([, y]) => y),
      strokes[1].points.slice(0, 6).map(([, y]) => y - 18),
    )
  })

  it('runs from just before the words to just after them, always moving on', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const [stroke] = scribbleStrokes([line], seed)
      const first = stroke.points[0]
      const last = stroke.points[stroke.points.length - 1]
      assert.ok(first[0] < line.left && first[0] > line.left - 4, `starts just before the text (${seed})`)
      assert.ok(last[0] > line.right && last[0] < line.right + 6, `ends just after the text (${seed})`)
      for (let index = 1; index < stroke.points.length; index += 1) {
        assert.ok(stroke.points[index][0] >= stroke.points[index - 1][0] - 1e-9, 'never doubles back')
      }
    }
  })

  it('zig-zags across the middle of the letters without straying off the line', () => {
    const height = line.bottom - line.top
    const top = line.top + height * SCRIBBLE_TOP
    const bottom = line.top + height * SCRIBBLE_BOTTOM
    const reach = bottom - top
    for (let seed = 0; seed < 40; seed += 1) {
      const [stroke] = scribbleStrokes([line], seed)
      const ys = stroke.points.map(([, y]) => y)
      assert.ok(Math.min(...ys) >= top - reach * 0.2 && Math.max(...ys) <= bottom + reach * 0.2, `within the band (${seed})`)
      assert.ok(Math.max(...ys) - Math.min(...ys) > reach * 0.7, `covers most of the band (${seed})`)
      // Strokes of roughly 7.5 to 10 pixels each, turning back at every one.
      const turns = directionChanges(stroke)
      const width = line.right - line.left
      assert.ok(turns >= width / 10.2 - 2 && turns <= width / 7.4 + 2, `${turns} turns (${seed})`)
    }
  })

  it('rounds its turns into many small steps and gives a path the browser can draw', () => {
    const [stroke] = scribbleStrokes([line], 3)
    assert.ok(stroke.points.length > directionChanges(stroke) * 4)
    const path = strokePath(stroke)
    assert.match(path, /^M-?\d/)
    assert.equal(path.match(/M/g)?.length, 1)
    assert.equal(path.match(/L/g)?.length, stroke.points.length - 1)
    assert.doesNotMatch(path, /NaN|Infinity/)
  })

  it('refuses lines it cannot draw through', () => {
    assert.throws(() => scribbleStrokes([{ left: 10, right: 5, top: 0, bottom: 10 }], 1), /lines/)
    assert.throws(() => scribbleStrokes([{ left: 0, right: 5, top: 10, bottom: 10 }], 1), /lines/)
    assert.throws(() => scribbleStrokes([{ left: 0, right: NaN, top: 0, bottom: 10 }], 1), /lines/)
    assert.deepEqual(scribbleStrokes([], 1), [])
  })
})

describe('strokes as paths to follow', () => {
  const stroke = measureStroke([[0, 0], [3, 4], [3, 10]])

  it('measures the distance to every point', () => {
    assert.deepEqual(stroke.stops, [0, 5, 11])
    assert.equal(stroke.length, 11)
    assert.throws(() => measureStroke([]), /point/)
  })

  it('finds the point and the way of travel at any distance, clamped to the ends', () => {
    assert.deepEqual(pointAlong(stroke, 0).point, [0, 0])
    assert.deepEqual(pointAlong(stroke, 2.5), { point: [1.5, 2], heading: [0.6, 0.8] })
    assert.deepEqual(pointAlong(stroke, 8), { point: [3, 7], heading: [0, 1] })
    assert.deepEqual(pointAlong(stroke, 11).point, [3, 10])
    assert.deepEqual(pointAlong(stroke, -4).point, [0, 0])
    assert.deepEqual(pointAlong(stroke, 40).point, [3, 10])
    assert.deepEqual(pointAlong(measureStroke([[2, 2]]), 1), { point: [2, 2], heading: [1, 0] })
    assert.throws(() => pointAlong(stroke, NaN), /finite/)
  })
})

describe('eraser rubbing', () => {
  it('works back and forth along the whole line', () => {
    const [rub] = eraserStrokes([line], 11)
    const xs = rub.points.map(([x]) => x)
    assert.ok(xs[0] < line.left - 3 && xs[xs.length - 1] > line.right + 3)
    const turns = strokeTurns(rub)
    // About one rub, there and back, every two dozen pixels.
    assert.ok(turns.length >= 8 && turns.length <= 12, `${turns.length} turns`)
    assert.ok(turns.every((distance, index) => distance > 0 && distance < rub.length && (index === 0 || distance > turns[index - 1])))
    assert.deepEqual(eraserStrokes([line], 11), [rub])
  })

  it('leaves nothing of the scribble behind', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const scribbles = scribbleStrokes(wrapped, seed)
      const rubs = eraserStrokes(wrapped, seed)
      wrapped.forEach((box, index) => {
        // The rub is stroked this wide; the ink itself is about 1.2px wide.
        const reach = eraserWidth(box) / 2 - 0.6
        for (const point of scribbles[index].points) {
          assert.ok(distanceToStroke(point, rubs[index]) <= reach, `seed ${seed}, line ${index}`)
        }
      })
    }
  })

  it('finds where a stroke turns back sideways', () => {
    const zig = measureStroke([[0, 0], [10, 0], [4, 1], [4, 5], [12, 6]])
    assert.deepEqual(strokeTurns(zig), [10, zig.stops[3]])
    assert.deepEqual(strokeTurns(measureStroke([[0, 0], [5, 0], [9, 2]])), [])
  })
})

describe('timing a scribble', () => {
  const strokes = scribbleStrokes(wrapped, 5)
  const from: ScribblePoint = [220, 9]

  it('travels to the first line, draws it, lifts across to the next and draws that', () => {
    const plan = planStrokes(strokes, PENCIL_PACE, from)
    assert.deepEqual(plan.legs.map((leg) => leg.kind), ['travel', 'stroke', 'travel', 'stroke'])
    let time = 0
    for (const leg of plan.legs) {
      assert.equal(leg.start, time)
      assert.ok(leg.duration > 0)
      time += leg.duration
    }
    assert.equal(plan.duration, time)
    // Longer lines take longer; a line of a hundred-odd pixels takes about half a second.
    const [first, second] = plan.legs.filter((leg) => leg.kind === 'stroke')
    assert.ok(first.duration > second.duration)
    const single = planStrokes(scribbleStrokes([line], 5), PENCIL_PACE)
    assert.ok(single.duration > 250 && single.duration < 650, `${single.duration}ms`)
    assert.deepEqual(planStrokes(strokes, ERASER_PACE).legs.map((leg) => leg.kind), ['stroke', 'travel', 'stroke'])
  })

  it('takes longer to travel further, within limits', () => {
    assert.equal(travelDuration([0, 0], [0, 0]), 90)
    assert.ok(travelDuration([0, 0], [100, 0]) > travelDuration([0, 0], [40, 0]))
    assert.equal(travelDuration([0, 0], [2000, 0]), 200)
  })

  it('starts where the cursor was and finishes with every line drawn', () => {
    const plan = planStrokes(strokes, PENCIL_PACE, from)
    const start = strokeFrame(plan, 0)
    assert.deepEqual(start.point, from)
    assert.deepEqual(start.drawn, [0, 0])
    assert.equal(start.touching, false)
    assert.equal(start.done, false)
    const end = strokeFrame(plan, plan.duration)
    assert.deepEqual(end.drawn, strokes.map((stroke) => stroke.length))
    assert.deepEqual(end.point, strokes[1].points[strokes[1].points.length - 1])
    assert.equal(end.done, true)
    assert.deepEqual(strokeFrame(plan, plan.duration * 3), end)
  })

  it('keeps the tool on the line it is drawing, and lifted between lines', () => {
    const plan = planStrokes(strokes, PENCIL_PACE, from)
    let last = [0, 0]
    for (let elapsed = 0; elapsed <= plan.duration; elapsed += 8) {
      const frame = strokeFrame(plan, elapsed)
      frame.drawn.forEach((drawn, index) => {
        assert.ok(drawn >= last[index] - 1e-9, 'lines only ever grow')
        assert.ok(drawn >= 0 && drawn <= strokes[index].length + 1e-9)
      })
      last = frame.drawn
      assert.ok(Math.abs(Math.hypot(...frame.heading) - 1) < 1e-6)
      assert.ok(frame.leg >= 0 && frame.leg <= 1)
      const leg = plan.legs.find((candidate) => elapsed < candidate.start + candidate.duration) ?? plan.legs[plan.legs.length - 1]
      if (leg.kind === 'stroke') {
        assert.equal(frame.touching, true)
        const at = pointAlong(strokes[leg.stroke], frame.drawn[leg.stroke]).point
        assert.ok(Math.hypot(at[0] - frame.point[0], at[1] - frame.point[1]) < 1e-9, 'the tip is where the line ends')
      } else {
        assert.equal(frame.touching, false)
      }
    }
  })

  it('refuses plans and timings it cannot follow', () => {
    assert.throws(() => planStrokes(strokes, { base: -1, speed: 1 }), /pace/)
    assert.throws(() => planStrokes(strokes, { base: 0, speed: 0 }), /pace/)
    assert.throws(() => planStrokes(strokes, PENCIL_PACE, [NaN, 0]), /finite point/)
    const plan = planStrokes(strokes, PENCIL_PACE)
    for (const elapsed of [-1, NaN, Infinity]) assert.throws(() => strokeFrame(plan, elapsed), /nonnegative/)
    assert.throws(() => strokeFrame(planStrokes([], PENCIL_PACE), 0), /at least one stroke/)
  })
})

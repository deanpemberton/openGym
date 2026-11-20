import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendWatchHrTrace } from './watch-sync.js'

const t0 = Date.parse('2026-11-20T08:00:00Z')

test('watch HR samples merge in timestamp order, deduplicate replay, and reject bad readings', () => {
  const w = { id: 'gym-1', start: t0, end: t0 + 600000, entries: [] }
  const s = { active: w, workouts: [] }
  assert.equal(appendWatchHrTrace(s, 'gym-1', [[t0 + 20000, 126], [t0 + 10000, 116]]), true)
  assert.deepEqual(w.hrTrace, [[t0 + 10000, 116], [t0 + 20000, 126]])
  assert.equal(appendWatchHrTrace(s, 'gym-1', [[t0 + 20000, 126]]), false)
  assert.equal(appendWatchHrTrace(s, 'gym-1', [[t0 + 30000, 241], [t0 - 100000, 99]]), false)
  assert.equal(appendWatchHrTrace(s, 'other', [[t0 + 30000, 150]]), false)
  assert.equal(appendWatchHrTrace(s, 'gym-1', [[t0 + 30000, 150]]), true)
  assert.deepEqual(w.hrTrace.map(x => x[1]), [116,126,150])
})

test('late HR chunks update only their saved workout and retain a change stamp', () => {
  const w = { id: 'gym-1', start: t0, end: t0 + 600000, entries: [] }
  const other = { id: 'gym-2', start: t0, end: t0 + 600000, entries: [] }
  const s = { active: null, workouts: [w, other] }
  let stamps = 0
  const stamp = () => { stamps++ }
  assert.equal(appendWatchHrTrace(s, 'gym-1', [[t0 + 40000, 110]], stamp), true)
  assert.equal(appendWatchHrTrace(s, 'gym-1', [[t0 + 40000, 110]], stamp), false)
  assert.equal(stamps, 1)
  assert.equal(other.hrTrace, undefined)
})

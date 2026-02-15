import assert from 'node:assert/strict'
import test from 'node:test'

import { advanceSseCursor, detectSseSequenceGap } from '../src/lib/sse.ts'

test('detectSseSequenceGap: returns gap when sequence skips forward', () => {
  assert.deepEqual(detectSseSequenceGap('10', '13'), {
    previous: 10,
    expected: 11,
    current: 13,
  })
})

test('detectSseSequenceGap: no gap for contiguous or duplicate ids', () => {
  assert.equal(detectSseSequenceGap('10', '11'), null)
  assert.equal(detectSseSequenceGap('11', '11'), null)
  assert.equal(detectSseSequenceGap('11', '10'), null)
})

test('detectSseSequenceGap: ignores missing/non-numeric ids', () => {
  assert.equal(detectSseSequenceGap('', '2'), null)
  assert.equal(detectSseSequenceGap('abc', '2'), null)
  assert.equal(detectSseSequenceGap('2', 'x'), null)
})

test('advanceSseCursor: rejects duplicate and out-of-order numeric ids', () => {
  const duplicate = advanceSseCursor('12', '12')
  assert.equal(duplicate.accepted, false)
  assert.equal(duplicate.nextCursor, '12')

  const outOfOrder = advanceSseCursor('12', '11')
  assert.equal(outOfOrder.accepted, false)
  assert.equal(outOfOrder.nextCursor, '12')
})

test('advanceSseCursor: accepts forward ids and reports gaps', () => {
  const contiguous = advanceSseCursor('12', '13')
  assert.equal(contiguous.accepted, true)
  assert.equal(contiguous.nextCursor, '13')
  assert.equal(contiguous.gap, null)

  const gap = advanceSseCursor('12', '15')
  assert.equal(gap.accepted, true)
  assert.deepEqual(gap.gap, { previous: 12, expected: 13, current: 15 })
})

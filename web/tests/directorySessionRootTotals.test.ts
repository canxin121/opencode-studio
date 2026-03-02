import assert from 'node:assert/strict'
import test from 'node:test'

import { applyRootTotalDelta, computeRootTotalDeltas } from '../src/stores/directorySessions/rootTotals'

test('unknown summary upsert does not optimistically increase root totals', () => {
  const deltas = computeRootTotalDeltas({
    previousDirectoryId: '',
    nextDirectoryId: 'dir_a',
    previousParentId: null,
    nextParentId: null,
    hadPrevious: false,
    trustAsNewRoot: false,
  })

  assert.deepEqual(deltas, {})
})

test('created root summary can increment root totals when trusted', () => {
  const deltas = computeRootTotalDeltas({
    previousDirectoryId: '',
    nextDirectoryId: 'dir_a',
    previousParentId: null,
    nextParentId: null,
    hadPrevious: false,
    trustAsNewRoot: true,
  })

  assert.deepEqual(deltas, { dir_a: 1 })
})

test('same-directory parent transitions update root totals', () => {
  const toChild = computeRootTotalDeltas({
    previousDirectoryId: 'dir_a',
    nextDirectoryId: 'dir_a',
    previousParentId: null,
    nextParentId: 'root_1',
    hadPrevious: true,
  })
  assert.deepEqual(toChild, { dir_a: -1 })

  const toRoot = computeRootTotalDeltas({
    previousDirectoryId: 'dir_a',
    nextDirectoryId: 'dir_a',
    previousParentId: 'root_1',
    nextParentId: null,
    hadPrevious: true,
  })
  assert.deepEqual(toRoot, { dir_a: 1 })
})

test('moving a root between directories decrements then increments totals', () => {
  const deltas = computeRootTotalDeltas({
    previousDirectoryId: 'dir_a',
    nextDirectoryId: 'dir_b',
    previousParentId: null,
    nextParentId: null,
    hadPrevious: true,
  })

  assert.deepEqual(deltas, { dir_a: -1, dir_b: 1 })
})

test('applyRootTotalDelta keeps totals non-negative', () => {
  assert.equal(applyRootTotalDelta(17, 2), 19)
  assert.equal(applyRootTotalDelta(0, -3), 0)
  assert.equal(applyRootTotalDelta(2.8, -2.1), 0)
})

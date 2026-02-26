import assert from 'node:assert/strict'
import test from 'node:test'

import { clearRevertBoundary, shouldClearRevertBoundary } from '../src/stores/chat/revertState'

test('shouldClearRevertBoundary returns false when session has no revert state', () => {
  assert.equal(shouldClearRevertBoundary({ id: 's1' }, 'm3'), false)
})

test('shouldClearRevertBoundary keeps revert marker for older message ids', () => {
  assert.equal(shouldClearRevertBoundary({ id: 's1', revert: { messageID: 'm5' } }, 'm4'), false)
})

test('shouldClearRevertBoundary clears marker at boundary id', () => {
  assert.equal(shouldClearRevertBoundary({ id: 's1', revert: { messageID: 'm5' } }, 'm5'), true)
})

test('shouldClearRevertBoundary clears marker for newer message ids', () => {
  assert.equal(shouldClearRevertBoundary({ id: 's1', revert: { messageID: 'm5' } }, 'm6'), true)
})

test('clearRevertBoundary removes revert and preserves other fields', () => {
  const session = {
    id: 's1',
    title: 'demo',
    revert: { messageID: 'm5' },
  }
  assert.deepEqual(clearRevertBoundary(session), { id: 's1', title: 'demo' })
})

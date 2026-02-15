import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveSidebarSeqAfterBootstrap } from '../src/stores/directorySessionSeq.ts'
import { nextPatchSeqState } from '../src/stores/directorySessionPatchSeq.ts'

test('nextPatchSeqState: gap enters out-of-sync, bootstrap recovers, then resumes', () => {
  let state = { lastSeq: 0, outOfSync: false, sawReset: false }

  // Apply first patch.
  let d1 = nextPatchSeqState(state, 1)
  assert.equal(d1.action, 'apply')
  state = d1.next
  assert.equal(state.lastSeq, 1)
  assert.equal(state.outOfSync, false)

  // Gap to 3 should enter out-of-sync.
  let d2 = nextPatchSeqState(state, 3)
  assert.equal(d2.action, 'enter-out-of-sync')
  state = d2.next
  assert.equal(state.outOfSync, true)

  // REST bootstrap succeeds; seq baseline stays at 1.
  const nextSeq = resolveSidebarSeqAfterBootstrap({
    currentSeq: state.lastSeq,
    bootstrapSeq: 1,
    outOfSync: state.outOfSync,
    sawReset: state.sawReset,
  })
  state = { lastSeq: nextSeq, outOfSync: false, sawReset: false }
  assert.equal(state.lastSeq, 1)

  // Now we can apply seq=2.
  const d3 = nextPatchSeqState(state, 2)
  assert.equal(d3.action, 'apply')
  assert.equal(d3.next.lastSeq, 2)
  assert.equal(d3.next.outOfSync, false)
})

test('nextPatchSeqState: reset marks sawReset so bootstrap can accept new floor', () => {
  let state = { lastSeq: 10, outOfSync: false, sawReset: false }
  const d1 = nextPatchSeqState(state, 5)
  assert.equal(d1.action, 'enter-out-of-sync')
  assert.equal(d1.reason, 'reset')
  assert.equal(d1.next.sawReset, true)

  const nextSeq = resolveSidebarSeqAfterBootstrap({
    currentSeq: d1.next.lastSeq,
    bootstrapSeq: 3,
    outOfSync: d1.next.outOfSync,
    sawReset: d1.next.sawReset,
  })
  assert.equal(nextSeq, 3)
})

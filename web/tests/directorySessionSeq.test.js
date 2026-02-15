import assert from 'node:assert/strict'
import test from 'node:test'

import {
  mergeSidebarSeqBaseline,
  normalizeSidebarSeq,
  resolveSidebarSeqAfterBootstrap,
} from '../src/stores/directorySessionSeq.ts'

test('normalizeSidebarSeq: clamps invalid values to zero', () => {
  assert.equal(normalizeSidebarSeq(undefined), 0)
  assert.equal(normalizeSidebarSeq(null), 0)
  assert.equal(normalizeSidebarSeq('4'), 0)
  assert.equal(normalizeSidebarSeq(-2), 0)
  assert.equal(normalizeSidebarSeq(0), 0)
  assert.equal(normalizeSidebarSeq(3.8), 3)
})

test('mergeSidebarSeqBaseline: advances only when bootstrap sequence is newer', () => {
  assert.equal(mergeSidebarSeqBaseline(0, 0), 0)
  assert.equal(mergeSidebarSeqBaseline(5, undefined), 5)
  assert.equal(mergeSidebarSeqBaseline(5, 4), 5)
  assert.equal(mergeSidebarSeqBaseline(5, 8), 8)
})

test('resolveSidebarSeqAfterBootstrap: accepts restart baseline after reset', () => {
  assert.equal(
    resolveSidebarSeqAfterBootstrap({
      currentSeq: 120,
      bootstrapSeq: 7,
      outOfSync: true,
      sawReset: true,
    }),
    7,
  )
})

test('resolveSidebarSeqAfterBootstrap: keeps monotonic baseline for non-reset gaps', () => {
  assert.equal(
    resolveSidebarSeqAfterBootstrap({
      currentSeq: 120,
      bootstrapSeq: 118,
      outOfSync: true,
      sawReset: false,
    }),
    120,
  )
  assert.equal(
    resolveSidebarSeqAfterBootstrap({
      currentSeq: 120,
      bootstrapSeq: 130,
      outOfSync: true,
      sawReset: false,
    }),
    130,
  )
})

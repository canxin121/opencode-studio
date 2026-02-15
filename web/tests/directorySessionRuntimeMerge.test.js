import assert from 'node:assert/strict'
import test from 'node:test'

import { mergeRuntimeState } from '../src/stores/directorySessionRuntime.ts'

test('mergeRuntimeState: newer attention=null clears existing attention', () => {
  const next = mergeRuntimeState(
    {
      statusType: 'busy',
      phase: 'busy',
      attention: 'permission',
      updatedAt: 100,
    },
    {
      statusType: 'busy',
      phase: 'busy',
      attention: null,
      updatedAt: 110,
    },
  )

  assert.equal(next.attention, null)
})

test('mergeRuntimeState: newer payload without attention keeps existing attention', () => {
  const next = mergeRuntimeState(
    {
      statusType: 'busy',
      phase: 'busy',
      attention: 'question',
      updatedAt: 100,
    },
    {
      statusType: 'busy',
      phase: 'busy',
      updatedAt: 110,
    },
  )

  assert.equal(next.attention, 'question')
})

test('mergeRuntimeState: stale payload cannot clear newer attention', () => {
  const next = mergeRuntimeState(
    {
      statusType: 'busy',
      phase: 'busy',
      attention: 'permission',
      updatedAt: 200,
    },
    {
      statusType: 'idle',
      phase: 'idle',
      attention: null,
      updatedAt: 120,
    },
  )

  assert.equal(next.attention, 'permission')
})

test('mergeRuntimeState: untimestamped payload does not override timestamped runtime', () => {
  const next = mergeRuntimeState(
    {
      statusType: 'busy',
      phase: 'busy',
      attention: 'permission',
      updatedAt: 200,
    },
    {
      statusType: 'idle',
      phase: 'idle',
      attention: null,
    },
  )

  assert.equal(next.statusType, 'busy')
  assert.equal(next.phase, 'busy')
  assert.equal(next.attention, 'permission')
  assert.equal(next.updatedAt, 200)
})

test('mergeRuntimeState: untimestamped payload can seed empty runtime', () => {
  const next = mergeRuntimeState(undefined, {
    statusType: 'busy',
    phase: 'busy',
    attention: null,
  })

  assert.equal(next.statusType, 'busy')
  assert.equal(next.phase, 'busy')
  assert.equal(next.updatedAt, 0)
})

test('mergeRuntimeState: two clients converge after reconnect replay gap', () => {
  let deviceA
  deviceA = mergeRuntimeState(deviceA, { statusType: 'busy', phase: 'busy', updatedAt: 100 })
  deviceA = mergeRuntimeState(deviceA, { attention: 'permission', updatedAt: 110 })
  deviceA = mergeRuntimeState(deviceA, { statusType: 'idle', phase: 'idle', attention: null, updatedAt: 150 })

  let deviceB
  // Reconnect fallback can seed from stale/untimestamped state before replay catches up.
  deviceB = mergeRuntimeState(deviceB, { statusType: 'idle', phase: 'idle' })
  deviceB = mergeRuntimeState(deviceB, { statusType: 'busy', phase: 'busy', updatedAt: 100 })
  deviceB = mergeRuntimeState(deviceB, { attention: 'permission', updatedAt: 110 })
  deviceB = mergeRuntimeState(deviceB, { statusType: 'idle', phase: 'idle', attention: null, updatedAt: 150 })

  assert.deepEqual(deviceB, deviceA)
})

test('mergeRuntimeState: stale reconnect payload cannot regress converged state', () => {
  const converged = mergeRuntimeState(undefined, {
    statusType: 'idle',
    phase: 'idle',
    attention: null,
    updatedAt: 220,
  })

  const afterStaleReplay = mergeRuntimeState(converged, {
    statusType: 'busy',
    phase: 'busy',
    attention: 'question',
    updatedAt: 180,
  })

  assert.deepEqual(afterStaleReplay, converged)
})

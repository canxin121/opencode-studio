import assert from 'node:assert/strict'
import test from 'node:test'

import { hasActiveRuntimeInDirectoryScope } from '../src/stores/directorySessions/runtimeDirectoryActivity'
import { runtimePatchWithEventTimestamp } from '../src/stores/directorySessions/runtimeEvent'

test('runtimePatchWithEventTimestamp uses fallback timestamp when event has no ts', () => {
  const patched = runtimePatchWithEventTimestamp({ statusType: 'idle' }, undefined, 1234)
  assert.equal(patched.updatedAt, 1234)
  assert.equal(patched.statusType, 'idle')
})

test('runtimePatchWithEventTimestamp keeps upstream timestamp when present', () => {
  const patched = runtimePatchWithEventTimestamp({ statusType: 'busy' }, 99, 1234)
  assert.equal(patched.updatedAt, 99)
  assert.equal(patched.statusType, 'busy')
})

test('directory runtime activity check works without aggregated page cache', () => {
  const active = hasActiveRuntimeInDirectoryScope({
    directoryId: 'dir_1',
    directoryPath: '/tmp/project',
    runtimeBySessionId: {
      ses_running: {
        statusType: 'busy',
        phase: 'busy',
        attention: null,
        updatedAt: 30,
      },
    },
    directoryIdBySessionId: {
      ses_running: 'dir_1',
    },
    sessionSummariesById: {
      ses_running: {
        id: 'ses_running',
        directory: '/tmp/project',
      },
    },
    runningIndex: [],
    includeCooldown: true,
  })
  assert.equal(active, true)
})

test('directory runtime activity can match by running-index path when directory id is missing', () => {
  const active = hasActiveRuntimeInDirectoryScope({
    directoryId: 'dir_1',
    directoryPath: '/tmp/project',
    runtimeBySessionId: {
      ses_running: {
        statusType: 'busy',
        phase: 'busy',
        attention: null,
        updatedAt: 30,
      },
    },
    directoryIdBySessionId: {},
    sessionSummariesById: {},
    runningIndex: [
      {
        sessionId: 'ses_running',
        directoryId: null,
        directoryPath: '/tmp/project',
        runtime: {
          statusType: 'busy',
          phase: 'busy',
          attention: null,
          updatedAt: 30,
        },
        updatedAt: 30,
      },
    ],
    includeCooldown: true,
  })
  assert.equal(active, true)
})

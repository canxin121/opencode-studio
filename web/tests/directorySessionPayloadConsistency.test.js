import assert from 'node:assert/strict'
import test from 'node:test'

import { parseSessionPayloadConsistency } from '../src/stores/sessionConsistency.ts'

test('parseSessionPayloadConsistency: keeps degraded metadata', () => {
  const consistency = parseSessionPayloadConsistency({
    degraded: true,
    staleReads: 2,
    retryAfterMs: 180,
  })

  assert.equal(consistency?.degraded, true)
  assert.equal(consistency?.staleReads, 2)
  assert.equal(consistency?.retryAfterMs, 180)
})

test('parseSessionPayloadConsistency: ignores non-degraded payloads', () => {
  const consistency = parseSessionPayloadConsistency({
    degraded: false,
    staleReads: 10,
  })

  assert.equal(consistency, undefined)
})

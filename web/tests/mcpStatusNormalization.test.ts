import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeMcpStatus } from '../src/lib/mcpStatus'

test('normalizeMcpStatus reads record payloads keyed by server name', () => {
  const payload = {
    github: { status: 'connected' },
    stripe: { status: 'failed', error: 'bad token' },
  }

  const items = normalizeMcpStatus(payload)
  assert.equal(items.length, 2)
  assert.equal(items[0]?.name, 'github')
  assert.equal(items[0]?.status, 'connected')
  assert.equal(items[1]?.name, 'stripe')
  assert.equal(items[1]?.error, 'bad token')
})

test('normalizeMcpStatus reads array payloads with embedded names', () => {
  const payload = [
    { name: 'github', status: 'connected' },
    { id: 'local', connected: true },
  ]

  const items = normalizeMcpStatus(payload)
  assert.equal(items.length, 2)
  assert.equal(items[0]?.name, 'github')
  assert.equal(items[1]?.name, 'local')
  assert.equal(items[1]?.status, 'connected')
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeLspRuntimeList } from '../src/lib/lspRuntime'

test('normalizeLspRuntimeList filters mixed-session payloads to active session', () => {
  const payload = {
    items: [
      { id: 'rust-analyzer', sessionID: 'ses_1', rootDir: '/repo/a', status: 'connected' },
      { id: 'tsserver', sessionId: 'ses_2', rootDir: '/repo/b', status: 'connected' },
      { id: 'clangd', session_id: 'ses_1', rootDir: '/repo/a', status: 'ready' },
    ],
  }

  const items = normalizeLspRuntimeList(payload, { sessionId: 'ses_1' })
  assert.equal(items.length, 2)
  assert.ok(items.every((item) => item.sessionID === 'ses_1'))
})

test('normalizeLspRuntimeList keeps payload when session ids are omitted', () => {
  const payload = {
    items: [
      { id: 'rust-analyzer', rootDir: '/repo/a', status: 'connected' },
      { id: 'tsserver', rootDir: '/repo/a', status: 'connected' },
    ],
  }

  const items = normalizeLspRuntimeList(payload, { sessionId: 'ses_1' })
  assert.equal(items.length, 2)
})

test('normalizeLspRuntimeList reads current-session bucket payloads', () => {
  const payload = {
    ses_1: {
      items: [{ id: 'rust-analyzer', rootDir: '/repo/a', status: 'connected' }],
    },
    ses_2: {
      items: [{ id: 'tsserver', rootDir: '/repo/b', status: 'connected' }],
    },
  }

  const items = normalizeLspRuntimeList(payload, { sessionId: 'ses_1' })
  assert.equal(items.length, 1)
  assert.equal(items[0]?.id, 'rust-analyzer')
})

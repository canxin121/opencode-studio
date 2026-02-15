import assert from 'node:assert/strict'
import test from 'node:test'

import { extractSessionActivityUpdate } from '../src/lib/sessionActivityEvent.js'

test('extractSessionActivityUpdate: opencode-studio:session-activity passthrough', () => {
  const evt = { type: 'opencode-studio:session-activity', properties: { sessionID: 's1', phase: 'busy' } }
  assert.deepEqual(extractSessionActivityUpdate(evt), { sessionID: 's1', phase: 'busy' })
})

test('extractSessionActivityUpdate: session.status busy maps to busy', () => {
  const evt = { type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } }
  assert.deepEqual(extractSessionActivityUpdate(evt), { sessionID: 's1', phase: 'busy' })
})

test('extractSessionActivityUpdate: session.status retry maps to busy', () => {
  const evt = {
    type: 'session.status',
    properties: { sessionID: 's1', status: { type: 'retry', attempt: 2, next: 0 } },
  }
  assert.deepEqual(extractSessionActivityUpdate(evt), { sessionID: 's1', phase: 'busy' })
})

test('extractSessionActivityUpdate: session.status idle maps to idle', () => {
  const evt = { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } }
  assert.deepEqual(extractSessionActivityUpdate(evt), { sessionID: 's1', phase: 'idle' })
})

test('extractSessionActivityUpdate: session.idle maps to idle', () => {
  const evt = { type: 'session.idle', properties: { sessionID: 's1' } }
  assert.deepEqual(extractSessionActivityUpdate(evt), { sessionID: 's1', phase: 'idle' })
})

test('extractSessionActivityUpdate: session.error maps to idle', () => {
  const evt = { type: 'session.error', properties: { sessionID: 's1', error: { message: 'boom' } } }
  assert.deepEqual(extractSessionActivityUpdate(evt), { sessionID: 's1', phase: 'idle' })
})

test('extractSessionActivityUpdate: accepts camelCase sessionId', () => {
  const evt = { type: 'session.status', properties: { sessionId: 's1', status: { type: 'busy' } } }
  assert.deepEqual(extractSessionActivityUpdate(evt), { sessionID: 's1', phase: 'busy' })
})

test('extractSessionActivityUpdate: accepts snake_case session_id', () => {
  const evt = { type: 'session.idle', properties: { session_id: 's1' } }
  assert.deepEqual(extractSessionActivityUpdate(evt), { sessionID: 's1', phase: 'idle' })
})

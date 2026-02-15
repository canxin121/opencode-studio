import test from 'node:test'
import assert from 'node:assert/strict'

import { patchSessionIdInQuery, readSessionIdFromFullPath, readSessionIdFromQuery } from '../src/app/navigation/sessionQuery.ts'

test('readSessionIdFromQuery: accepts legacy session keys', () => {
  assert.equal(readSessionIdFromQuery({ sessionid: 'legacy-1' }), 'legacy-1')
  assert.equal(readSessionIdFromQuery({ sessionId: 'camel-1' }), 'camel-1')
  assert.equal(readSessionIdFromQuery({ session: 'current-1' }), 'current-1')
})

test('patchSessionIdInQuery: updates existing session alias keys', () => {
  const next = patchSessionIdInQuery({ foo: 'bar', sessionid: 'old' }, 'new')
  assert.equal(next.foo, 'bar')
  assert.equal(next.sessionid, 'new')
  assert.equal('session' in next, false)
})

test('patchSessionIdInQuery: defaults to session key for new query', () => {
  const next = patchSessionIdInQuery({ foo: 'bar' }, 'new')
  assert.equal(next.foo, 'bar')
  assert.equal(next.session, 'new')
})

test('patchSessionIdInQuery: clears all known session keys for empty values', () => {
  const next = patchSessionIdInQuery({ sessionid: 'a', sessionId: 'b', session: 'c', foo: 'bar' }, '   ')
  assert.equal(next.foo, 'bar')
  assert.equal('sessionid' in next, false)
  assert.equal('sessionId' in next, false)
  assert.equal('session' in next, false)
})

test('readSessionIdFromFullPath: parses session aliases from URL path', () => {
  assert.equal(readSessionIdFromFullPath('/chat?sessionid=legacy-2'), 'legacy-2')
  assert.equal(readSessionIdFromFullPath('/chat?sessionId=camel-2'), 'camel-2')
  assert.equal(readSessionIdFromFullPath('/chat?session=current-2'), 'current-2')
  assert.equal(readSessionIdFromFullPath('/chat?foo=bar'), '')
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createUniqueTerminalSessionName,
  ensureTerminalSessionNames,
  resolveSessionIdByName,
} from '../src/features/terminal/lib/sessionNameKey'

test('ensureTerminalSessionNames migrates missing and duplicate names', () => {
  const result = ensureTerminalSessionNames(
    ['sid-a', 'sid-b', 'sid-c'],
    {
      'sid-a': { name: '' },
      'sid-b': { name: 'Terminal' },
      'sid-c': { pinned: true },
      stale: { name: 'Old' },
    },
    { fallbackBase: 'Terminal' },
  )

  assert.equal(result.changed, true)
  assert.deepEqual(result.sessionMetaById['sid-a']?.name, 'Terminal (2)')
  assert.deepEqual(result.sessionMetaById['sid-b']?.name, 'Terminal')
  assert.deepEqual(result.sessionMetaById['sid-c']?.name, 'Terminal (3)')
  assert.equal(Object.prototype.hasOwnProperty.call(result.sessionMetaById, 'stale'), false)
})

test('createUniqueTerminalSessionName enforces uniqueness', () => {
  const used = new Set<string>()
  const first = createUniqueTerminalSessionName('Git Terminal', used)
  const second = createUniqueTerminalSessionName('Git Terminal', used)
  const third = createUniqueTerminalSessionName('Git Terminal', used)

  assert.equal(first, 'Git Terminal')
  assert.equal(second, 'Git Terminal (2)')
  assert.equal(third, 'Git Terminal (3)')
})

test('resolveSessionIdByName resolves by normalized terminal name', () => {
  const sid = resolveSessionIdByName(
    ['sid-a', 'sid-b'],
    {
      'sid-a': { name: 'Terminal 1' },
      'sid-b': { name: 'Git Terminal' },
    },
    '  git   terminal ',
  )

  assert.equal(sid, 'sid-b')
})

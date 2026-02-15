import assert from 'node:assert/strict'
import test from 'node:test'

import { createEmptyStatusSummary, joinFs } from '../src/pages/git/gitPageUtils.ts'

test('joinFs: joins repo root and relative path safely', () => {
  assert.equal(joinFs('/repo/root', '.'), '/repo/root')
  assert.equal(joinFs('/repo/root/', 'src/main.ts'), '/repo/root/src/main.ts')
  assert.equal(joinFs('/repo/root', '/src/main.ts'), '/repo/root/src/main.ts')
  assert.equal(joinFs('', 'src/main.ts'), '')
})

test('createEmptyStatusSummary: returns zeroed status payload', () => {
  const status = createEmptyStatusSummary()
  assert.equal(status.current, '')
  assert.equal(status.tracking, null)
  assert.equal(status.ahead, 0)
  assert.equal(status.behind, 0)
  assert.deepEqual(status.files, [])
  assert.equal(status.scope, 'all')
})

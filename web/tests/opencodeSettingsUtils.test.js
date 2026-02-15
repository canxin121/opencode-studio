import test from 'node:test'
import assert from 'node:assert/strict'

import { asStringArray } from '../src/components/settings/opencode/utils.js'

test('asStringArray: returns [] for non-arrays', () => {
  assert.deepEqual(asStringArray(undefined), [])
  assert.deepEqual(asStringArray(null), [])
  assert.deepEqual(asStringArray('x'), [])
  assert.deepEqual(asStringArray({}), [])
})

test('asStringArray: stringifies array entries', () => {
  assert.deepEqual(asStringArray(['a', 2, true, null]), ['a', '2', 'true', 'null'])
})

test('asStringArray: unwraps ref-like objects', () => {
  const v = { value: ['x', 1] }
  assert.deepEqual(asStringArray(v), ['x', '1'])
})

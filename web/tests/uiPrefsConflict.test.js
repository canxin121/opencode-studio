import assert from 'node:assert/strict'
import test from 'node:test'

import { ApiError } from '../src/lib/api.ts'
import { isUiPrefsConflictError, readUiPrefsConflictCurrent } from '../src/stores/uiPrefsConflict.ts'

test('isUiPrefsConflictError: recognizes 409/428 ApiError', () => {
  const conflict = new ApiError('conflict', 409)
  const precondition = new ApiError('precondition', 428)
  const generic = new ApiError('boom', 500)

  assert.equal(isUiPrefsConflictError(conflict), true)
  assert.equal(isUiPrefsConflictError(precondition), true)
  assert.equal(isUiPrefsConflictError(generic), false)
  assert.equal(isUiPrefsConflictError(new Error('x')), false)
})

test('readUiPrefsConflictCurrent: extracts current payload for conflict errors', () => {
  const err = new ApiError('conflict', 409)
  err.bodyJson = { current: { version: 4, updatedAt: 99, pinnedSessionIds: ['s_1'] } }

  assert.deepEqual(readUiPrefsConflictCurrent(err), {
    version: 4,
    updatedAt: 99,
    pinnedSessionIds: ['s_1'],
  })

  const noCurrent = new ApiError('conflict', 409)
  noCurrent.bodyJson = { code: 'version_conflict' }
  assert.equal(readUiPrefsConflictCurrent(noCurrent), null)
})

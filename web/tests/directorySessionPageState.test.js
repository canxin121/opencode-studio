import assert from 'node:assert/strict'
import test from 'node:test'

import {
  removeSessionFromPageState,
  upsertRuntimeOnlyRunningIndexEntry,
  upsertSessionInPageState,
} from '../src/stores/directorySessions/pageState.ts'

function readSessionId(session) {
  return typeof session?.id === 'string' ? session.id.trim() : ''
}

function readParentId(session) {
  return typeof session?.parentID === 'string' && session.parentID.trim() ? session.parentID.trim() : null
}

function sameSession(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

test('upsertSessionInPageState: inserts new root on page 0 and increments total', () => {
  const page = { page: 0, totalRoots: 2, sessions: [{ id: 's1' }] }
  const next = upsertSessionInPageState(
    page,
    { id: 's2' },
    {
      incrementRootTotal: true,
      readSessionId,
      readParentId,
      equals: sameSession,
    },
  )

  assert.ok(next)
  assert.deepEqual(
    next.sessions.map((s) => s.id),
    ['s1', 's2'],
  )
  assert.equal(next.totalRoots, 3)
})

test('upsertSessionInPageState: inserts child only when parent is present in page slice', () => {
  const pageWithoutParent = { page: 0, totalRoots: 1, sessions: [{ id: 'root-a' }] }
  const noInsert = upsertSessionInPageState(
    pageWithoutParent,
    { id: 'child-x', parentID: 'root-b' },
    {
      readSessionId,
      readParentId,
      equals: sameSession,
    },
  )
  assert.equal(noInsert, null)

  const pageWithParent = { page: 0, totalRoots: 1, sessions: [{ id: 'root-a' }] }
  const inserted = upsertSessionInPageState(
    pageWithParent,
    { id: 'child-a', parentID: 'root-a' },
    {
      readSessionId,
      readParentId,
      equals: sameSession,
    },
  )
  assert.ok(inserted)
  assert.deepEqual(
    inserted.sessions.map((s) => s.id),
    ['root-a', 'child-a'],
  )
  assert.equal(inserted.totalRoots, 1)
})

test('removeSessionFromPageState: decrements total even when root is outside cached slice', () => {
  const page = { page: 1, totalRoots: 5, sessions: [{ id: 's3' }] }
  const next = removeSessionFromPageState(page, 'missing-root', {
    decrementRootTotal: true,
    readSessionId,
  })

  assert.ok(next)
  assert.deepEqual(
    next.sessions.map((s) => s.id),
    ['s3'],
  )
  assert.equal(next.totalRoots, 4)
})

test('upsertRuntimeOnlyRunningIndexEntry: keeps runtime row when summary is missing', () => {
  const runtime = { statusType: 'busy', phase: 'busy', attention: null, updatedAt: 50 }
  const first = upsertRuntimeOnlyRunningIndexEntry([], 0, {
    sessionId: 's1',
    runtime,
    directoryIdHint: 'd1',
    nowMs: 100,
  })

  assert.equal(first.entries.length, 1)
  assert.equal(first.entries[0].sessionId, 's1')
  assert.equal(first.entries[0].directoryId, 'd1')
  assert.equal(first.total, 1)

  const second = upsertRuntimeOnlyRunningIndexEntry(first.entries, first.total, {
    sessionId: 's1',
    runtime: { statusType: 'retry', phase: 'busy', attention: 'question', updatedAt: 140 },
    directoryIdHint: 'd1',
    nowMs: 120,
  })

  assert.equal(second.entries.length, 1)
  assert.equal(second.entries[0].runtime.statusType, 'retry')
  assert.equal(second.entries[0].runtime.attention, 'question')
  assert.equal(second.entries[0].updatedAt, 120)
  assert.equal(second.total, 1)
})

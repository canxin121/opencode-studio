import assert from 'node:assert/strict'
import test from 'node:test'

import { upsertRuntimeOnlyRunningIndexEntry, upsertSessionInPageState } from '../src/stores/directorySessions/pageState'

type SessionLike = {
  id: string
  parentID?: string
  title?: string
}

const pageStateOpts = {
  readSessionId: (session: SessionLike) => session.id,
  readParentId: (session: SessionLike) => (typeof session.parentID === 'string' ? session.parentID : null),
  equals: (left: SessionLike, right: SessionLike) => left.id === right.id && left.title === right.title,
}

test('upsertSessionInPageState keeps child session when parent root already exists', () => {
  const base = {
    page: 0,
    totalRoots: 2,
    sessions: [
      { id: 'root_a', title: 'A' },
      { id: 'root_b', title: 'B' },
    ],
  }

  const next = upsertSessionInPageState(
    base,
    {
      id: 'child_a_1',
      parentID: 'root_a',
      title: 'child',
    },
    {
      ...pageStateOpts,
      maxRootCount: 2,
    },
  )

  assert.ok(next)
  assert.deepEqual(
    next?.sessions.map((session) => session.id),
    ['root_a', 'root_b', 'child_a_1'],
  )
  assert.equal(next?.totalRoots, 2)
})

test('upsertRuntimeOnlyRunningIndexEntry preserves directory mapping and re-sorts by newest update', () => {
  const entries = [
    {
      sessionId: 'ses_a',
      directoryId: 'dir_a',
      directoryPath: '/tmp/a',
      runtime: { statusType: 'busy', phase: 'busy', attention: null, updatedAt: 10 },
      updatedAt: 10,
    },
    {
      sessionId: 'ses_b',
      directoryId: 'dir_b',
      directoryPath: '/tmp/b',
      runtime: { statusType: 'busy', phase: 'busy', attention: null, updatedAt: 20 },
      updatedAt: 20,
    },
  ]

  const patched = upsertRuntimeOnlyRunningIndexEntry(entries, 2, {
    sessionId: 'ses_a',
    runtime: { statusType: 'idle', phase: 'idle', attention: null, updatedAt: 99 },
    nowMs: 99,
  })

  assert.equal(patched.entries[0]?.sessionId, 'ses_a')
  assert.equal(patched.entries[0]?.directoryId, 'dir_a')
  assert.equal(patched.entries[0]?.updatedAt, 99)
  assert.equal(patched.total, 2)
})

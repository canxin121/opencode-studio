import assert from 'node:assert/strict'
import test from 'node:test'

import { parseSessionPagePayload } from '../src/stores/directorySessions/index'
import { runNonCriticalSidebarHydration } from '../src/stores/directorySessions/bootstrapHydration'
import {
  parseSidebarPatchRefreshHint,
  planSidebarPatchOps,
  resolveSidebarPatchPlan,
} from '../src/stores/directorySessions/sidebarPatchPlanner'
import { createStringRefreshQueue } from '../src/stores/directorySessions/sidebarRefreshQueue'

test('sidebar patch refresh queue dedupes and stays bounded', () => {
  const queue = createStringRefreshQueue({ maxItems: 2 })

  assert.equal(queue.enqueue('dir_a').accepted, true)
  assert.equal(queue.enqueue('dir_a').accepted, false)
  assert.equal(queue.enqueue('dir_b').accepted, true)

  const overflow = queue.enqueue('dir_c')
  assert.equal(overflow.accepted, true)
  assert.equal(overflow.dropped, 'dir_a')
  assert.equal(queue.size(), 2)

  assert.equal(queue.shift(), 'dir_b')
  assert.equal(queue.shift(), 'dir_c')
  assert.equal(queue.shift(), null)
})

test('sidebar patch planner keeps runtime fast path and schedules structural refresh', () => {
  const result = planSidebarPatchOps(
    [
      {
        type: 'sessionRuntime.upsert',
        runtime: { sessionID: 'ses_runtime', statusType: 'busy' },
      },
      {
        type: 'sessionSummary.upsert',
        session: { id: 'ses_struct', directory: '/tmp/a' },
      },
    ],
    {
      directoriesById: {
        dir_a: { id: 'dir_a', path: '/tmp/a' },
      },
      directoryIdBySessionId: {},
      sessionSummariesById: {},
    },
  )

  assert.equal(result.runtimeOnlyOps.length, 1)
  assert.equal(result.runtimeOnlyOps[0]?.type, 'sessionRuntime.upsert')
  assert.deepEqual(result.refreshDirectoryIds, ['dir_a'])
  assert.equal(result.refreshAll, false)
  assert.equal(result.refreshRecentIndex, true)
  assert.equal(result.refreshRunningIndex, true)
  assert.equal(result.usedBackendHint, false)
})

test('sidebar patch planner prefers backend hint when available', () => {
  const hint = parseSidebarPatchRefreshHint({
    refreshAll: false,
    refreshDirectoryIds: ['dir_hint'],
    refreshRecentIndex: true,
    refreshRunningIndex: false,
  })
  assert.ok(hint)

  const result = resolveSidebarPatchPlan(
    [
      {
        type: 'sessionSummary.upsert',
        session: { id: 'ses_struct', directory: '/tmp/a' },
      },
      {
        type: 'sessionRuntime.upsert',
        runtime: { sessionID: 'ses_runtime', statusType: 'busy' },
      },
    ],
    {
      directoriesById: {
        dir_a: { id: 'dir_a', path: '/tmp/a' },
      },
      directoryIdBySessionId: {},
      sessionSummariesById: {},
    },
    hint,
  )

  assert.equal(result.usedBackendHint, true)
  assert.deepEqual(result.refreshDirectoryIds, ['dir_hint'])
  assert.equal(result.refreshRecentIndex, true)
  assert.equal(result.refreshRunningIndex, false)
  assert.equal(result.runtimeOnlyOps.length, 1)
})

test('sidebar patch planner falls back when backend hint missing', () => {
  const result = resolveSidebarPatchPlan(
    [
      {
        type: 'sessionSummary.remove',
        sessionId: 'ses_old',
      },
    ],
    {
      directoriesById: {
        dir_a: { id: 'dir_a', path: '/tmp/a' },
      },
      directoryIdBySessionId: { ses_old: 'dir_a' },
      sessionSummariesById: {},
    },
    null,
  )

  assert.equal(result.usedBackendHint, false)
  assert.deepEqual(result.refreshDirectoryIds, ['dir_a'])
  assert.equal(result.refreshRecentIndex, true)
  assert.equal(result.refreshRunningIndex, true)
})

test('directory session payload treeHint is parsed for lightweight tree updates', () => {
  const parsed = parseSessionPagePayload(
    {
      sessions: [{ id: 'root_1' }, { id: 'child_1', parentID: 'root_1' }],
      total: 1,
      offset: 0,
      limit: 10,
      treeHint: {
        rootSessionIds: ['root_1'],
        childrenByParentSessionId: {
          root_1: ['child_1'],
        },
      },
    },
    10,
  )

  assert.deepEqual(parsed.treeHint?.rootSessionIds, ['root_1'])
  assert.deepEqual(parsed.treeHint?.childrenByParentSessionId.root_1, ['child_1'])
})

test('non-critical sidebar hydration is asynchronous and does not block caller', async () => {
  let preloadStarted = 0
  let preloadResolved = false
  let followupStarted = 0

  let resolvePreload: (() => void) | null = null
  const preloadGate = new Promise<void>((resolve) => {
    resolvePreload = resolve
  })

  const startedAt = Date.now()
  runNonCriticalSidebarHydration(
    [
      async () => {
        preloadStarted += 1
        await preloadGate
        preloadResolved = true
      },
    ],
    [
      async () => {
        followupStarted += 1
      },
    ],
  )
  const elapsed = Date.now() - startedAt
  assert.ok(elapsed < 20)

  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(preloadStarted, 1)
  assert.equal(preloadResolved, false)
  assert.equal(followupStarted, 0)

  resolvePreload?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(preloadResolved, true)
  assert.equal(followupStarted, 1)
})

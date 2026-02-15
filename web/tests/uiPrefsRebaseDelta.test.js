import assert from 'node:assert/strict'
import test from 'node:test'

import { rebaseUiPrefsDeltaOntoRemote } from '../src/stores/uiPrefsRebase.ts'

test('rebaseUiPrefsDeltaOntoRemote: keeps remote changes and reapplies only local delta', () => {
  const originalNow = Date.now
  Date.now = () => 1_700_000_000_000
  try {
    const base = {
      version: 10,
      updatedAt: 100,
      collapsedDirectoryIds: [],
      pinnedSessionIds: [],
      recentSessionsOpen: false,
      runningSessionsPage: 0,
    }
    const local = {
      // Local changed pinned only.
      version: 10,
      updatedAt: 150,
      collapsedDirectoryIds: [],
      pinnedSessionIds: ['s_local'],
      recentSessionsOpen: false,
      runningSessionsPage: 0,
    }
    const remote = {
      // Remote changed collapsed only and advanced version.
      version: 12,
      updatedAt: 200,
      collapsedDirectoryIds: ['d_remote'],
      pinnedSessionIds: [],
      recentSessionsOpen: true,
    }

    const out = rebaseUiPrefsDeltaOntoRemote({ base, local, remote })

    assert.equal(out.version, 12)
    assert.equal(out.updatedAt, 1_700_000_000_000)
    // Remote collapsed applied.
    assert.deepEqual(out.collapsedDirectoryIds, ['d_remote'])
    // Local pinned preserved.
    assert.deepEqual(out.pinnedSessionIds, ['s_local'])
    // Remote unrelated changes kept.
    assert.equal(out.recentSessionsOpen, true)
  } finally {
    Date.now = originalNow
  }
})

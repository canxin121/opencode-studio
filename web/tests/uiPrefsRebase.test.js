import assert from 'node:assert/strict'
import test from 'node:test'

import { rebaseUiPrefsBodyOntoRemote } from '../src/stores/uiPrefsRebase.ts'

test('rebaseUiPrefsBodyOntoRemote: keeps local body and remote version', () => {
  const originalNow = Date.now
  Date.now = () => 1_700_000_000_000
  try {
    const remote = {
      version: 12,
      updatedAt: 100,
      collapsedDirectoryIds: ['remote-collapsed'],
      pinnedSessionIds: ['remote-pin'],
      recentSessionsOpen: false,
    }
    const local = {
      version: 10,
      updatedAt: 90,
      collapsedDirectoryIds: ['local-collapsed'],
      pinnedSessionIds: ['local-pin'],
      recentSessionsOpen: true,
      runningSessionsPage: 3,
    }

    const rebased = rebaseUiPrefsBodyOntoRemote(remote, local)

    assert.equal(rebased.version, 12)
    assert.equal(rebased.updatedAt, 1_700_000_000_000)
    assert.deepEqual(rebased.collapsedDirectoryIds, ['local-collapsed'])
    assert.deepEqual(rebased.pinnedSessionIds, ['local-pin'])
    assert.equal(rebased.recentSessionsOpen, true)
    assert.equal(rebased.runningSessionsPage, 3)
  } finally {
    Date.now = originalNow
  }
})

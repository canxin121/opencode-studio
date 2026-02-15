import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeSidebarUiPrefsForUi } from '../src/features/sessions/model/sidebarUiPrefs.ts'

test('normalizeSidebarUiPrefsForUi: trims + dedup ids and clamps paging', () => {
  const out = normalizeSidebarUiPrefsForUi({
    pinnedSessionIds: [' s1 ', 's1', '', 2],
    collapsedDirectoryIds: [' d1 ', 'd2', 'd2', null],
    expandedParentSessionIds: [' p1 ', 'p2', ''],
    directoriesPage: -3,
    pinnedSessionsOpen: 'yes',
    pinnedSessionsPage: 2.9,
    recentSessionsOpen: 0,
    recentSessionsPage: NaN,
    runningSessionsOpen: true,
    runningSessionsPage: 5,
  })

  assert.deepEqual(out.pinnedSessionIds, ['s1'])
  assert.deepEqual(out.collapsedDirectoryIds, ['d1', 'd2'])
  assert.deepEqual(out.expandedParentSessionIds, ['p1', 'p2'])
  assert.equal(out.directoriesPage, 0)
  assert.equal(out.pinnedSessionsOpen, true)
  assert.equal(out.pinnedSessionsPage, 2)
  assert.equal(out.recentSessionsOpen, false)
  assert.equal(out.recentSessionsPage, 0)
  assert.equal(out.runningSessionsOpen, true)
  assert.equal(out.runningSessionsPage, 5)
})

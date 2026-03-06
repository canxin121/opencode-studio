import assert from 'node:assert/strict'
import test from 'node:test'

import {
  filterBranchesForSwitch,
  pickQuickSwitchBranch,
  summarizeCommitFiles,
  type BranchViewItem,
} from '../src/pages/git/gitViewModelUtils'

test('filterBranchesForSwitch: keeps local and remote matches with quick ordering', () => {
  const branches: BranchViewItem[] = [
    { name: 'main', current: true, label: 'abc123 initial' },
    { name: 'feature/quick-switch', current: false, label: 'def456 add switcher' },
    { name: 'remotes/origin/feature/quick-switch', current: false, label: 'def456 remote head' },
    { name: 'bugfix/other', current: false, label: '999999 other' },
  ]

  const filtered = filterBranchesForSwitch(branches, 'quick')
  assert.deepEqual(
    filtered.map((item) => item.name),
    ['feature/quick-switch', 'remotes/origin/feature/quick-switch'],
  )
})

test('pickQuickSwitchBranch: prefers first non-current branch', () => {
  const branch = pickQuickSwitchBranch([
    { name: 'main', current: true },
    { name: 'feature/a', current: false },
    { name: 'feature/b', current: false },
  ])
  assert.equal(branch?.name, 'feature/a')
})

test('summarizeCommitFiles: computes change summary totals', () => {
  const summary = summarizeCommitFiles([
    { insertions: 10, deletions: 2 },
    { insertions: 0, deletions: 7 },
  ])
  assert.deepEqual(summary, { files: 2, insertions: 10, deletions: 9 })
})

import test from 'node:test'
import assert from 'node:assert/strict'

import { matchDirectoryEntryForPath } from '../src/stores/directorySessions/pathMatch'

test('matchDirectoryEntryForPath matches exact path first', () => {
  const entries = [
    { id: 'root', path: '/repo' },
    { id: 'worktree', path: '/repo/.workbench/task-a' },
  ]

  const out = matchDirectoryEntryForPath(entries, '/repo/.workbench/task-a')
  assert.equal(out?.id, 'worktree')
})

test('matchDirectoryEntryForPath falls back to nearest parent path', () => {
  const entries = [
    { id: 'repo', path: '/repo' },
    { id: 'nested', path: '/repo/apps' },
  ]

  const out = matchDirectoryEntryForPath(entries, '/repo/apps/.workbench/child')
  assert.equal(out?.id, 'nested')
})

test('matchDirectoryEntryForPath does not match sibling prefix collisions', () => {
  const entries = [{ id: 'repo', path: '/repo' }]

  const out = matchDirectoryEntryForPath(entries, '/repo-2/worktree')
  assert.equal(out, null)
})

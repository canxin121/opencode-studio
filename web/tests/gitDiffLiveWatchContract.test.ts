import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('git page refreshes open diff after watch and working tree updates', () => {
  const gitPageFile = resolve(import.meta.dir, '../src/pages/GitPage.vue')
  const source = readFileSync(gitPageFile, 'utf8')

  const refreshFromWatch = /async function refreshListsFromWatch\([^)]*\)\s*\{[\s\S]*?refreshDiff\(\)/m
  const refreshAfterWorkingTreeChange =
    /async function refreshAfterWorkingTreeChange\([^)]*\)\s*\{[\s\S]*?refreshDiff\(\)/m

  assert.match(source, refreshFromWatch)
  assert.match(source, refreshAfterWorkingTreeChange)
  assert.ok(source.includes('useGitWatchSse'))
})

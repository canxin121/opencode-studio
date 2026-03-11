import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('git page refreshes open diff after watch and working tree updates', () => {
  const gitPageFile = resolve(import.meta.dir, '../src/pages/GitPage.vue')
  const source = readFileSync(gitPageFile, 'utf8')

  const refreshFromWatch =
    /async function refreshOpenDiffFromWatch\([^)]*\)\s*\{[\s\S]*?loadConflicts\([^)]*\)[\s\S]*?refreshDiff\(\)/m
  const refreshAfterWorkingTreeChange =
    /async function refreshAfterWorkingTreeChange\([^)]*\)\s*\{[\s\S]*?refreshDiff\(\)/m

  assert.match(source, refreshFromWatch)
  assert.match(source, refreshAfterWorkingTreeChange)
  assert.ok(source.includes('await loadConflicts(directory).catch(() => (conflictPaths.value = []))'))
  assert.ok(source.includes('() => [root.value, gitReady.value, selectedFile.value] as const'))
  assert.ok(source.includes('useGitWatchSse'))
})

test('git source control menu keeps a manual refresh action', () => {
  const dialogsFile = resolve(import.meta.dir, '../src/pages/git/components/GitPageMiscDialogs.vue')
  const source = readFileSync(dialogsFile, 'utf8')

  assert.ok(source.includes("id: 'refresh-repository'"))
  assert.ok(source.includes('props.refreshRepository()'))
})

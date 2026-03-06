import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('git working tree ops exposes revert-all flow for staged and working changes', () => {
  const file = resolve(import.meta.dir, '../src/pages/git/useGitWorkingTreeOps.ts')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes('async function revertAllChanges()'))
  assert.ok(source.includes("body: JSON.stringify({ scope: 'tracked' })"))
  assert.ok(source.includes("body: JSON.stringify({ scope: 'untracked' })"))
})

test('git actions menu wires revert-all cleanup action', () => {
  const file = resolve(import.meta.dir, '../src/pages/git/components/GitPageMiscDialogs.vue')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes("id: 'revert-all-changes'"))
  assert.ok(source.includes("if (id === 'revert-all-changes') return closeActionsThen(props.revertAllChanges)"))
})

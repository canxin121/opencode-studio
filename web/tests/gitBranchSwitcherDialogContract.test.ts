import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('branch dialog provides searchable quick-switch flow', () => {
  const file = resolve(import.meta.dir, '../src/components/git/GitBranchesDialog.vue')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes('branchSearchQuery'))
  assert.ok(source.includes('@keydown.enter.prevent="onQuickSwitch"'))
  assert.ok(source.includes('quickSwitchTarget'))
})

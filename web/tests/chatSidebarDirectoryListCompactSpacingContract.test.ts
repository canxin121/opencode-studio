import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('chat sidebar directory list keeps compact vertical spacing', () => {
  const listFile = resolve(import.meta.dir, '../src/layout/chatSidebar/components/DirectoriesList.vue')
  const listSource = readFileSync(listFile, 'utf8')

  assert.ok(listSource.includes('space-y-0.5 pb-0.5 pl-2 pr-1'))
  assert.ok(listSource.includes('class="space-y-0.5"'))
  assert.ok(listSource.includes('class="py-0.5 pl-1"'))

  const rowFile = resolve(import.meta.dir, '../src/layout/chatSidebar/components/DirectoryRow.vue')
  const rowSource = readFileSync(rowFile, 'utf8')

  assert.ok(rowSource.includes('class="relative gap-1.5"'))
  assert.ok(rowSource.includes('leading-tight'))
})

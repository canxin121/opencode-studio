import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('git page persists selected file state via store-backed open item', () => {
  const gitPageFile = resolve(import.meta.dir, '../src/pages/GitPage.vue')
  const gitPageSource = readFileSync(gitPageFile, 'utf8')
  const storeFile = resolve(import.meta.dir, '../src/stores/gitRepos.ts')
  const storeSource = readFileSync(storeFile, 'utf8')

  assert.ok(gitPageSource.includes('restoringOpenItem'))
  assert.ok(gitPageSource.includes('gitRepos.getOpenItem'))
  assert.ok(gitPageSource.includes('gitRepos.setOpenItem'))
  assert.ok(storeSource.includes('function getOpenItem'))
  assert.ok(storeSource.includes('function setOpenItem'))
  assert.ok(storeSource.includes('function getMobileOpenItem'))
  assert.ok(storeSource.includes('function setMobileOpenItem'))
})

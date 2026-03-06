import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('files page restores selected file state for desktop and mobile', () => {
  const filesPageFile = resolve(import.meta.dir, '../src/pages/FilesPage.vue')
  const filesPageSource = readFileSync(filesPageFile, 'utf8')

  assert.ok(filesPageSource.includes('async function restoreSelectedFile'))
  assert.ok(filesPageSource.includes('await restoreSelectedFile(next, seq)'))
  assert.ok(!filesPageSource.includes('async function restoreMobileSelectedFile'))
  assert.ok(!filesPageSource.includes('if (!isMobile.value) return'))
})

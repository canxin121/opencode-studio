import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('chat sidebar add-directory dialog allows creating folders', () => {
  const file = resolve(import.meta.dir, '../src/layout/chatSidebar/components/AddDirectoryDialog.vue')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes(':allow-create-directory="true"'))
})

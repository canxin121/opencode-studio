import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('sidebar session root page size is fixed to 10 end-to-end', () => {
  const sidebarSource = readFileSync(resolve(import.meta.dir, '../src/layout/ChatSidebar.vue'), 'utf8')
  const storeSource = readFileSync(resolve(import.meta.dir, '../src/stores/directorySessionStore.ts'), 'utf8')
  const runtimeSource = readFileSync(resolve(import.meta.dir, '../src/app/runtime/useAppRuntime.ts'), 'utf8')

  assert.ok(sidebarSource.includes('const SESSION_ROOTS_PAGE_SIZE = 10'))
  assert.ok(storeSource.includes('opts?.pageSize || 10'))
  assert.ok(storeSource.includes(': 10'))
  assert.ok(runtimeSource.includes('return 10'))
})

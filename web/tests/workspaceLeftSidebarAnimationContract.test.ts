import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('main layout animates desktop left sidebar width similarly to right dock', () => {
  const mainLayoutSource = readFileSync(resolve(import.meta.dir, '../src/layout/MainLayout.vue'), 'utf8')

  assert.ok(mainLayoutSource.includes('transition-[width,border-color] duration-200 ease-out'))
  assert.ok(mainLayoutSource.includes('<ChatSidebar v-if="usesChatShellSidebar" v-show="!isLeftSidebarResizing" />'))
  assert.ok(!mainLayoutSource.includes('<ChatSidebar v-if="usesChatShellSidebar && ui.isSidebarOpen"'))
})

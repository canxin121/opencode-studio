import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('main layout renders resize placeholders for center workspace and dock during sidebar resize', () => {
  const mainLayoutSource = readFileSync(resolve(import.meta.dir, '../src/layout/MainLayout.vue'), 'utf8')

  assert.ok(mainLayoutSource.includes('workspace-main-resize-placeholder'))
  assert.ok(mainLayoutSource.includes('workspace-dock-resize-placeholder'))
  assert.ok(
    mainLayoutSource.includes('<WorkspaceDockPanel v-show="showWorkspaceRightDock && !isAnySidebarResizing" />'),
  )
})

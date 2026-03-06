import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('main layout wires flexible dock panel regions', () => {
  const mainLayoutSource = readFileSync(resolve(import.meta.dir, '../src/layout/MainLayout.vue'), 'utf8')
  const appHeaderSource = readFileSync(resolve(import.meta.dir, '../src/layout/AppHeader.vue'), 'utf8')
  const uiStoreSource = readFileSync(resolve(import.meta.dir, '../src/stores/ui.ts'), 'utf8')

  assert.ok(mainLayoutSource.includes('HorizontalSplitPane'))
  assert.ok(mainLayoutSource.includes('VerticalSplitPane'))
  assert.ok(mainLayoutSource.includes('WorkspaceDockPanel'))
  assert.ok(mainLayoutSource.includes('showWorkspaceRightDock'))
  assert.ok(mainLayoutSource.includes('showWorkspaceBottomDock'))

  assert.ok(appHeaderSource.includes('toggleWorkspaceDock'))
  assert.ok(appHeaderSource.includes('RiLayoutRightLine'))

  assert.ok(uiStoreSource.includes('workspaceDockPanel = ref<WorkspaceDockPanel>'))
  assert.ok(uiStoreSource.includes('workspaceDockPlacement = ref<WorkspaceDockPlacement>'))
  assert.ok(uiStoreSource.includes('toggleWorkspaceDock'))
})

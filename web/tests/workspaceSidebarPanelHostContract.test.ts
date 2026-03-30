import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('desktop sidebar keeps non-chat panel host mounted for teleport sidebars', () => {
  const sidebarSource = readFileSync(resolve(import.meta.dir, '../src/layout/AppDesktopSidebar.vue'), 'utf8')

  assert.ok(sidebarSource.includes(':id="WORKSPACE_SIDEBAR_PANEL_HOST_ID"'))
  assert.ok(sidebarSource.includes("activeTab === 'chat' ? 'hidden' : ''"))
  assert.ok(sidebarSource.includes('const focusedMainTab = ui.activeWorkspaceWindow?.mainTab'))
  assert.ok(!sidebarSource.includes('v-else :id="WORKSPACE_SIDEBAR_PANEL_HOST_ID"'))
})

test('workspace pages teleport non-chat sidebars into stable panel host', () => {
  const pageFiles = [
    'pages/FilesPage.vue',
    'pages/TerminalPage.vue',
    'pages/git/GitPageView.vue',
    'pages/SettingsPage.vue',
    'pages/PreviewPage.vue',
  ]

  for (const file of pageFiles) {
    const source = readFileSync(resolve(import.meta.dir, `../src/${file}`), 'utf8')
    assert.ok(source.includes('WORKSPACE_SIDEBAR_PANEL_HOST_SELECTOR'), `${file} should use panel host selector`)
    assert.ok(!source.includes('WORKSPACE_SIDEBAR_HOST_SELECTOR'), `${file} should not target chat host selector`)
  }
})

test('main layout mounts hidden non-chat route host even without split panes', () => {
  const mainLayoutSource = readFileSync(resolve(import.meta.dir, '../src/layout/MainLayout.vue'), 'utf8')

  assert.ok(mainLayoutSource.includes('v-if="showDesktopSidebarHost && !usesChatShellSidebar"'))
  assert.ok(!mainLayoutSource.includes('v-if="isGroupPaneMode && showDesktopSidebarHost && !usesChatShellSidebar"'))
})

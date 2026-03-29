import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('workspace editor group pane keeps tab strip droppable without hover drag cursor', () => {
  const paneSource = readFileSync(resolve(import.meta.dir, '../src/layout/WorkspaceEditorGroupPane.vue'), 'utf8')
  const mainLayoutSource = readFileSync(resolve(import.meta.dir, '../src/layout/MainLayout.vue'), 'utf8')
  const tabClassLine = paneSource.split('\n').find((line) => line.includes('cursor-default active:cursor-grabbing'))

  assert.ok(paneSource.includes('workspace-tab-strip-drop-overlay'))
  assert.ok(paneSource.includes("t('header.windowTabs.dropIntoTabs')"))
  assert.ok(Boolean(tabClassLine))
  assert.ok(!paneSource.includes('cursor-grab active:cursor-grabbing'))

  assert.ok(mainLayoutSource.includes('workspace-pane-drop-overlay--below-tabs'))
  assert.ok(mainLayoutSource.includes('top-9'))
})

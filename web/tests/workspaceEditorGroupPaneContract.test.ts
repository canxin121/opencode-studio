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

test('workspace editor group pane propagates pane and iframe interactions into focused window state', () => {
  const paneSource = readFileSync(resolve(import.meta.dir, '../src/layout/WorkspaceEditorGroupPane.vue'), 'utf8')

  assert.ok(paneSource.includes('@pointerdown.capture="handlePanePointerDown"'))
  assert.ok(paneSource.includes('ui.setFocusedWorkspaceWindow(targetWindowId)'))
  assert.ok(paneSource.includes('readWorkspacePaneFocusWindowId(event.data)'))
  assert.ok(paneSource.includes("window.addEventListener('message', handleWorkspacePaneFocusMessage)"))
  assert.ok(paneSource.includes("window.removeEventListener('message', handleWorkspacePaneFocusMessage)"))
  assert.ok(paneSource.includes("frameWindow.addEventListener('pointerdown', handleFramePointerDown, true)"))
  assert.ok(paneSource.includes("frameDocument.addEventListener('focusin', handleFrameFocusIn, true)"))
  assert.ok(paneSource.includes('@load="handleFrameLoad"'))
  assert.ok(paneSource.includes('border-border/70 bg-secondary/40 text-foreground/85'))
})

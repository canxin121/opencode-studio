import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('files explorer supports long-press multi-selection and separate selection row', () => {
  const file = resolve(import.meta.dir, '../src/pages/files/components/FilesExplorerPane.vue')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes('const LONG_PRESS_DELAY_TOUCH_MS = 420'))
  assert.ok(source.includes('const LONG_PRESS_DELAY_POINTER_MS = 540'))
  assert.ok(source.includes('@pointerdown="onRowPointerDown($event, entry.row.node)"'))
  assert.ok(source.includes('void props.handleNodeLongPress(state.node)'))
  assert.ok(source.includes('class="border-b border-sidebar-border/60 px-1.5 py-1"'))
  assert.ok(source.includes("t('files.explorer.selection.bulkMove')"))
})

test('files page provides batch move flow for current selection', () => {
  const file = resolve(import.meta.dir, '../src/pages/FilesPage.vue')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes('async function moveSelectedNodes(paths: string[], destinationInput: string)'))
  assert.ok(source.includes('function openMoveSelectedDialog(paths?: string[])'))
  assert.ok(source.includes("t('files.errors.moveTargetOutsideWorkspace')"))
  assert.ok(source.includes("t('files.toasts.movedCount', { count: successCount })"))
  assert.ok(source.includes(':open="moveDialogOpen"'))
})

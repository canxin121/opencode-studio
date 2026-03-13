import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('runtime forwards global fs change events to directory store', () => {
  const source = readFileSync(resolve(import.meta.dir, '../src/app/runtime/useAppRuntime.ts'), 'utf8')
  assert.ok(source.includes('directoryStore.applyGlobalEvent(evt)'))
})

test('FilesPage does not auto-refresh explorer lists from fs events', () => {
  const source = readFileSync(resolve(import.meta.dir, '../src/pages/FilesPage.vue'), 'utf8')
  assert.ok(!source.includes('directoryStore.fsEventSeq'))
  assert.ok(!source.includes('queueFsEventSync(event)'))
  assert.ok(!source.includes('flushFsEventSyncQueue'))
})

test('Files explorer keeps a manual refresh action in the toolbar', () => {
  const source = readFileSync(resolve(import.meta.dir, '../src/pages/files/components/FilesExplorerPane.vue'), 'utf8')
  assert.ok(source.includes('@click="refreshRoot"'))
  assert.ok(source.includes("t('files.explorer.toolbar.refreshTree')"))
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

test('runtime forwards global fs change events to directory store', () => {
  const source = readFileSync(resolve(import.meta.dir, '../src/app/runtime/useAppRuntime.ts'), 'utf8')
  assert.ok(source.includes('directoryStore.applyGlobalEvent(evt)'))
})

test('FilesPage listens to directory fs event sequence and queues sync', () => {
  const source = readFileSync(resolve(import.meta.dir, '../src/pages/FilesPage.vue'), 'utf8')
  assert.ok(source.includes('() => directoryStore.fsEventSeq'))
  assert.ok(source.includes('queueFsEventSync(event)'))
  assert.ok(source.includes('async function flushFsEventSyncQueue()'))
})

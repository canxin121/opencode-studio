import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('chat sidebar field contract keeps web/server naming aligned', () => {
  const storeSource = readFileSync(resolve(import.meta.dir, '../src/stores/directorySessionStore.ts'), 'utf8')
  const serverSource = readFileSync(resolve(import.meta.dir, '../../server/src/chat_sidebar.rs'), 'utf8')

  assert.ok(serverSource.includes('#[serde(rename = "directoryId", alias = "directory_id")]'))
  assert.ok(serverSource.includes('#[serde(rename = "sessionId", alias = "session_id")]'))
  assert.ok(serverSource.includes('#[serde(rename = "directoryId")]'))

  assert.ok(storeSource.includes("type: 'setDirectoryCollapsed'; directoryId: string; collapsed: boolean"))
  assert.ok(storeSource.includes("type: 'setDirectoryRootPage'; directoryId: string; page: number"))
  assert.ok(storeSource.includes("type: 'setSessionPinned'; sessionId: string; pinned: boolean"))
  assert.ok(storeSource.includes("type: 'setSessionExpanded'; sessionId: string; expanded: boolean"))

  assert.ok(storeSource.includes("typeof op.directoryId === 'string'"))
  assert.ok(storeSource.includes("typeof op.directory_id === 'string'"))
  assert.ok(storeSource.includes('payload.need_resync'))
  assert.ok(storeSource.includes('payload.latest_seq'))
  assert.ok(storeSource.includes('stateRecord.directories_page'))
  assert.ok(storeSource.includes('stateRecord.runtime_by_session_id'))
})

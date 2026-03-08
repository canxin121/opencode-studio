import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('chat sidebar merges footer placeholder rows with session cache and cwd directory mapping', () => {
  const sidebarFile = resolve(import.meta.dir, '../src/layout/ChatSidebar.vue')
  const source = readFileSync(sidebarFile, 'utf8')

  assert.ok(
    source.includes(
      'const cachedSession = normalizeSidebarSessionLike(chat.getSessionById(sid) as SessionLike | null, sid)',
    ),
  )
  assert.ok(source.includes('return nonEmptyString(record?.cwd)'))
  assert.ok(source.includes('const pagedRunningSessionRows = computed<ThreadSessionRow[]>(() =>'))
  assert.ok(source.includes('((runningFooterView.value.rows || []) as ThreadSessionRow[]).map(resolveSidebarRow)'))
  assert.ok(source.includes('session: resolved.session || ({ id: sid } as SessionLike),'))
})

test('chat store accepts cwd-only session metadata updates from SSE events', () => {
  const chatFile = resolve(import.meta.dir, '../src/stores/chat.ts')
  const source = readFileSync(chatFile, 'utf8')

  assert.ok(source.includes("const cwd = typeof record?.cwd === 'string' ? record.cwd.trim() : ''"))
  assert.ok(source.includes('function sessionPatchFromEventProperties('))
  assert.ok(source.includes('const directory = readSessionDirectory(properties)'))
  assert.ok(source.includes('const patch = sessionPatchFromEventProperties(props, sid)'))
})

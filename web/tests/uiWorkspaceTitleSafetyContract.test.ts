import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

function extractFunctionSource(source: string, signature: string): string {
  const start = source.indexOf(signature)
  assert.ok(start >= 0, `missing function signature: ${signature}`)

  const blockStart = source.indexOf('{', start)
  assert.ok(blockStart >= 0, `missing block start for: ${signature}`)

  let depth = 0
  for (let idx = blockStart; idx < source.length; idx += 1) {
    const ch = source[idx]
    if (ch === '{') depth += 1
    else if (ch === '}') depth -= 1
    if (depth === 0) {
      return source.slice(start, idx + 1)
    }
  }

  throw new Error(`unterminated function block: ${signature}`)
}

test('ui workspace shell state persistence is gated outside embedded panes', () => {
  const uiStoreSource = readFileSync(resolve(import.meta.dir, '../src/stores/ui.ts'), 'utf8')

  assert.ok(uiStoreSource.includes('const shouldPersistWorkspaceShellState = !isEmbeddedWorkspacePaneContext()'))
  assert.ok(uiStoreSource.includes('persistWorkspaceShellJson(STORAGE_WORKSPACE_WINDOWS, list)'))
  assert.ok(uiStoreSource.includes("persistWorkspaceShellString(STORAGE_ACTIVE_WORKSPACE_WINDOW_ID, String(v || ''))"))
  assert.ok(uiStoreSource.includes('persistWorkspaceShellJson(STORAGE_WORKSPACE_GROUPS, list)'))
  assert.ok(uiStoreSource.includes('persistWorkspaceShellJson(STORAGE_WORKSPACE_GROUP_PANE_RATIOS, value)'))
  assert.ok(uiStoreSource.includes("persistWorkspaceShellString(STORAGE_ACTIVE_WORKSPACE_GROUP_ID, String(v || ''))"))
  assert.ok(uiStoreSource.includes('persistWorkspaceShellString(STORAGE_ACTIVE_TAB, v)'))
})

test('replacing window content does not clear target title when source title missing', () => {
  const uiStoreSource = readFileSync(resolve(import.meta.dir, '../src/stores/ui.ts'), 'utf8')

  assert.ok(uiStoreSource.includes("if (typeof source.title !== 'undefined')"))
  assert.ok(uiStoreSource.includes('setWorkspaceWindowTitle(targetId, source.title)'))
})

test('chat sidebar selection scopes session/title updates to target workspace window', () => {
  const chatSidebarSource = readFileSync(resolve(import.meta.dir, '../src/layout/ChatSidebar.vue'), 'utf8')
  const selectSessionFn = extractFunctionSource(chatSidebarSource, 'async function selectSession(sessionId: string)')

  assert.ok(
    selectSessionFn.includes(
      'await chat.selectSession(sessionId, targetWindowId ? { windowId: targetWindowId } : undefined)',
    ),
  )
  assert.ok(selectSessionFn.includes('const title = resolveSessionTabTitle(sessionId)'))
  assert.ok(!selectSessionFn.includes('chat.selectedSession?.title'))
})

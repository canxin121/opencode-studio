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

test('openWorkspaceWindow respects activate:false and can force new window for split flows', () => {
  const uiStoreSource = readFileSync(resolve(import.meta.dir, '../src/stores/ui.ts'), 'utf8')

  assert.ok(uiStoreSource.includes('const shouldActivate = opts?.activate !== false'))
  assert.ok(uiStoreSource.includes('const shouldReuseExisting = opts?.reuseExisting !== false'))
  assert.ok(uiStoreSource.includes('const existing = shouldReuseExisting'))
  assert.ok(uiStoreSource.includes('if (selectedGroup && shouldActivate)'))
  assert.ok(uiStoreSource.includes('setWorkspaceGroupTabs(selectedGroup.id, nextTabIds, { activeWindowId: next.id })'))
  assert.ok(uiStoreSource.includes('setWorkspaceGroupTabs(selectedGroup.id, nextTabIds)'))
})

test('split window helpers force new window ids instead of reusing existing tabs', () => {
  const uiStoreSource = readFileSync(resolve(import.meta.dir, '../src/stores/ui.ts'), 'utf8')
  const mainLayoutSource = readFileSync(resolve(import.meta.dir, '../src/layout/MainLayout.vue'), 'utf8')
  const groupPaneSource = readFileSync(resolve(import.meta.dir, '../src/layout/WorkspaceEditorGroupPane.vue'), 'utf8')

  const splitRightFn = extractFunctionSource(
    uiStoreSource,
    'function splitWorkspaceWindowToRight(windowId: string): boolean',
  )
  const ensureDropSourceFn = extractFunctionSource(
    mainLayoutSource,
    'function ensureDropSourceWindowId(source: WorkspaceDropSource): string',
  )
  const tabStripDropFn = extractFunctionSource(groupPaneSource, 'async function handleTabStripDrop(event: DragEvent)')

  assert.ok(splitRightFn.includes('activate: false'))
  assert.ok(splitRightFn.includes('reuseExisting: false'))

  assert.ok(ensureDropSourceFn.includes('activate: false'))
  assert.ok(ensureDropSourceFn.includes('reuseExisting: false'))

  assert.ok(tabStripDropFn.includes('activate: false'))
  assert.ok(tabStripDropFn.includes('reuseExisting: false'))
})

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
    if (depth === 0) return source.slice(start, idx + 1)
  }

  throw new Error(`unterminated function block: ${signature}`)
}

test('workspace pane reordering keeps existing group ids instead of recreating groups', () => {
  const uiStoreSource = readFileSync(resolve(import.meta.dir, '../src/stores/ui.ts'), 'utf8')
  const mainLayoutSource = readFileSync(resolve(import.meta.dir, '../src/layout/MainLayout.vue'), 'utf8')

  const moveGroupFn = extractFunctionSource(
    uiStoreSource,
    'function moveWorkspaceGroupToIndex(groupId: string, atIndex: number): boolean',
  )
  assert.ok(moveGroupFn.includes('const [targetGroup] = nextGroups.splice(sourceIndex, 1)'))
  assert.ok(moveGroupFn.includes('nextGroups.splice(desiredIndex, 0, targetGroup)'))

  const insertFn = extractFunctionSource(mainLayoutSource, 'function insertDropSourceAtPane(')
  assert.ok(insertFn.includes('ui.moveWorkspaceGroupToIndex(sourceGroup.id, insertIndex)'))
})

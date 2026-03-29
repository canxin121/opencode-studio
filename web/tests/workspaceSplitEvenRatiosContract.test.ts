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

test('workspace split insertion rebalances pane ratios to even distribution on growth', () => {
  const uiStoreSource = readFileSync(resolve(import.meta.dir, '../src/stores/ui.ts'), 'utf8')

  const rebalanceFn = extractFunctionSource(
    uiStoreSource,
    'function rebalanceWorkspacePaneRatiosOnGroupGrowth(previousGroupCount: number)',
  )
  assert.ok(rebalanceFn.includes('if (!(nextIds.length > previousGroupCount)) return'))
  assert.ok(rebalanceFn.includes('rebalanceWorkspacePaneRatiosEvenly()'))
})

test('workspace split insertion rebalances pane ratios to even distribution even when group count stays unchanged', () => {
  const uiStoreSource = readFileSync(resolve(import.meta.dir, '../src/stores/ui.ts'), 'utf8')

  const evenRebalanceFn = extractFunctionSource(uiStoreSource, 'function rebalanceWorkspacePaneRatiosEvenly()')
  assert.ok(evenRebalanceFn.includes('normalizePaneRatiosByIds({}, nextIds)'))

  const insertFn = extractFunctionSource(uiStoreSource, 'function insertWorkspaceWindowIntoGroupSplit(')
  assert.ok(insertFn.includes('rebalanceWorkspacePaneRatiosEvenly()'))
})

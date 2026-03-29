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

test('ui workspace defaults to empty and route sync avoids implicit window creation', () => {
  const uiStoreSource = readFileSync(resolve(import.meta.dir, '../src/stores/ui.ts'), 'utf8')

  // No persisted windows should stay empty; do not fabricate a default chat tab.
  assert.ok(!uiStoreSource.includes('return [createWorkspaceWindowTab(defaultMainTab)]'))

  const setRouteQueryFn = extractFunctionSource(
    uiStoreSource,
    'function setActiveWorkspaceWindowRouteQuery(rawQuery: unknown)',
  )
  const syncFromRouteFn = extractFunctionSource(
    uiStoreSource,
    'function syncActiveWorkspaceWindowFromRoute(tab: MainTab, rawQuery: unknown)',
  )
  const resolveRouteWindowFn = extractFunctionSource(
    uiStoreSource,
    'function resolveWorkspaceWindowIdFromRouteQuery(rawQuery: unknown)',
  )
  const setActiveMainTabFn = extractFunctionSource(uiStoreSource, 'function setActiveMainTab(tab: MainTab)')

  // Route-query sync should be a no-op when there is no active workspace window.
  assert.ok(setRouteQueryFn.includes('if (!targetId) return'))
  assert.ok(setRouteQueryFn.includes('setWorkspaceWindowRouteQuery(targetId, rawQuery)'))
  assert.ok(!setRouteQueryFn.includes('createWorkspaceWindow('))

  // Main-tab sync should update fallback tab state but must not auto-open a workspace window.
  assert.ok(setActiveMainTabFn.includes('activeMainTabFallback.value = tab'))
  assert.ok(setActiveMainTabFn.includes('if (!targetId) return'))
  assert.ok(!setActiveMainTabFn.includes('createWorkspaceWindow('))

  // Desktop route-only switches should not rewrite active split-pane window content.
  const desktopRouteGuardIdx = syncFromRouteFn.indexOf('if (!isCompactLayout.value)')
  const routeWindowBranchIdx = syncFromRouteFn.indexOf('if (routeWindowId)')
  const setActiveMainTabCallIdx = syncFromRouteFn.indexOf('setActiveMainTab(tab)')
  const desktopBranch =
    desktopRouteGuardIdx >= 0 && routeWindowBranchIdx > desktopRouteGuardIdx
      ? syncFromRouteFn.slice(desktopRouteGuardIdx, routeWindowBranchIdx)
      : ''

  assert.ok(desktopRouteGuardIdx >= 0)
  assert.ok(routeWindowBranchIdx >= 0)
  assert.ok(setActiveMainTabCallIdx >= 0)
  assert.ok(desktopRouteGuardIdx < routeWindowBranchIdx)
  assert.ok(desktopRouteGuardIdx < setActiveMainTabCallIdx)
  assert.ok(desktopBranch.includes('activateWorkspaceWindow(routeWindowId)'))
  assert.ok(!desktopBranch.includes('setWorkspaceWindowMainTab(routeWindowId, tab)'))
  assert.ok(!desktopBranch.includes('setWorkspaceWindowRouteQuery(routeWindowId, rawQuery)'))

  // Route-derived window-title updates should require explicit window scope on desktop.
  assert.ok(resolveRouteWindowFn.includes('if (isCompactLayout.value)'))
  assert.ok(resolveRouteWindowFn.includes('return getResolvedWorkspaceWindowId()'))
  assert.ok(resolveRouteWindowFn.includes("return ''"))
})

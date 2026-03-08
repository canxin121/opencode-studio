import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('chat sidebar footer collapse closes immediately and only shows loading placeholder when expanded', () => {
  const sidebarFile = resolve(import.meta.dir, '../src/layout/ChatSidebar.vue')
  const sidebarSource = readFileSync(sidebarFile, 'utf8')

  assert.ok(sidebarSource.includes('const pinnedFooterLoading = computed(() => pinnedSessionsOpenUpdating.value && pinnedSessionsOpen.value)'))
  assert.ok(sidebarSource.includes('const recentFooterLoading = computed(() => recentSessionsOpenUpdating.value && recentSessionsOpen.value)'))
  assert.ok(sidebarSource.includes('const runningFooterLoading = computed(() => runningSessionsOpenUpdating.value && runningSessionsOpen.value)'))

  const pinnedRequestIndex = sidebarSource.indexOf('async function requestPinnedSessionsOpen(nextOpen: boolean) {')
  const pinnedSetOpenIndex = sidebarSource.indexOf('pinnedSessionsOpen.value = target', pinnedRequestIndex)
  const pinnedSetLoadingIndex = sidebarSource.indexOf('pinnedSessionsOpenUpdating.value = true', pinnedRequestIndex)
  assert.ok(pinnedRequestIndex >= 0)
  assert.ok(pinnedSetOpenIndex > pinnedRequestIndex)
  assert.ok(pinnedSetLoadingIndex > pinnedSetOpenIndex)
  assert.ok(sidebarSource.includes('pinnedSessionsOpen.value = previous'))

  const recentRequestIndex = sidebarSource.indexOf('async function requestRecentSessionsOpen(nextOpen: boolean) {')
  const recentSetOpenIndex = sidebarSource.indexOf('recentSessionsOpen.value = target', recentRequestIndex)
  const recentSetLoadingIndex = sidebarSource.indexOf('recentSessionsOpenUpdating.value = true', recentRequestIndex)
  assert.ok(recentRequestIndex >= 0)
  assert.ok(recentSetOpenIndex > recentRequestIndex)
  assert.ok(recentSetLoadingIndex > recentSetOpenIndex)
  assert.ok(sidebarSource.includes('recentSessionsOpen.value = previous'))

  const runningRequestIndex = sidebarSource.indexOf('async function requestRunningSessionsOpen(nextOpen: boolean) {')
  const runningSetOpenIndex = sidebarSource.indexOf('runningSessionsOpen.value = target', runningRequestIndex)
  const runningSetLoadingIndex = sidebarSource.indexOf('runningSessionsOpenUpdating.value = true', runningRequestIndex)
  assert.ok(runningRequestIndex >= 0)
  assert.ok(runningSetOpenIndex > runningRequestIndex)
  assert.ok(runningSetLoadingIndex > runningSetOpenIndex)
  assert.ok(sidebarSource.includes('runningSessionsOpen.value = previous'))
})

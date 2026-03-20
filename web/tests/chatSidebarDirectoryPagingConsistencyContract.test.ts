import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('directory sidebar page invalidations trigger full state revalidation and keep persisted paging query aligned', () => {
  const storeFile = resolve(import.meta.dir, '../src/stores/directorySessionStore.ts')
  const source = readFileSync(storeFile, 'utf8')

  assert.ok(source.includes('function syncPersistedPagingQueryFromPrefs('))
  assert.ok(source.includes('directoriesPage: Math.max(0, Math.floor(Number(prefs.directoriesPage || 0)))'))
  assert.ok(source.includes('pinnedPage: Math.max(0, Math.floor(Number(prefs.pinnedSessionsPage || 0)))'))
  assert.ok(source.includes('recentPage: Math.max(0, Math.floor(Number(prefs.recentSessionsPage || 0)))'))
  assert.ok(source.includes('runningPage: Math.max(0, Math.floor(Number(prefs.runningSessionsPage || 0)))'))
  assert.ok(source.includes('await revalidateFromStateApi({ directoriesPage: uiPrefs.value.directoriesPage })'))
})

test('chat sidebar shows loading fallback for missing directory sections and allows paging resync on ui/data mismatch', () => {
  const sidebarFile = resolve(import.meta.dir, '../src/layout/ChatSidebar.vue')
  const sidebarSource = readFileSync(sidebarFile, 'utf8')

  assert.ok(sidebarSource.includes('const directorySectionLoadingIds = ref<Set<string>>(new Set())'))
  assert.ok(sidebarSource.includes('if (target === directoryPage.value && target === currentDataPage) return'))
  assert.ok(sidebarSource.includes('void ensureDirectorySidebarSectionLoaded(pid)'))
  assert.ok(sidebarSource.includes('return Boolean(directorySidebarById.value[pid])'))

  const listFile = resolve(import.meta.dir, '../src/layout/chatSidebar/components/DirectoriesList.vue')
  const listSource = readFileSync(listFile, 'utf8')

  assert.ok(listSource.includes('hasDirectorySidebarSection: (directoryId: string) => boolean'))
  assert.ok(listSource.includes('v-else-if="!props.hasDirectorySidebarSection(directory.id)"'))
})

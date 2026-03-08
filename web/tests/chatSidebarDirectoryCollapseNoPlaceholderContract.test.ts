import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('chat sidebar directory collapse removes rows immediately without placeholder animation state', () => {
  const listFile = resolve(import.meta.dir, '../src/layout/chatSidebar/components/DirectoriesList.vue')
  const listSource = readFileSync(listFile, 'utf8')

  assert.ok(listSource.includes('v-if="!props.isDirectoryCollapsed(directory.id)" class="py-0.5 pl-1"'))
  assert.equal(listSource.includes('v-show="!props.isDirectoryCollapsed(directory.id)"'), false)
  assert.equal(listSource.includes('<Transition'), false)

  const collapsedGateIndex = listSource.indexOf('v-if="!props.isDirectoryCollapsed(directory.id)" class="py-0.5 pl-1"')
  const expandLoadingIndex = listSource.indexOf('props.isDirectoryExpandLoading(directory.id)')
  assert.ok(collapsedGateIndex >= 0)
  assert.ok(expandLoadingIndex > collapsedGateIndex)

  const sidebarFile = resolve(import.meta.dir, '../src/layout/ChatSidebar.vue')
  const sidebarSource = readFileSync(sidebarFile, 'utf8')

  assert.ok(sidebarSource.includes('const nextCollapsed = !collapsedDirectories.value.has(pid)'))
  assert.ok(sidebarSource.includes('if (!nextCollapsed) {'))
  assert.ok(sidebarSource.includes('nextExpandLoading.add(pid)'))
})

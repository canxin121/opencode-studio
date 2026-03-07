import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('pagination controls support enter-to-jump input', () => {
  const file = resolve(import.meta.dir, '../src/components/ui/PaginationControls.vue')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes('@keydown.enter.prevent="jumpToPage"'))
  assert.ok(source.includes("emit('update:page', clamped)"))
})

test('option menu and sidebar pager use shared pagination controls', () => {
  const optionMenuFile = resolve(import.meta.dir, '../src/components/ui/OptionMenu.vue')
  const optionMenuSource = readFileSync(optionMenuFile, 'utf8')

  assert.ok(optionMenuSource.includes('import PaginationControls'))
  assert.ok(optionMenuSource.includes('@update:page="setPagerPage"'))

  const sidebarPagerFile = resolve(import.meta.dir, '../src/layout/chatSidebar/components/SidebarPager.vue')
  const sidebarPagerSource = readFileSync(sidebarPagerFile, 'utf8')

  assert.ok(sidebarPagerSource.includes('<PaginationControls'))
})

test('git history renders shared pagination controls in top and bottom sections', () => {
  const file = resolve(import.meta.dir, '../src/pages/git/GitPageView.vue')
  const source = readFileSync(file, 'utf8')
  const matches = source.match(/<PaginationControls/g) || []

  assert.ok(matches.length >= 2)
  assert.ok(source.includes('@update:page="setHistoryPage"'))
})

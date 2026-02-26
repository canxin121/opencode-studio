import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveSessionDiffNavigationView } from '../src/components/chat/sessionDiffMobileNav'

test('uses split layout on desktop widths', () => {
  const view = resolveSessionDiffNavigationView({
    isNarrowViewport: false,
    hasDiffEntries: true,
    selectedDiffPath: 'src/main.ts',
    mobileView: 'detail',
  })

  assert.equal(view, 'split')
})

test('defaults to file list on narrow screens', () => {
  const view = resolveSessionDiffNavigationView({
    isNarrowViewport: true,
    hasDiffEntries: true,
    selectedDiffPath: 'src/main.ts',
    mobileView: 'list',
  })

  assert.equal(view, 'list')
})

test('shows detail on narrow screens after selecting a file', () => {
  const view = resolveSessionDiffNavigationView({
    isNarrowViewport: true,
    hasDiffEntries: true,
    selectedDiffPath: 'src/main.ts',
    mobileView: 'detail',
  })

  assert.equal(view, 'detail')
})

test('falls back to list when no selected file exists', () => {
  const view = resolveSessionDiffNavigationView({
    isNarrowViewport: true,
    hasDiffEntries: true,
    selectedDiffPath: '',
    mobileView: 'detail',
  })

  assert.equal(view, 'list')
})

test('stays on list empty state when there are no file changes', () => {
  const view = resolveSessionDiffNavigationView({
    isNarrowViewport: true,
    hasDiffEntries: false,
    selectedDiffPath: '',
    mobileView: 'detail',
  })

  assert.equal(view, 'list')
})

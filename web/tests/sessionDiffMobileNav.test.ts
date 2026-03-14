import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveSessionDiffNavigationView } from '../src/components/chat/sessionDiffMobileNav'

test('defaults to list view when requested', () => {
  const view = resolveSessionDiffNavigationView({
    hasDiffEntries: true,
    selectedDiffPath: 'src/main.ts',
    mobileView: 'list',
  })

  assert.equal(view, 'list')
})

test('shows detail when requested and a selected file exists', () => {
  const view = resolveSessionDiffNavigationView({
    hasDiffEntries: true,
    selectedDiffPath: 'src/main.ts',
    mobileView: 'detail',
  })

  assert.equal(view, 'detail')
})

test('falls back to list when no selected file exists', () => {
  const view = resolveSessionDiffNavigationView({
    hasDiffEntries: true,
    selectedDiffPath: '',
    mobileView: 'detail',
  })

  assert.equal(view, 'list')
})

test('stays on list empty state when there are no file changes', () => {
  const view = resolveSessionDiffNavigationView({
    hasDiffEntries: false,
    selectedDiffPath: '',
    mobileView: 'detail',
  })

  assert.equal(view, 'list')
})

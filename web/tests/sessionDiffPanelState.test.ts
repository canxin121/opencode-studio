import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveSessionDiffPanelView } from '../src/components/chat/sessionDiffPanelState'

test('shows loading when session summary reports changes but diff cache not loaded', () => {
  const view = resolveSessionDiffPanelView({
    loading: false,
    error: null,
    diffCount: 0,
    diffLoaded: false,
    hasSummaryChanges: true,
  })

  assert.equal(view, 'loading')
})

test('shows list when diff has entries', () => {
  const view = resolveSessionDiffPanelView({
    loading: false,
    error: null,
    diffCount: 2,
    diffLoaded: true,
    hasSummaryChanges: true,
  })

  assert.equal(view, 'list')
})

test('shows empty when no changes and diff is loaded', () => {
  const view = resolveSessionDiffPanelView({
    loading: false,
    error: null,
    diffCount: 0,
    diffLoaded: true,
    hasSummaryChanges: false,
  })

  assert.equal(view, 'empty')
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { COMPOSER_TOOLBAR_WRAP_MAX_WIDTH, shouldWrapComposerToolbar } from '../src/pages/chat/composerToolbarLayout'

test('uses two-row layout on narrow mobile widths', () => {
  assert.equal(shouldWrapComposerToolbar(true, COMPOSER_TOOLBAR_WRAP_MAX_WIDTH), true)
  assert.equal(shouldWrapComposerToolbar(true, COMPOSER_TOOLBAR_WRAP_MAX_WIDTH - 20), true)
})

test('keeps single-row layout outside narrow mobile constraints', () => {
  assert.equal(shouldWrapComposerToolbar(true, COMPOSER_TOOLBAR_WRAP_MAX_WIDTH + 1), false)
  assert.equal(shouldWrapComposerToolbar(false, COMPOSER_TOOLBAR_WRAP_MAX_WIDTH - 100), false)
})

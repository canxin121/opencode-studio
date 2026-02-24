import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveComposerPrimaryActions } from '../src/pages/chat/composerPrimaryActions'

test('shows stop + send while run is active so user can queue next message', () => {
  const resolved = resolveComposerPrimaryActions({
    canAbort: true,
    aborting: false,
    canSend: true,
    sending: false,
  })

  assert.equal(resolved.showStop, true)
  assert.equal(resolved.stopDisabled, false)
  assert.equal(resolved.sendDisabled, false)
})

test('disables send only during send request flight', () => {
  const resolved = resolveComposerPrimaryActions({
    canAbort: true,
    aborting: false,
    canSend: true,
    sending: true,
  })

  assert.equal(resolved.showStop, true)
  assert.equal(resolved.stopDisabled, false)
  assert.equal(resolved.sendDisabled, true)
})

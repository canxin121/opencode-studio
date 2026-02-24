import assert from 'node:assert/strict'
import test from 'node:test'

import { closeAllComposerInputMenus, openComposerInputMenu } from '../src/pages/chat/composerInputMenus'

function makeClosers() {
  const calls: string[] = []
  return {
    calls,
    closers: {
      closeAttachments: () => calls.push('attachments'),
      closeActions: () => calls.push('actions'),
      closePicker: () => calls.push('picker'),
    },
  }
}

test('openComposerInputMenu closes actions and picker when opening attachments', () => {
  const { calls, closers } = makeClosers()
  openComposerInputMenu('attachments', closers)
  assert.deepEqual(calls, ['actions', 'picker'])
})

test('openComposerInputMenu closes attachments and picker when opening actions', () => {
  const { calls, closers } = makeClosers()
  openComposerInputMenu('actions', closers)
  assert.deepEqual(calls, ['attachments', 'picker'])
})

test('openComposerInputMenu closes attachments and actions when opening picker', () => {
  const { calls, closers } = makeClosers()
  openComposerInputMenu('picker', closers)
  assert.deepEqual(calls, ['attachments', 'actions'])
})

test('closeAllComposerInputMenus closes every input menu', () => {
  const { calls, closers } = makeClosers()
  closeAllComposerInputMenus(closers)
  assert.deepEqual(calls, ['attachments', 'actions', 'picker'])
})

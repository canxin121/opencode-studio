import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldAcceptSessionActionTap } from '../src/layout/chatSidebar/sessionActionTapGuard'

test('blocks ghost action clicks without recent pointerdown', () => {
  const event = { detail: 1 } as MouseEvent
  assert.equal(shouldAcceptSessionActionTap(event, 0), false)
})

test('accepts keyboard-triggered click for accessibility', () => {
  const event = { detail: 0 } as MouseEvent
  assert.equal(shouldAcceptSessionActionTap(event, 0), true)
})

test('accepts click when pointerdown happened recently', () => {
  const event = { detail: 1 } as MouseEvent
  const pointerDownAt = Date.now() - 120
  assert.equal(shouldAcceptSessionActionTap(event, pointerDownAt), true)
})

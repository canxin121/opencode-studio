import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldAcceptListItemActionTap } from '../src/components/ui/listItemTapGuard'

test('rejects pointer click when no pointerdown timestamp exists', () => {
  const event = { detail: 1 } as MouseEvent
  assert.equal(shouldAcceptListItemActionTap(event, 0), false)
})

test('allows keyboard-triggered action click', () => {
  const event = { detail: 0 } as MouseEvent
  assert.equal(shouldAcceptListItemActionTap(event, 0), true)
})

test('allows click when pointerdown is recent', () => {
  const event = { detail: 1 } as MouseEvent
  const pointerDownAt = Date.now() - 200
  assert.equal(shouldAcceptListItemActionTap(event, pointerDownAt), true)
})

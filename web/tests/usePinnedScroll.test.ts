import assert from 'node:assert/strict'
import test from 'node:test'

import { isScrollableY, shouldAutoLoadOlder } from '../src/composables/chat/usePinnedScroll'

test('keeps initial entry pinned by blocking auto-load before user scrolls', () => {
  const shouldLoad = shouldAutoLoadOlder({
    canLoadOlder: true,
    suppressed: false,
    scrollTop: 0,
    autoLoadUnlocked: false,
    atBottom: false,
  })

  assert.equal(shouldLoad, false)
})

test('does not auto-load while still at bottom', () => {
  const shouldLoad = shouldAutoLoadOlder({
    canLoadOlder: true,
    suppressed: false,
    scrollTop: 0,
    autoLoadUnlocked: true,
    atBottom: true,
  })

  assert.equal(shouldLoad, false)
})

test('auto-loads only after user unlocks and reaches top area', () => {
  const shouldLoad = shouldAutoLoadOlder({
    canLoadOlder: true,
    suppressed: false,
    scrollTop: 80,
    autoLoadUnlocked: true,
    atBottom: false,
  })

  assert.equal(shouldLoad, true)
})

test('respects suppression window during programmatic navigation', () => {
  const shouldLoad = shouldAutoLoadOlder({
    canLoadOlder: true,
    suppressed: true,
    scrollTop: 0,
    autoLoadUnlocked: true,
    atBottom: false,
  })

  assert.equal(shouldLoad, false)
})

test('isScrollableY returns false when container is missing', () => {
  assert.equal(isScrollableY(null), false)
})

test('isScrollableY returns false when content is not scrollable', () => {
  assert.equal(isScrollableY({ clientHeight: 400, scrollHeight: 400 }), false)
  assert.equal(isScrollableY({ clientHeight: 400, scrollHeight: 401 }), false)
})

test('isScrollableY returns true when content exceeds viewport', () => {
  assert.equal(isScrollableY({ clientHeight: 400, scrollHeight: 540 }), true)
})

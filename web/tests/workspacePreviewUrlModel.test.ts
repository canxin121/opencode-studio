import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPreviewFrameSrc,
  normalizePreviewUrl,
  resolvePreviewTarget,
} from '../src/features/workspacePreview/model/previewUrl'

test('normalizePreviewUrl accepts bare host and defaults to http', () => {
  assert.equal(normalizePreviewUrl('localhost:5173'), 'http://localhost:5173/')
})

test('normalizePreviewUrl rejects unsupported protocols', () => {
  assert.equal(normalizePreviewUrl('javascript:alert(1)'), '')
  assert.equal(normalizePreviewUrl('file:///tmp/index.html'), '')
})

test('resolvePreviewTarget prefers manual URL over detected URL', () => {
  const resolved = resolvePreviewTarget('https://manual.example.dev', 'http://localhost:3000')
  assert.equal(resolved, 'https://manual.example.dev/')
})

test('buildPreviewFrameSrc appends refresh token to URL', () => {
  const src = buildPreviewFrameSrc('https://example.dev/path?x=1', 12)
  assert.equal(src, 'https://example.dev/path?x=1&__oc_preview_refresh=12')
})

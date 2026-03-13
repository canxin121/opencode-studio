import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPreviewFrameSrc, normalizePreviewProxyBasePath } from '../src/features/workspacePreview/model/previewUrl'

test('normalizePreviewProxyBasePath normalizes preview session paths', () => {
  assert.equal(
    normalizePreviewProxyBasePath('/api/workspace/preview/s/session-1'),
    '/api/workspace/preview/s/session-1/',
  )
})

test('normalizePreviewProxyBasePath rejects non-session or direct targets', () => {
  assert.equal(normalizePreviewProxyBasePath('https://example.dev/app'), '')
  assert.equal(normalizePreviewProxyBasePath('/api/workspace/preview/proxy?target=http://localhost:5173'), '')
})

test('buildPreviewFrameSrc appends refresh token to proxy base path', () => {
  const src = buildPreviewFrameSrc('/api/workspace/preview/s/session-1/', 12)
  assert.equal(src, '/api/workspace/preview/s/session-1/?__oc_preview_refresh=12')
})

test('buildPreviewFrameSrc always uses proxy session path and hides target URL', () => {
  const src = buildPreviewFrameSrc('/api/workspace/preview/s/demo-app/', 0)
  assert.match(src, /^\/api\/workspace\/preview\/s\//)
  assert.equal(src.includes('http://localhost:5173/'), false)
  assert.equal(src.includes('localhost:5173'), false)
})

test('buildPreviewFrameSrc returns empty for invalid proxy base path', () => {
  assert.equal(buildPreviewFrameSrc('javascript:alert(1)', 1), '')
  assert.equal(buildPreviewFrameSrc('', 1), '')
})

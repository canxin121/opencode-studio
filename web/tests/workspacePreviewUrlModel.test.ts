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

test('selected created session still builds iframe src from proxyBasePath', () => {
  const createdSession = {
    id: 'pv_demo-app',
    proxyBasePath: '/api/workspace/preview/s/pv_demo-app/',
    targetUrl: 'http://127.0.0.1:8000',
  }
  const activeSessionId = createdSession.id
  const src = buildPreviewFrameSrc(createdSession.proxyBasePath, 3)

  assert.equal(activeSessionId, 'pv_demo-app')
  assert.equal(src, '/api/workspace/preview/s/pv_demo-app/?__oc_preview_refresh=3')
  assert.equal(src.includes(createdSession.targetUrl), false)
})

test('buildPreviewFrameSrc returns empty for invalid proxy base path', () => {
  assert.equal(buildPreviewFrameSrc('javascript:alert(1)', 1), '')
  assert.equal(buildPreviewFrameSrc('', 1), '')
})

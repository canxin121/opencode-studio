import test from 'node:test'
import assert from 'node:assert/strict'

import {
  extractWorkspacePathFromFileUrl,
  mediaKindFromHref,
  resolveWorkspaceFileLink,
  resolveWorkspaceMediaUrl,
} from '../src/lib/workspaceLinks'

const WORKSPACE_ROOT = '/workspace/project'
const DOC_README = '/workspace/project/docs/README.md'

test('resolveWorkspaceFileLink supports relative paths and line fragments', () => {
  assert.deepEqual(
    resolveWorkspaceFileLink('../src/main.ts#L42', { workspaceRoot: WORKSPACE_ROOT, baseFilePath: DOC_README }),
    {
      path: '/workspace/project/src/main.ts',
      line: 42,
    },
  )

  assert.deepEqual(resolveWorkspaceFileLink('docs/spec.md:12:3', { workspaceRoot: WORKSPACE_ROOT }), {
    path: '/workspace/project/docs/spec.md',
    line: 12,
    column: 3,
  })

  assert.deepEqual(
    resolveWorkspaceFileLink('./guide.md#getting-started', { workspaceRoot: WORKSPACE_ROOT, baseFilePath: DOC_README }),
    {
      path: '/workspace/project/docs/guide.md',
      anchor: 'getting-started',
    },
  )

  assert.deepEqual(
    resolveWorkspaceFileLink('./guide.md#%E4%B8%AD%E6%96%87', {
      workspaceRoot: WORKSPACE_ROOT,
      baseFilePath: DOC_README,
    }),
    {
      path: '/workspace/project/docs/guide.md',
      anchor: '中文',
    },
  )
})

test('resolveWorkspaceFileLink rejects paths outside workspace', () => {
  assert.equal(
    resolveWorkspaceFileLink('../../../etc/passwd', {
      workspaceRoot: WORKSPACE_ROOT,
      baseFilePath: DOC_README,
    }),
    null,
  )
})

test('resolveWorkspaceMediaUrl builds raw endpoint for local media links', () => {
  assert.equal(mediaKindFromHref('assets/diagram.png'), 'image')
  assert.equal(mediaKindFromHref('assets/demo.webm'), 'video')
  assert.equal(mediaKindFromHref('assets/voice.mp3'), 'audio')

  assert.equal(
    resolveWorkspaceMediaUrl('./assets/diagram.png', {
      workspaceRoot: WORKSPACE_ROOT,
      baseFilePath: DOC_README,
    }),
    '/api/fs/raw?directory=%2Fworkspace%2Fproject&path=%2Fworkspace%2Fproject%2Fdocs%2Fassets%2Fdiagram.png',
  )
})

test('extractWorkspacePathFromFileUrl parses /api/fs/raw links', () => {
  assert.equal(
    extractWorkspacePathFromFileUrl(
      '/api/fs/raw?directory=%2Fworkspace%2Fproject&path=docs%2FREADME.md',
      WORKSPACE_ROOT,
    ),
    '/workspace/project/docs/README.md',
  )

  assert.equal(extractWorkspacePathFromFileUrl('https://example.com/image.png', WORKSPACE_ROOT), null)
})

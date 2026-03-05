import test from 'node:test'
import assert from 'node:assert/strict'

import { detectPreviewMode, extensionFromPath, isMermaidPath } from '../src/pages/files/previewKinds'

test('extensionFromPath normalizes extensions', () => {
  assert.equal(extensionFromPath('docs/README.MD'), 'md')
  assert.equal(extensionFromPath('/tmp/video.sample.MP4'), 'mp4')
  assert.equal(extensionFromPath('no-extension'), '')
})

test('detectPreviewMode handles markdown and rich media', () => {
  assert.equal(detectPreviewMode('README.md'), 'markdown')
  assert.equal(detectPreviewMode('docs/architecture.mermaid'), 'markdown')
  assert.equal(detectPreviewMode('docs/flow.MMD'), 'markdown')
  assert.equal(detectPreviewMode('slides/spec.pdf'), 'pdf')
  assert.equal(detectPreviewMode('media/voice.ogg'), 'audio')
  assert.equal(detectPreviewMode('media/demo.webm'), 'video')
  assert.equal(detectPreviewMode('images/hero.png'), 'image')
  assert.equal(detectPreviewMode('src/main.ts'), 'text')
})

test('detectPreviewMode keeps common text/config/markup formats in text preview', () => {
  assert.equal(detectPreviewMode('config/app.ini'), 'text')
  assert.equal(detectPreviewMode('config/nginx.conf'), 'text')
  assert.equal(detectPreviewMode('.env'), 'text')
  assert.equal(detectPreviewMode('workspace/.editorconfig'), 'text')
  assert.equal(detectPreviewMode('data/settings.toml'), 'text')
  assert.equal(detectPreviewMode('docs/reference.rst'), 'text')
  assert.equal(detectPreviewMode('docs/spec.adoc'), 'text')
  assert.equal(detectPreviewMode('metadata/catalog.jsonl'), 'text')
})

test('isMermaidPath detects dedicated mermaid sources', () => {
  assert.equal(isMermaidPath('docs/sequence.mermaid'), true)
  assert.equal(isMermaidPath('docs/state.mmd'), true)
  assert.equal(isMermaidPath('docs/readme.md'), false)
})

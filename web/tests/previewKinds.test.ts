import test from 'node:test'
import assert from 'node:assert/strict'

import { detectPreviewMode, extensionFromPath } from '../src/pages/files/previewKinds'

test('extensionFromPath normalizes extensions', () => {
  assert.equal(extensionFromPath('docs/README.MD'), 'md')
  assert.equal(extensionFromPath('/tmp/video.sample.MP4'), 'mp4')
  assert.equal(extensionFromPath('no-extension'), '')
})

test('detectPreviewMode handles markdown and rich media', () => {
  assert.equal(detectPreviewMode('README.md'), 'markdown')
  assert.equal(detectPreviewMode('slides/spec.pdf'), 'pdf')
  assert.equal(detectPreviewMode('media/voice.ogg'), 'audio')
  assert.equal(detectPreviewMode('media/demo.webm'), 'video')
  assert.equal(detectPreviewMode('images/hero.png'), 'image')
  assert.equal(detectPreviewMode('src/main.ts'), 'text')
})

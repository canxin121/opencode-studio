import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('git editor diff passes first changed line into monaco initial top line', () => {
  const source = readFileSync(resolve(import.meta.dir, '../src/components/git/GitEditorDiffViewer.vue'), 'utf8')

  assert.ok(source.includes('const firstChangedLine = computed<number | null>(() => {'))
  assert.ok(source.includes('hunk.anchorLine'))
  assert.ok(source.includes(':initial-top-line="firstChangedLine"'))
})

test('all other monaco diff scenes wire initial top line', () => {
  const history = readFileSync(resolve(import.meta.dir, '../src/components/git/GitHistoryDialog.vue'), 'utf8')
  const stash = readFileSync(resolve(import.meta.dir, '../src/components/git/GitStashViewDialog.vue'), 'utf8')
  const compare = readFileSync(resolve(import.meta.dir, '../src/components/git/GitCompareDialog.vue'), 'utf8')
  const fileViewer = readFileSync(resolve(import.meta.dir, '../src/pages/files/components/FileViewerPane.vue'), 'utf8')
  const toolInvocation = readFileSync(resolve(import.meta.dir, '../src/components/ui/ToolInvocation.vue'), 'utf8')
  const pluginOverlay = readFileSync(
    resolve(import.meta.dir, '../src/components/chat/PluginChatOverlayMounts.vue'),
    'utf8',
  )

  assert.ok(history.includes(':initial-top-line="selectedFileDiffModel.initialTopLine"'))
  assert.ok(history.includes(':modified-start-line="selectedFileDiffModel.modifiedStartLine"'))
  assert.ok(history.includes(':initial-top-line="commitDiffModel.initialTopLine"'))
  assert.ok(history.includes(':modified-line-numbers="commitDiffModel.modifiedLineNumbers"'))
  assert.ok(stash.includes(':initial-top-line="stashDiffModel.initialTopLine"'))
  assert.ok(stash.includes(':original-line-numbers="stashDiffModel.originalLineNumbers"'))
  assert.ok(compare.includes(':initial-top-line="compareDiffModel.initialTopLine"'))
  assert.ok(compare.includes(':modified-start-line="compareDiffModel.modifiedStartLine"'))
  assert.ok(fileViewer.includes(':initial-top-line="timelineInitialTopLine"'))
  assert.ok(toolInvocation.includes(':initial-top-line="activityDiffPreview.initialTopLine"'))
  assert.ok(toolInvocation.includes(':modified-line-numbers="activityDiffPreview.modifiedLineNumbers"'))
  assert.ok(pluginOverlay.includes(':initial-top-line="selectedDiffPreview?.initialTopLine || null"'))
  assert.ok(pluginOverlay.includes(':modified-start-line="selectedDiffPreview?.modifiedStartLine || null"'))
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('file editors expose a text-editor root marker', () => {
  const codeEditor = readFileSync(resolve(import.meta.dir, '../src/components/MonacoCodeEditor.vue'), 'utf8')
  const diffEditor = readFileSync(resolve(import.meta.dir, '../src/components/MonacoDiffEditor.vue'), 'utf8')

  assert.ok(codeEditor.includes('data-oc-text-editor-root="true"'))
  assert.ok(diffEditor.includes('data-oc-text-editor-root="true"'))
})

test('mobile monaco styles keep native text selection enabled', () => {
  const codeEditor = readFileSync(resolve(import.meta.dir, '../src/components/MonacoCodeEditor.vue'), 'utf8')
  const diffEditor = readFileSync(resolve(import.meta.dir, '../src/components/MonacoDiffEditor.vue'), 'utf8')

  assert.ok(codeEditor.includes(':root.mobile-pointer .monaco-host .monaco-editor .lines-content'))
  assert.ok(diffEditor.includes(':root.mobile-pointer .monaco-diff-host .monaco-editor .lines-content'))

  assert.ok(codeEditor.includes('-webkit-user-select: text !important;'))
  assert.ok(diffEditor.includes('-webkit-user-select: text !important;'))
  assert.ok(codeEditor.includes('user-select: text !important;'))
  assert.ok(diffEditor.includes('user-select: text !important;'))
})

test('monaco diff editor keeps reveal and hunk actions enabled by default', () => {
  const diffEditor = readFileSync(resolve(import.meta.dir, '../src/components/MonacoDiffEditor.vue'), 'utf8')

  assert.ok(diffEditor.includes('autoRevealFirstChange: true'))
  assert.ok(diffEditor.includes('hunkActionsEnabled: true'))
  assert.ok(diffEditor.includes('initialTopLine?: number | null'))
  assert.ok(diffEditor.includes('originalStartLine?: number | null'))
  assert.ok(diffEditor.includes('modifiedStartLine?: number | null'))
  assert.ok(diffEditor.includes('originalLineNumbers?: Array<number | null> | null'))
  assert.ok(diffEditor.includes('modifiedLineNumbers?: Array<number | null> | null'))
})

test('monaco diff reveal waits for visible layout before consuming first-change reveal', () => {
  const diffEditor = readFileSync(resolve(import.meta.dir, '../src/components/MonacoDiffEditor.vue'), 'utf8')

  assert.ok(diffEditor.includes('onDidLayoutChange(() => {'))
  assert.ok(diffEditor.includes('layout.width <= 0 || layout.height <= 0'))
  assert.ok(diffEditor.includes('requestAnimationFrame(() => {'))
  assert.ok(diffEditor.includes('getRequestedInitialTopLine()'))
  assert.ok(diffEditor.includes('resolveModelLineFromDisplayLine('))
  assert.ok(diffEditor.includes('updateLineNumberOptions()'))
  assert.ok(diffEditor.includes('revealModifiedLineAtTop'))
  assert.ok(diffEditor.includes("'is-hidden': !ready"))
})

test('keyboard tap fix skips editor surfaces and file viewer listens on pointerup', () => {
  const tapFix = readFileSync(resolve(import.meta.dir, '../src/lib/keyboardTapFix.ts'), 'utf8')
  const viewer = readFileSync(resolve(import.meta.dir, '../src/pages/files/components/FileViewerPane.vue'), 'utf8')

  assert.ok(tapFix.includes('[data-oc-text-editor-root="true"]'))
  assert.ok(tapFix.includes('if (isTextEditorSurface(eventTarget)) return'))
  assert.ok(viewer.includes('@pointerup="updateSelectionFromEditor"'))
})

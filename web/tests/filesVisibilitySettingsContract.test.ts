import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('files page syncs visibility preferences from settings payload', () => {
  const file = resolve(import.meta.dir, '../src/pages/FilesPage.vue')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes("import { useSettingsStore } from '@/stores/settings'"))
  assert.ok(source.includes('function syncFilesVisibilityPreferencesFromSettings(next: Settings | null)'))
  assert.ok(source.includes("const hasShowHidden = typeof next.directoryShowHidden === 'boolean'"))
  assert.ok(source.includes("const hasShowGitignored = typeof next.filesViewShowGitignored === 'boolean'"))
  assert.ok(source.includes('patch.directoryShowHidden = showHidden.value'))
  assert.ok(source.includes('patch.filesViewShowGitignored = !respectGitignore.value'))
})

test('files page persists visibility preferences through settings store', () => {
  const file = resolve(import.meta.dir, '../src/pages/FilesPage.vue')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes('function persistFilesVisibilityPreferencesToSettings()'))
  assert.ok(source.includes('if (settings.data.directoryShowHidden !== showHidden.value)'))
  assert.ok(source.includes('if (settings.data.filesViewShowGitignored !== showGitignored)'))
  assert.ok(source.includes('void settings.save(patch)'))
  assert.ok(source.includes('watch(showHidden, () => persistFilesVisibilityPreferencesToSettings())'))
  assert.ok(source.includes('watch(\n  () => settings.data,'))
  assert.ok(source.includes('{ immediate: true }'))
})

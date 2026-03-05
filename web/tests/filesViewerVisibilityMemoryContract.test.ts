import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('files page persists viewer visibility preferences', () => {
  const file = resolve(import.meta.dir, '../src/pages/FilesPage.vue')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes('const STORAGE_FILES_VIEWER_BLAME_VISIBLE = localStorageKeys.files.viewerBlameVisible'))
  assert.ok(
    source.includes('const STORAGE_FILES_VIEWER_TIMELINE_VISIBLE = localStorageKeys.files.viewerTimelineVisible'),
  )
  assert.ok(
    source.includes("const blameEnabled = ref(localStorage.getItem(STORAGE_FILES_VIEWER_BLAME_VISIBLE) === 'true')"),
  )
  assert.ok(
    source.includes(
      "const timelineVisibilityPreference = ref(localStorage.getItem(STORAGE_FILES_VIEWER_TIMELINE_VISIBLE) === 'true')",
    ),
  )
  assert.ok(
    source.includes(
      "watch(blameEnabled, (v) => localStorage.setItem(STORAGE_FILES_VIEWER_BLAME_VISIBLE, v ? 'true' : 'false'))",
    ),
  )
  assert.ok(source.includes('watch(timelineVisibilityPreference, (v) =>'))
})

test('files page restores timeline visibility on next file open', () => {
  const file = resolve(import.meta.dir, '../src/pages/FilesPage.vue')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes('const shouldRestoreTimeline = timelineVisibilityPreference.value'))
  assert.ok(source.includes("if (shouldRestoreTimeline && viewerMode.value === 'text') {"))
  assert.ok(source.includes('openFileTimeline()'))
  assert.ok(source.includes('timelineVisibilityPreference.value = false'))
  assert.ok(source.includes('timelineVisibilityPreference.value = true'))
})

test('files page restores selected file when mobile files view remounts', () => {
  const file = resolve(import.meta.dir, '../src/pages/FilesPage.vue')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes("const restoredSelectedFilePath = ref('')"))
  assert.ok(source.includes('uiState.selectedPath'))
  assert.ok(source.includes('async function restoreMobileSelectedFile(rootPath: string, seq: number) {'))
  assert.ok(source.includes('if (!isMobile.value) return'))
  assert.ok(source.includes('await restoreMobileSelectedFile(next, seq)'))
})

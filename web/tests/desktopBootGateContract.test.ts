import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('desktop app stops blocking on the loading screen once /health responds', () => {
  const file = resolve(import.meta.dir, '../src/App.vue')
  const source = readFileSync(file, 'utf8')

  assert.match(source, /const desktopBackendReachable = computed\(\(\) => health\.data !== null\)/)
  assert.match(
    source,
    /const showDesktopLoading = computed\(\(\) => desktopRuntime && !desktopBackendReachable\.value\)/,
  )
})

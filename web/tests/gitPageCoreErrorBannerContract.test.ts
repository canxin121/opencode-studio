import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('git page view shows core load error message when present', () => {
  const file = resolve(import.meta.dir, '../src/pages/git/GitPageView.vue')
  const source = readFileSync(file, 'utf8')

  // Ensure the view destructures the page-owned `error` ref from ctx.
  assert.match(source, /\brepoBusy,\s*\n\s*loading,\s*\n\s*error,\s*\n\s*status,/m)

  // Ensure it is rendered (multiline friendly), so failures like git spawn errors aren't hidden.
  assert.ok(source.includes('v-else-if="error"'))
  assert.ok(source.includes('whitespace-pre-line'))
})

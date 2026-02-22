import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

test('keyboardTapFix keeps pending briefly after fallback to suppress late ghost clicks', async () => {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const sourcePath = path.join(__dirname, '../src/lib/keyboardTapFix.ts')
  const source = await readFile(sourcePath, 'utf8')

  // Fallback path should not clear pending immediately; it should keep a small window
  // to suppress delayed post-IME trusted clicks that retarget after relayout.
  assert.match(source, /pending\.syntheticClickFired\s*=\s*true/)
  assert.match(source, /POST_IME_GHOST_SUPPRESS_MS/)
  assert.match(source, /pending\.clearTimer\s*=\s*window\.setTimeout/)

  // Click capture should suppress duplicates if fallback already fired.
  assert.match(source, /pending\.syntheticClickFired\s*\)\s*\{[\s\S]*e\.stopImmediatePropagation\(\)/)
})

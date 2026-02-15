import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

test('keyboardTapFix suppresses retargeted trusted clicks while waiting for native click', async () => {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const sourcePath = path.join(__dirname, '../src/lib/keyboardTapFix.ts')
  const source = await readFile(sourcePath, 'utf8')

  assert.match(source, /pending\s*&&\s*pending\.waitingForNativeClick\s*&&\s*e\.isTrusted/)
  assert.match(source, /pending\.target\.contains\(t\)/)
  assert.match(source, /post-IME click can be retargeted/)
  assert.match(source, /e\.stopImmediatePropagation\(\)/)
})

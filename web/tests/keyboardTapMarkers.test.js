import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

async function walk(dir) {
  const out = []
  const entries = await readdir(dir)
  for (const name of entries) {
    const full = path.join(dir, name)
    const s = await stat(full)
    if (s.isDirectory()) {
      out.push(...(await walk(full)))
      continue
    }
    out.push(full)
  }
  return out
}

test('Keyboard tap markers stay limited to allowed controls', async () => {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const srcDir = path.join(__dirname, '../src')
  const files = await walk(srcDir)

  const markerFiles = []
  for (const f of files) {
    if (!f.endsWith('.vue')) continue
    const content = await readFile(f, 'utf8')
    if (!content.includes('data-oc-keyboard-tap=')) continue
    markerFiles.push(path.relative(srcDir, f).replace(/\\/g, '/'))
  }

  const expected = [
    'components/chat/Composer.vue',
    'components/TerminalKeybar.vue',
    'pages/chat/ChatPageView.vue',
  ].sort()

  markerFiles.sort()
  assert.deepEqual(markerFiles, expected)

  const composer = await readFile(path.join(srcDir, 'components/chat/Composer.vue'), 'utf8')
  assert.match(composer, /data-oc-keyboard-tap=("|')keep\1/)
  const terminal = await readFile(path.join(srcDir, 'components/TerminalKeybar.vue'), 'utf8')
  assert.match(terminal, /data-oc-keyboard-tap=("|')keep\1/)
  const chatView = await readFile(path.join(srcDir, 'pages/chat/ChatPageView.vue'), 'utf8')
  assert.match(chatView, /data-oc-keyboard-tap=("|')blur\1/)
})

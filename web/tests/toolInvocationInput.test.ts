import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveToolInputDisplay } from '../src/components/ui/toolInvocationInput'

test('resolveToolInputDisplay: shows full bash command input', () => {
  const command = 'git status && git diff\nprintf "done"\n'
  const out = resolveToolInputDisplay('bash', { command, timeout: 120000 })

  assert.equal(out.lang, 'bash')
  assert.equal(out.text, command)
})

test('resolveToolInputDisplay: shows full JSON input for generic tools', () => {
  const input = {
    url: 'https://example.com',
    format: 'markdown',
    timeout: 30,
    nested: { keep: true, label: 'all params' },
  }

  const out = resolveToolInputDisplay('webfetch', input)

  assert.equal(out.lang, 'json')
  assert.equal(out.text, JSON.stringify(input, null, 2))
})

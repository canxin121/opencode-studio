import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('mobile OptionMenu overlay keeps pointer events from passing through', () => {
  const file = resolve(import.meta.dir, '../src/components/ui/OptionMenu.vue')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes('data-oc-keyboard-tap="keep"'))
  assert.ok(source.includes('@pointerdown.stop'))
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('mcp section exposes ui store to template bindings', () => {
  const file = resolve(import.meta.dir, '../src/components/settings/opencode/sections/OpenCodeSectionMcp.vue')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes("import { useUiStore } from '@/stores/ui'"))
  assert.ok(source.includes('ctx.ui = ui'))
  assert.ok(source.includes(':is-mobile-pointer="ui.isMobilePointer"'))
})

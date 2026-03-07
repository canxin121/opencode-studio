import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('search input keeps clear behavior and adds right-side search action', () => {
  const file = resolve(import.meta.dir, '../src/components/ui/SearchInput.vue')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes("if (event.key !== 'Enter') return"))
  assert.ok(source.includes('@click="triggerSearch"'))
  assert.ok(source.includes('class="absolute right-1 top-1/2 -translate-y-1/2'))
  assert.ok(source.includes("props.showSearchButton ? 'right-8' : 'right-1'"))
  assert.ok(source.includes('@click="clearValue"'))
  assert.ok(source.includes('if (!hasValue.value) return'))
})

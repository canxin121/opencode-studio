import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

test('normalizeDirForCompare lowercases Windows drive paths', () => {
  const source = readFileSync(resolve(import.meta.dir, '../src/features/sessions/model/labels.ts'), 'utf8')
  assert.ok(source.includes('if (/^[A-Za-z]:/.test(canonical)) return canonical.toLowerCase()'))
})

test('normalizeDirForCompare decodes URL-encoded inputs before matching', () => {
  const source = readFileSync(resolve(import.meta.dir, '../src/features/sessions/model/labels.ts'), 'utf8')
  assert.ok(source.includes('decodeURIComponent(trimmed)'))
})

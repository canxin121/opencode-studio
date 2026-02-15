import test from 'node:test'
import assert from 'node:assert/strict'

import { globToRegExp, matchPattern } from '../src/lib/opencodePermission.js'

test('globToRegExp basic cases', () => {
  assert.ok(globToRegExp('*').test('anything'))
  assert.ok(globToRegExp('**/*.ts').test('src/app.ts'))
  assert.ok(!globToRegExp('**/*.ts').test('src/app.tsx'))
  assert.ok(globToRegExp('foo?.txt').test('fooa.txt'))
  assert.ok(!globToRegExp('foo?.txt').test('fooa/b.txt'))
})

test('matchPattern basename fallback when no slash', () => {
  assert.equal(matchPattern('*.ts', 'src/app.ts'), true)
  assert.equal(matchPattern('*.ts', 'src/app.tsx'), false)
  assert.equal(matchPattern('*.ts', 'app.ts'), true)
})

test('matchPattern ** and * semantics', () => {
  assert.equal(matchPattern('**/dist/**', 'a/b/dist/c.js'), true)
  assert.equal(matchPattern('*/dist/**', 'a/b/dist/c.js'), false)
  assert.equal(matchPattern('*/dist/**', 'a/dist/c.js'), true)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { composeGitPageViewContext } from '../src/pages/git/composeGitPageViewContext.ts'

test('composeGitPageViewContext: merges unique groups', () => {
  const ctx = composeGitPageViewContext([
    { label: 'core', values: { a: 1, b: 2 } },
    { label: 'extra', values: { c: 3 } },
  ])

  assert.deepEqual(ctx, { a: 1, b: 2, c: 3 })
})

test('composeGitPageViewContext: ignores duplicate keys after first provider', () => {
  const ctx = composeGitPageViewContext([
    { label: 'core', values: { same: 'first', a: 1 } },
    { label: 'secondary', values: { same: 'second', b: 2 } },
  ])

  assert.equal(ctx.same, 'first')
  assert.equal(ctx.a, 1)
  assert.equal(ctx.b, 2)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildRunningSessionRows, type RunningSessionRow } from '../src/layout/chatSidebar/runningSessionRows'

function row(input: Partial<RunningSessionRow> & Pick<RunningSessionRow, 'id'>): RunningSessionRow {
  return {
    id: input.id,
    session: input.session || ({ id: input.id } as RunningSessionRow['session']),
    renderKey: input.renderKey || input.id,
    depth: typeof input.depth === 'number' ? input.depth : 0,
    parentId: input.parentId || null,
    rootId: input.rootId || input.id,
    isParent: input.isParent === true,
    isExpanded: input.isExpanded === true,
  }
}

test('running session rows use parent IDs from row/session and hide children until expanded', () => {
  const rows = [
    row({ id: 'parent', rootId: 'parent' }),
    row({ id: 'child', depth: 1, rootId: 'parent', session: { id: 'child', parentID: 'parent' } }),
  ]

  const collapsed = buildRunningSessionRows(rows, new Set())
  assert.deepEqual(collapsed.map((item) => item.id), ['parent'])
  assert.equal(collapsed[0]?.isParent, true)

  const expanded = buildRunningSessionRows(rows, new Set(['parent']))
  assert.deepEqual(expanded.map((item) => item.id), ['parent', 'child'])
  assert.equal(expanded[0]?.isExpanded, true)
  assert.equal(expanded[1]?.depth, 1)
})

test('running session rows infer parent-child links from depth when parentId is missing', () => {
  const rows = [row({ id: 'a', rootId: 'a' }), row({ id: 'b', depth: 1, rootId: 'a' })]

  const collapsed = buildRunningSessionRows(rows, new Set())
  assert.deepEqual(collapsed.map((item) => item.id), ['a'])

  const expanded = buildRunningSessionRows(rows, new Set(['a']))
  assert.deepEqual(expanded.map((item) => item.id), ['a', 'b'])
  assert.equal(expanded[1]?.parentId, 'a')
})

test('running session rows preserve standalone sessions', () => {
  const rows = [row({ id: 'solo', rootId: 'solo' })]
  const out = buildRunningSessionRows(rows, new Set())

  assert.deepEqual(out.map((item) => item.id), ['solo'])
  assert.equal(out[0]?.isParent, false)
  assert.equal(out[0]?.depth, 0)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isDirectoryAggregatePageSatisfied,
  normalizePage,
  shouldReloadExpandedDirectoryAggregate,
} from '../src/stores/directorySessions/pagination.ts'

test('normalizePage clamps invalid values to page zero', () => {
  assert.equal(normalizePage(undefined), 0)
  assert.equal(normalizePage(null), 0)
  assert.equal(normalizePage(Number.NaN), 0)
  assert.equal(normalizePage(-4), 0)
  assert.equal(normalizePage(2.9), 2)
})

test('isDirectoryAggregatePageSatisfied compares normalized page indexes', () => {
  assert.equal(isDirectoryAggregatePageSatisfied(3, 3), true)
  assert.equal(isDirectoryAggregatePageSatisfied(3.8, 3), true)
  assert.equal(isDirectoryAggregatePageSatisfied(undefined, 0), true)
  assert.equal(isDirectoryAggregatePageSatisfied(0, 1), false)
})

test('shouldReloadExpandedDirectoryAggregate skips reload only for matching attempted cache page', () => {
  assert.equal(
    shouldReloadExpandedDirectoryAggregate({ attempted: true, hasCache: true, cachedPage: 2, targetPage: 2 }),
    false,
  )
  assert.equal(
    shouldReloadExpandedDirectoryAggregate({ attempted: true, hasCache: true, cachedPage: 0, targetPage: 2 }),
    true,
  )
  assert.equal(
    shouldReloadExpandedDirectoryAggregate({ attempted: true, hasCache: false, cachedPage: 2, targetPage: 2 }),
    true,
  )
  assert.equal(
    shouldReloadExpandedDirectoryAggregate({ attempted: false, hasCache: true, cachedPage: 2, targetPage: 2 }),
    true,
  )
})

test('refresh regression: persisted non-first page must trigger reload when bootstrap cache is page zero', () => {
  const shouldReload = shouldReloadExpandedDirectoryAggregate({
    attempted: true,
    hasCache: true,
    cachedPage: 0,
    targetPage: 4,
  })

  assert.equal(shouldReload, true)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ACTIVITY_DEFAULT_EXPANDED_OPTIONS,
  DEFAULT_CHAT_ACTIVITY_FILTERS,
  DEFAULT_CHAT_ACTIVITY_EXPANDED_TOOL_FILTERS,
  DEFAULT_CHAT_ACTIVITY_EXPAND_KEYS,
  DEFAULT_CHAT_TOOL_ACTIVITY_FILTERS,
  normalizeChatActivityDefaultExpanded,
  normalizeChatActivityFilters,
} from '../src/lib/chatActivity'

test('activity defaults remove step and agent detail types', () => {
  assert.equal(DEFAULT_CHAT_ACTIVITY_FILTERS.includes('step-start'), false)
  assert.equal(DEFAULT_CHAT_ACTIVITY_FILTERS.includes('step-finish'), false)
  assert.equal(DEFAULT_CHAT_ACTIVITY_FILTERS.includes('agent'), false)

  const optionIds = ACTIVITY_DEFAULT_EXPANDED_OPTIONS.map((item) => item.id)
  assert.equal(optionIds.includes('step-start'), false)
  assert.equal(optionIds.includes('step-finish'), false)
  assert.equal(optionIds.includes('agent'), false)
})

test('normalizers ignore removed step and agent keys', () => {
  const filters = normalizeChatActivityFilters(['step-start', 'agent', 'snapshot'])
  assert.deepEqual(filters, ['tool', 'snapshot'])

  const expanded = normalizeChatActivityDefaultExpanded(['step-finish', 'agent', 'snapshot', 'thinking'])
  assert.deepEqual(expanded, [])
})

test('default expansion only opens file-modifying details', () => {
  assert.deepEqual(DEFAULT_CHAT_ACTIVITY_EXPAND_KEYS, ['patch'])

  assert.deepEqual(DEFAULT_CHAT_ACTIVITY_EXPANDED_TOOL_FILTERS, ['edit', 'write', 'apply_patch', 'multiedit'])
  for (const tool of DEFAULT_CHAT_ACTIVITY_EXPANDED_TOOL_FILTERS) {
    assert.equal(DEFAULT_CHAT_TOOL_ACTIVITY_FILTERS.includes(tool), true)
  }
})

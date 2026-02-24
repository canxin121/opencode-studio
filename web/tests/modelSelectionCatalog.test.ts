import test from 'node:test'
import assert from 'node:assert/strict'

import { isSelectablePrimaryAgent, modelIdsFromProviderModels } from '../src/pages/chat/modelSelectionCatalog'

test('modelIdsFromProviderModels: supports array and object shapes', () => {
  assert.deepEqual(modelIdsFromProviderModels([{ id: 'gpt-4.1' }, { id: 'claude-sonnet-4-5' }, { id: '   ' }, {}]), [
    'gpt-4.1',
    'claude-sonnet-4-5',
  ])

  assert.deepEqual(modelIdsFromProviderModels({ 'gpt-4.1': {}, o3: {} }), ['gpt-4.1', 'o3'])
  assert.deepEqual(modelIdsFromProviderModels(null), [])
})

test('isSelectablePrimaryAgent: rejects hidden/disabled/subagent entries', () => {
  assert.equal(isSelectablePrimaryAgent({ name: 'general' }), true)
  assert.equal(isSelectablePrimaryAgent({ name: 'general', hidden: true }), false)
  assert.equal(isSelectablePrimaryAgent({ name: 'general', disable: true }), false)
  assert.equal(isSelectablePrimaryAgent({ name: 'general', mode: 'subagent' }), false)
  assert.equal(isSelectablePrimaryAgent({ name: '  ' }), false)
})

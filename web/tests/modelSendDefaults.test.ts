import test from 'node:test'
import assert from 'node:assert/strict'

import { deriveSendRunConfig } from '../src/pages/chat/modelSendDefaults'

test('deriveSendRunConfig: prefers explicit selection over defaults', () => {
  const out = deriveSendRunConfig({
    selectedProviderId: 'anthropic',
    selectedModelId: 'claude-sonnet',
    selectedAgent: 'general',
    effectiveDefaults: { provider: 'openai', model: 'gpt-4.1', agent: 'explore' },
  })
  assert.deepEqual(out, { providerID: 'anthropic', modelID: 'claude-sonnet', agent: 'general' })
})

test('deriveSendRunConfig: falls back to effective defaults', () => {
  const out = deriveSendRunConfig({
    selectedProviderId: '',
    selectedModelId: '',
    selectedAgent: '',
    effectiveDefaults: { provider: 'openai', model: 'gpt-4.1', agent: 'general' },
  })
  assert.deepEqual(out, { providerID: 'openai', modelID: 'gpt-4.1', agent: 'general' })
})

test('deriveSendRunConfig: omits model when provider/model incomplete', () => {
  assert.deepEqual(
    deriveSendRunConfig({
      selectedProviderId: 'openai',
      selectedModelId: '',
      effectiveDefaults: null,
    }),
    {},
  )
})

test('deriveSendRunConfig: includes variant when provided', () => {
  const out = deriveSendRunConfig({
    selectedProviderId: 'openai',
    selectedModelId: 'gpt-4.1',
    selectedVariant: 'thinking',
  })
  assert.deepEqual(out, { providerID: 'openai', modelID: 'gpt-4.1', variant: 'thinking' })
})

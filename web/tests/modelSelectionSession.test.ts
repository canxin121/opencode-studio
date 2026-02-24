import test from 'node:test'
import assert from 'node:assert/strict'

import {
  deriveSessionSelectionFromMessages,
  normalizeSessionManualModelStorageEntry,
  readSessionManualModelPair,
  readSessionRunConfigSelection,
  removeSessionManualModelPair,
  writeSessionManualModelPair,
} from '../src/pages/chat/modelSelectionSession'

test('readSessionRunConfigSelection: trims values', () => {
  const out = readSessionRunConfigSelection({
    providerID: ' openai ',
    modelID: ' gpt-4.1 ',
    agent: ' general ',
    variant: ' thinking ',
    at: 1,
  })

  assert.deepEqual(out, {
    provider: 'openai',
    model: 'gpt-4.1',
    agent: 'general',
    variant: 'thinking',
  })
})

test('deriveSessionSelectionFromMessages: prefers latest message values', () => {
  const out = deriveSessionSelectionFromMessages([
    {
      info: {
        agent: 'general',
        providerID: 'anthropic',
        modelID: 'claude-3-7-sonnet',
      },
    },
    {
      info: {
        model: {
          providerID: 'openai',
          modelID: 'gpt-4.1',
        },
        variant: 'thinking',
      },
    },
  ])

  assert.deepEqual(out, {
    provider: 'anthropic',
    model: 'claude-3-7-sonnet',
    agent: 'general',
    variant: 'thinking',
  })
})

test('normalizeSessionManualModelStorageEntry: keeps valid model slugs only', () => {
  assert.deepEqual(normalizeSessionManualModelStorageEntry(' session-1 ', ' openai/gpt-4.1 '), {
    key: 'session-1',
    value: 'openai/gpt-4.1',
  })
  assert.equal(normalizeSessionManualModelStorageEntry('session-1', 'invalid-slug'), null)
  assert.equal(normalizeSessionManualModelStorageEntry('', 'openai/gpt-4.1'), null)
})

test('write/read/remove session manual model pair', () => {
  const initial = { 'session-a': 'openai/gpt-4.1' }

  const updated = writeSessionManualModelPair(initial, 'session-b', 'anthropic', 'claude-sonnet-4-5')
  assert.deepEqual(readSessionManualModelPair(updated, 'session-b'), {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
  })

  const unchanged = writeSessionManualModelPair(updated, 'session-b', 'anthropic', 'claude-sonnet-4-5')
  assert.equal(unchanged, updated)

  const removed = removeSessionManualModelPair(updated, 'session-b')
  assert.deepEqual(readSessionManualModelPair(removed, 'session-b'), { provider: '', model: '' })

  const removeNoop = removeSessionManualModelPair(removed, 'missing')
  assert.equal(removeNoop, removed)
})

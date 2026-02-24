import test from 'node:test'
import assert from 'node:assert/strict'

import { extractConfigDefaults, resolveEffectiveDefaults } from '../src/pages/chat/modelSelectionDefaults'

test('extractConfigDefaults: supports provider/model slug and agent normalization', () => {
  const out = extractConfigDefaults({
    default_agent: '@general',
    model: 'anthropic/claude-sonnet-4-5',
  })

  assert.deepEqual(out, {
    defaultAgent: 'general',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-5',
  })
})

test('resolveEffectiveDefaults: project config wins over user and opencode selection', () => {
  const out = resolveEffectiveDefaults({
    projectConfig: { provider: 'anthropic', model: 'claude-3-7-sonnet', default_agent: 'build' },
    userConfig: { provider: 'openai', model: 'gpt-4.1', default_agent: 'general' },
    opencodeSelection: { provider: 'xai', model: 'grok-4' },
    fallbackAgent: 'explore',
  })

  assert.deepEqual(out, {
    agent: 'build',
    provider: 'anthropic',
    model: 'claude-3-7-sonnet',
  })
})

test('resolveEffectiveDefaults: falls back to user config when project is incomplete', () => {
  const out = resolveEffectiveDefaults({
    projectConfig: { provider: 'anthropic' },
    userConfig: { provider: 'openai', model: 'gpt-4.1', default_agent: 'general' },
    opencodeSelection: { provider: 'xai', model: 'grok-4' },
    fallbackAgent: 'explore',
  })

  assert.deepEqual(out, {
    agent: 'general',
    provider: 'openai',
    model: 'gpt-4.1',
  })
})

test('resolveEffectiveDefaults: falls back to opencode selection after project/user', () => {
  const out = resolveEffectiveDefaults({
    projectConfig: { default_agent: '' },
    userConfig: { default_agent: '' },
    opencodeSelection: { provider: 'xai', model: 'grok-4' },
    fallbackAgent: 'explore',
  })

  assert.deepEqual(out, {
    agent: 'explore',
    provider: 'xai',
    model: 'grok-4',
  })
})

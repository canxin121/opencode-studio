import test from 'node:test'
import assert from 'node:assert/strict'

import { pickEffectiveAgentId } from '../src/components/settings/opencode/agentSelection'

test('pickEffectiveAgentId keeps selected agent when it still exists', () => {
  const id = pickEffectiveAgentId('reviewer', ['reviewer', 'general'], ['general', 'reviewer'])
  assert.equal(id, 'reviewer')
})

test('pickEffectiveAgentId falls back to first filtered agent', () => {
  const id = pickEffectiveAgentId('missing', ['general', 'research'], ['general', 'research'])
  assert.equal(id, 'general')
})

test('pickEffectiveAgentId falls back to first full list agent when filter empty', () => {
  const id = pickEffectiveAgentId(null, [], ['general', 'research'])
  assert.equal(id, 'general')
})

test('pickEffectiveAgentId returns null when no agent exists', () => {
  const id = pickEffectiveAgentId(null, [], [])
  assert.equal(id, null)
})

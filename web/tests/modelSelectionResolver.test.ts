import test from 'node:test'
import assert from 'node:assert/strict'

import {
  firstNonEmpty,
  resolveAgentSelection,
  resolveModelSelection,
  resolveVariantSelection,
} from '../src/pages/chat/modelSelectionResolver'

test('firstNonEmpty: returns first trimmed non-empty value', () => {
  assert.equal(firstNonEmpty('', '   ', null, ' alpha ', 'beta'), 'alpha')
  assert.equal(firstNonEmpty('', '   '), '')
})

test('resolveAgentSelection: session layers beat defaults', () => {
  const out = resolveAgentSelection({
    includeSessionLayers: true,
    runConfigAgent: '',
    derivedAgent: 'session-agent',
    projectDefaultAgent: 'project-agent',
    userDefaultAgent: 'user-agent',
    fallbackAgent: 'fallback-agent',
  })

  assert.deepEqual(out, { value: 'session-agent', source: 'session' })
})

test('resolveAgentSelection: defaults used when session disabled', () => {
  const out = resolveAgentSelection({
    includeSessionLayers: false,
    runConfigAgent: 'session-agent',
    derivedAgent: 'derived-agent',
    projectDefaultAgent: '',
    userDefaultAgent: 'user-agent',
    fallbackAgent: 'fallback-agent',
  })

  assert.deepEqual(out, { value: 'user-agent', source: 'default' })
})

test('resolveModelSelection: can disable session layers', () => {
  const out = resolveModelSelection({
    includeSessionLayers: false,
    sessionManual: { provider: 'manual-p', model: 'manual-m' },
    sessionRunConfig: { provider: 'run-p', model: 'run-m' },
    sessionDerived: { provider: 'derived-p', model: 'derived-m' },
    projectDefault: { provider: 'project-p', model: 'project-m' },
    userDefault: { provider: 'user-p', model: 'user-m' },
    opencodeDefault: { provider: 'oc-p', model: 'oc-m' },
    singletonAvailable: { provider: 'single-p', model: 'single-m' },
  })

  assert.deepEqual(out, { provider: 'project-p', model: 'project-m', source: 'default' })
})

test('resolveVariantSelection: returns empty source when no session variant', () => {
  const out = resolveVariantSelection({
    includeSessionLayers: true,
    runConfigVariant: '',
    derivedVariant: '',
  })

  assert.deepEqual(out, { value: '', source: 'empty' })
})

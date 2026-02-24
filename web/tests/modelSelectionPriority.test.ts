import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveProviderModelSelection } from '../src/pages/chat/modelSelectionPriority'

test('resolveProviderModelSelection: session manual history wins', () => {
  const out = resolveProviderModelSelection({
    sessionManual: { provider: 'manual-p', model: 'manual-m' },
    sessionRunConfig: { provider: 'session-p', model: 'session-m' },
    sessionDerived: { provider: 'derived-p', model: 'derived-m' },
    projectDefault: { provider: 'project-p', model: 'project-m' },
    userDefault: { provider: 'user-p', model: 'user-m' },
    opencodeDefault: { provider: 'oc-p', model: 'oc-m' },
    singletonAvailable: { provider: 'single-p', model: 'single-m' },
  })

  assert.deepEqual(out, { provider: 'manual-p', model: 'manual-m', source: 'session' })
})

test('resolveProviderModelSelection: run config beats derived session history', () => {
  const out = resolveProviderModelSelection({
    sessionRunConfig: { provider: 'session-p', model: 'session-m' },
    sessionDerived: { provider: 'derived-p', model: 'derived-m' },
    projectDefault: { provider: 'project-p', model: 'project-m' },
  })

  assert.deepEqual(out, { provider: 'session-p', model: 'session-m', source: 'session' })
})

test('resolveProviderModelSelection: project config wins over user/opencode defaults', () => {
  const out = resolveProviderModelSelection({
    projectDefault: { provider: 'project-p', model: 'project-m' },
    userDefault: { provider: 'user-p', model: 'user-m' },
    opencodeDefault: { provider: 'oc-p', model: 'oc-m' },
    singletonAvailable: { provider: 'single-p', model: 'single-m' },
  })

  assert.deepEqual(out, { provider: 'project-p', model: 'project-m', source: 'default' })
})

test('resolveProviderModelSelection: user default used when project pair incomplete', () => {
  const out = resolveProviderModelSelection({
    projectDefault: { provider: 'project-only' },
    userDefault: { provider: 'user-p', model: 'user-m' },
    opencodeDefault: { provider: 'oc-p', model: 'oc-m' },
  })

  assert.deepEqual(out, { provider: 'user-p', model: 'user-m', source: 'default' })
})

test('resolveProviderModelSelection: opencode default used before singleton auto fallback', () => {
  const out = resolveProviderModelSelection({
    opencodeDefault: { provider: 'oc-p', model: 'oc-m' },
    singletonAvailable: { provider: 'single-p', model: 'single-m' },
  })

  assert.deepEqual(out, { provider: 'oc-p', model: 'oc-m', source: 'default' })
})

test('resolveProviderModelSelection: singleton fallback used when no other complete pair', () => {
  const out = resolveProviderModelSelection({
    projectDefault: { provider: 'project-only' },
    singletonAvailable: { provider: 'single-p', model: 'single-m' },
  })

  assert.deepEqual(out, { provider: 'single-p', model: 'single-m', source: 'auto' })
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  hasEmbeddedWorkspacePaneSearch,
  isEmbeddedWorkspacePaneContext,
  withEmbeddedWorkspaceScopeQuery,
} from '../src/app/windowScope.ts'

function withWindowSearch(search: string, run: () => void) {
  const scope = globalThis as Record<string, unknown>
  const originalWindow = scope.window

  scope.window = {
    ...(typeof originalWindow === 'object' && originalWindow ? (originalWindow as Record<string, unknown>) : {}),
    location: {
      ...(typeof originalWindow === 'object' && originalWindow && (originalWindow as Record<string, unknown>).location
        ? ((originalWindow as Record<string, unknown>).location as Record<string, unknown>)
        : {}),
      search,
    },
  }

  try {
    run()
  } finally {
    if (typeof originalWindow === 'undefined') {
      delete scope.window
    } else {
      scope.window = originalWindow
    }
  }
}

test('hasEmbeddedWorkspacePaneSearch reads canonical embed marker', () => {
  assert.equal(hasEmbeddedWorkspacePaneSearch('?ocEmbed=1'), true)
  assert.equal(hasEmbeddedWorkspacePaneSearch('?ocEmbed=0'), false)
  assert.equal(hasEmbeddedWorkspacePaneSearch('?foo=bar'), false)
})

test('isEmbeddedWorkspacePaneContext accepts embed query directly', () => {
  assert.equal(isEmbeddedWorkspacePaneContext({ ocEmbed: '1' }), true)
  assert.equal(isEmbeddedWorkspacePaneContext({ ocEmbed: '0' }), false)
})

test('isEmbeddedWorkspacePaneContext falls back to window search', () => {
  withWindowSearch('?windowId=win-1&ocEmbed=1', () => {
    assert.equal(isEmbeddedWorkspacePaneContext({}), true)
  })
})

test('withEmbeddedWorkspaceScopeQuery preserves embed + window scope during transient empty route query', () => {
  withWindowSearch('?windowId=win-42&ocEmbed=1', () => {
    const next = withEmbeddedWorkspaceScopeQuery({ sessionId: 'sess-1' }, {})
    assert.equal(next.ocEmbed, '1')
    assert.equal(next.windowId, 'win-42')
    assert.equal(next.sessionId, 'sess-1')
  })
})

test('withEmbeddedWorkspaceScopeQuery is a no-op outside embed context', () => {
  withWindowSearch('', () => {
    const next = withEmbeddedWorkspaceScopeQuery({ foo: 'bar' }, {})
    assert.deepEqual(next, { foo: 'bar' })
  })
})

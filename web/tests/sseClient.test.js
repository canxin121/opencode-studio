import assert from 'node:assert/strict'
import test from 'node:test'

import { connectSse } from '../src/lib/sse.ts'

function installDomLikeGlobals() {
  if (!globalThis.window) globalThis.window = globalThis
  if (!globalThis.document) {
    globalThis.document = {
      visibilityState: 'visible',
      addEventListener: () => {},
      removeEventListener: () => {},
    }
  }
}

test('connectSse: reports onSequenceGap when id jumps forward', async () => {
  installDomLikeGlobals()
  const originalFetch = globalThis.fetch

  const chunks = [
    'id: 1\n' + 'data: {"type":"noop"}\n\n' +
      'id: 3\n' +
      'data: {"type":"noop"}\n\n',
  ]

  globalThis.fetch = async () => {
    let idx = 0
    return {
      ok: true,
      body: {
        getReader() {
          return {
            async read() {
              if (idx >= chunks.length) return { done: true, value: undefined }
              const value = new TextEncoder().encode(chunks[idx++])
              return { done: false, value }
            },
            releaseLock() {},
          }
        },
      },
    }
  }

  let gap
  let cursor
  const client = connectSse({
    endpoint: '/fake',
    stallTimeoutMsVisible: 50,
    onEvent: () => {},
    onCursor: (id) => {
      cursor = id
    },
    onSequenceGap: (g) => {
      gap = g
    },
  })

  await new Promise((r) => setTimeout(r, 30))
  client.close()
  globalThis.fetch = originalFetch

  assert.deepEqual(gap, { previous: 1, expected: 2, current: 3 })
  assert.equal(cursor, '3')
})

test('connectSse: reports onSequenceGap when first reconnect id resets backward', async () => {
  installDomLikeGlobals()
  const originalFetch = globalThis.fetch

  globalThis.fetch = async () => {
    let sent = false
    return {
      ok: true,
      body: {
        getReader() {
          return {
            async read() {
              if (sent) return { done: true, value: undefined }
              sent = true
              const chunk = 'id: 2\n' + 'data: {"type":"noop"}\n\n'
              return { done: false, value: new TextEncoder().encode(chunk) }
            },
            releaseLock() {},
          }
        },
      },
    }
  }

  let gap
  let cursor
  const client = connectSse({
    endpoint: '/fake',
    initialLastEventId: '10',
    stallTimeoutMsVisible: 50,
    onEvent: () => {},
    onCursor: (id) => {
      cursor = id
    },
    onSequenceGap: (g) => {
      gap = g
    },
  })

  await new Promise((r) => setTimeout(r, 30))
  client.close()
  globalThis.fetch = originalFetch

  assert.deepEqual(gap, { previous: 10, expected: 11, current: 2 })
  assert.equal(cursor, '2')
})

test('connectSse: coalesces message.part.updated deltas within a frame', async () => {
  installDomLikeGlobals()
  const originalFetch = globalThis.fetch

  const payload1 = {
    type: 'message.part.updated',
    properties: {
      part: { sessionID: 's1', messageID: 'm1', id: 'p1' },
      delta: 'Hello ',
    },
  }
  const payload2 = {
    type: 'message.part.updated',
    properties: {
      part: { sessionID: 's1', messageID: 'm1', id: 'p1' },
      delta: 'world',
    },
  }
  const chunk =
    'id: 1\n' + `data: ${JSON.stringify(payload1)}\n\n` + 'id: 2\n' + `data: ${JSON.stringify(payload2)}\n\n`

  globalThis.fetch = async () => {
    let sent = false
    return {
      ok: true,
      body: {
        getReader() {
          return {
            async read() {
              if (sent) return { done: true, value: undefined }
              sent = true
              return { done: false, value: new TextEncoder().encode(chunk) }
            },
            releaseLock() {},
          }
        },
      },
    }
  }

  const received = []
  const client = connectSse({
    endpoint: '/fake',
    stallTimeoutMsVisible: 50,
    onEvent: (evt) => received.push(evt),
  })

  // Coalescing flush is scheduled on a ~16ms timer.
  await new Promise((r) => setTimeout(r, 60))
  client.close()
  globalThis.fetch = originalFetch

  assert.equal(received.length, 1)
  assert.equal(received[0].type, 'message.part.updated')
  assert.equal(received[0].properties.delta, 'Hello world')
})

test('connectSse: aborts stalled reads and increments stallCount', async () => {
  installDomLikeGlobals()
  const originalFetch = globalThis.fetch

  let fetchSignal = null
  globalThis.fetch = async (_url, init) => {
    fetchSignal = init?.signal || null
    return {
      ok: true,
      body: {
        getReader() {
          return {
            read() {
              // Never produces bytes; only abort will resolve.
              return new Promise((_resolve, reject) => {
                if (fetchSignal?.aborted) {
                  reject(new Error('aborted'))
                  return
                }
                fetchSignal?.addEventListener(
                  'abort',
                  () => {
                    reject(new Error('aborted'))
                  },
                  { once: true },
                )
              })
            },
            releaseLock() {},
          }
        },
      },
    }
  }

  let sawError = false
  const client = connectSse({
    endpoint: '/fake',
    stallTimeoutMsVisible: 5,
    onEvent: () => {},
    onError: () => {
      sawError = true
    },
  })

  await new Promise((r) => setTimeout(r, 30))
  const stats = client.getStats()
  client.close()
  globalThis.fetch = originalFetch

  assert.equal(sawError, true)
  assert.ok(stats.stallCount >= 1)
})

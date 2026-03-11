import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('directory session store rejects mismatched locate payloads and sanitizes blank session metadata', () => {
  const storeFile = resolve(import.meta.dir, '../src/stores/directorySessionStore.ts')
  const source = readFileSync(storeFile, 'utf8')

  assert.match(source, /if \(!rawSession \|\| !locatedSessionId \|\| locatedSessionId !== sid\) return null/)
  assert.match(source, /else delete merged\.title/)
  assert.match(source, /else delete merged\.slug/)
  assert.match(source, /delete merged\.directory/)
  assert.match(source, /else delete merged\.cwd/)
})

test('directory session store only accepts targeted list hydration results and shortens retry backoff after misses', () => {
  const storeFile = resolve(import.meta.dir, '../src/stores/directorySessionStore.ts')
  const source = readFileSync(storeFile, 'utf8')

  assert.match(source, /if \(!sid \|\| !candidateIds\.has\(sid\)\) continue/)
  assert.match(source, /Date\.now\(\) - SIDEBAR_SESSION_HYDRATION_RETRY_MS \+ SIDEBAR_RECOVERY_THROTTLE_MS/)
})

test('chat store ignores locate payloads whose embedded session does not match the requested id', () => {
  const chatFile = resolve(import.meta.dir, '../src/stores/chat.ts')
  const source = readFileSync(chatFile, 'utf8')

  assert.match(source, /const canUseLocateResult = !sess \|\| !locatedSessionId \|\| locatedSessionId === sid/)
  assert.match(source, /if \(sess && locatedSessionId === sid\)/)
})

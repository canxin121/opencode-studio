import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('composer stop and send actions both use outline icon buttons', () => {
  const file = resolve(import.meta.dir, '../src/pages/chat/ChatPageView.vue')
  const source = readFileSync(file, 'utf8')

  assert.match(
    source,
    /<IconButton\s+v-if="showComposerStopAction"\s+variant="outline"[\s\S]*?:aria-label="t\('chat\.page\.primary\.stopRun'\)"/,
  )
  assert.match(
    source,
    /<IconButton\s+variant="outline"\s+class="h-8 w-8"[\s\S]*?:aria-label="t\('chat\.page\.primary\.sendMessage'\)"/,
  )
})

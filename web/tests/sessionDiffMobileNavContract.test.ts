import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('session diff panel renders mobile list-detail navigation controls', () => {
  const file = resolve(import.meta.dir, '../src/components/chat/PluginChatOverlayMounts.vue')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes("sessionDiffNavigationView !== 'detail'"))
  assert.ok(source.includes("sessionDiffNavigationView === 'detail'"))
  assert.ok(source.includes('@click.stop="selectDiffFile(entry.file)"'))
  assert.ok(source.includes('@click.stop="backToDiffList"'))
  assert.ok(source.includes("t('chat.sessionDiff.backToList')"))
})

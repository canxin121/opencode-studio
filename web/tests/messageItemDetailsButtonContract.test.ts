import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('message item detail entry uses shared toolbar chip button stack', () => {
  const file = resolve(import.meta.dir, '../src/components/chat/MessageItem.vue')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes("import ToolbarChipButton from '@/components/ui/ToolbarChipButton.vue'"))
  assert.ok(source.includes('<ToolbarChipButton'))
  assert.ok(source.includes(':tooltip="t(\'chat.messageItem.errorDetails\')"'))
  assert.ok(source.includes(':aria-expanded="errorDetailsOpen"'))
  assert.ok(source.includes('<Transition name="toolreveal">'))
  assert.ok(!source.includes('<details'))
  assert.ok(!source.includes('<summary'))
})

test('session error copy-details action uses shared toolbar chip button', () => {
  const file = resolve(import.meta.dir, '../src/components/chat/MessageList.vue')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes("import ToolbarChipButton from '@/components/ui/ToolbarChipButton.vue'"))
  assert.ok(source.includes('chat.sessionError.actions.copyDetails'))
  assert.ok(source.includes('<ToolbarChipButton'))
  assert.ok(source.includes(':tooltip="t(\'chat.sessionError.actions.copyDetails\')"'))
})

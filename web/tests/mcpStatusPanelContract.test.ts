import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('mcp status panel uses icon-only refresh and calls /api/mcp', () => {
  const file = resolve(import.meta.dir, '../src/components/chat/PluginChatOverlayMounts.vue')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes("t('chat.mcpStatus.panelTitle')"))
  assert.ok(source.includes("t('chat.mcpStatus.toggleAria')"))
  assert.ok(source.includes("apiJson<McpStatusResponse>('/api/mcp')"))
  assert.ok(source.includes('normalizeMcpStatus(payload)'))

  assert.ok(source.includes(':title="t(\'common.refresh\')"'))
  assert.ok(source.includes('<RiRefreshLine v-else class="h-4 w-4" />'))
  assert.ok(!source.includes("<span>{{ t('common.refresh') }}</span>"))
})

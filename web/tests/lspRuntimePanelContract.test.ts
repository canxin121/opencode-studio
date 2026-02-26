import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('lsp runtime panel uses grouped rows, adaptive height, and icon-only refresh', () => {
  const file = resolve(import.meta.dir, '../src/components/chat/PluginChatOverlayMounts.vue')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes('const lspRuntimeGroups = computed(() => {'))
  assert.ok(source.includes("t('chat.lspStatus.noRootGroup')"))
  assert.ok(source.includes('v-for="group in lspRuntimeGroups"'))
  assert.ok(
    source.includes('max-h-[min(56dvh,calc(100dvh-var(--oc-safe-area-top,0px)-var(--oc-safe-area-bottom,0px)-9rem))]'),
  )
  assert.ok(!source.includes('min-h-[240px]'))

  assert.ok(source.includes(':title="t(\'common.refresh\')"'))
  assert.ok(source.includes('<RiRefreshLine v-else class="h-4 w-4" />'))
  assert.ok(!source.includes("<span>{{ t('common.refresh') }}</span>"))
})

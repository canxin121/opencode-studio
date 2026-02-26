import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('session diff panel uses compact header close button', () => {
  const file = resolve(import.meta.dir, '../src/components/chat/PluginChatOverlayMounts.vue')
  const source = readFileSync(file, 'utf8')

  assert.ok(source.includes("import IconButton from '@/components/ui/IconButton.vue'"))
  assert.ok(source.includes('<IconButton'))
  assert.ok(source.includes('data-testid="session-diff-close-button"'))
  assert.ok(source.includes('size="sm"'))
  assert.ok(source.includes('class="text-muted-foreground hover:text-foreground"'))
  assert.ok(source.includes('<RiCloseLine class="h-4 w-4" />'))
  assert.ok(source.includes('px-3 py-0.5 border-b border-border/60'))
  assert.ok(source.includes('text-xs font-medium leading-4 text-foreground'))
})

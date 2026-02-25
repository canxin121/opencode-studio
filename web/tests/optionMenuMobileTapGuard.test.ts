import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

test('plugin OptionMenu captures pointer/click and avoids click-through', () => {
  const optionMenuFile = resolve(import.meta.dir, '../src/components/ui/OptionMenu.vue')
  const optionMenuSource = readFileSync(optionMenuFile, 'utf8')
  const overlayFile = resolve(import.meta.dir, '../src/components/chat/PluginChatOverlayMounts.vue')
  const overlaySource = readFileSync(overlayFile, 'utf8')

  assert.ok(optionMenuSource.includes('data-oc-keyboard-tap="keep"'))
  assert.ok(optionMenuSource.includes('pointer-events-auto fixed'))
  assert.ok(optionMenuSource.includes('@pointerdown.stop'))
  assert.ok(optionMenuSource.includes('@click.stop'))
  assert.match(optionMenuSource, /<Teleport to="body">[\s\S]*v-if="open && isMobileSheet"/)

  assert.ok(overlaySource.includes('desktop-class="pointer-events-auto w-[min(420px,calc(100%-1rem))]"'))
  assert.ok(overlaySource.includes('@pointerdown.prevent.stop'))
  assert.ok(overlaySource.includes('@click.stop="toggleMenu"'))
})

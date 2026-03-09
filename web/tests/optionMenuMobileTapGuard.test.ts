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
  assert.ok(optionMenuSource.includes('const viewportTop = resolveViewportTop()'))
  assert.ok(
    optionMenuSource.includes('const bottomEdge = viewportTop + viewportHeight - safeBottom - MOBILE_SHEET_MARGIN_PX'),
  )
  assert.ok(optionMenuSource.includes('const maxHeight = Math.max(0, bottomEdge - topInset)'))
  assert.ok(optionMenuSource.includes('const centeredTop = topInset + centeredOffset'))
  assert.ok(optionMenuSource.includes('const maxTop = Math.max(topInset, bottomEdge - panelHeight)'))
  assert.ok(optionMenuSource.includes('const top = Math.min(maxTop, Math.max(topInset, centeredTop))'))
  assert.ok(optionMenuSource.includes('class="flex-1 min-h-0 overflow-auto px-2 py-1.5"'))
  assert.ok(!optionMenuSource.includes('--oc-bottom-nav-height'))

  assert.ok(overlaySource.includes('desktop-class="pointer-events-auto w-[min(420px,calc(100%-1rem))]"'))
  assert.ok(overlaySource.includes('@pointerdown.prevent.stop'))
  assert.ok(overlaySource.includes('@click.stop="toggleMenu"'))
})

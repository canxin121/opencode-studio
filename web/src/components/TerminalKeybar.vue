<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

const props = defineProps<{
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'send', data: string): void
  (e: 'mods', mods: { ctrl: boolean; alt: boolean; shift: boolean }): void
}>()

const ctrl = ref(false)
const alt = ref(false)
const shift = ref(false)

function emitMods() {
  emit('mods', { ctrl: ctrl.value, alt: alt.value, shift: shift.value })
}

function toggleCtrl() {
  ctrl.value = !ctrl.value
  emitMods()
}
function toggleAlt() {
  alt.value = !alt.value
  emitMods()
}
function toggleShift() {
  shift.value = !shift.value
  emitMods()
}

onMounted(() => emitMods())

const modCode = computed(() => {
  // xterm-style modifier encoding: 1 + Shift(1) + Alt(2) + Ctrl(4)
  let m = 1
  if (shift.value) m += 1
  if (alt.value) m += 2
  if (ctrl.value) m += 4
  return m
})

function send(raw: string) {
  if (props.disabled) return
  if (!raw) return
  // Convert common escape-ish literals into actual control characters.
  // This makes it safe to call `send('\\x1b')` etc from any caller.
  const cooked = raw.replace(/\\x1b/g, '\x1b').replace(/\\r/g, '\r').replace(/\\n/g, '\n').replace(/\\t/g, '\t')
  emit('send', cooked)
}

function sendArrow(code: 'A' | 'B' | 'C' | 'D') {
  const m = modCode.value
  if (m === 1) send(`\x1b[${code}`)
  else send(`\x1b[1;${m}${code}`)
}

function sendHomeEnd(kind: 'home' | 'end') {
  const m = modCode.value
  const code = kind === 'home' ? 'H' : 'F'
  if (m === 1) send(`\x1b[${code}`)
  else send(`\x1b[1;${m}${code}`)
}

function sendTildeKey(n: number) {
  const m = modCode.value
  if (m === 1) send(`\x1b[${n}~`)
  else send(`\x1b[${n};${m}~`)
}

function sendTab() {
  // Shift+Tab is commonly encoded as CSI Z.
  if (shift.value && !ctrl.value && !alt.value) {
    send('\\x1b[Z')
    return
  }
  send('\\t')
}

function sendBackspace() {
  // DEL (0x7f) is the most common terminal backspace.
  let out = '\x7f'
  if (alt.value) out = `\x1b${out}`
  send(out)
}

function sendEsc() {
  send('\\x1b')
}

function sendEnter() {
  send('\\r')
}

const KEY_CLASSES = 'oc-terminal-keybar__key select-none font-mono text-[12px] leading-none px-2 py-2 whitespace-nowrap'
</script>

<template>
  <div class="oc-terminal-keybar" data-oc-keyboard-tap="keep" :data-disabled="props.disabled ? '1' : '0'">
    <div class="oc-terminal-keybar__scroller">
      <button
        type="button"
        :class="KEY_CLASSES"
        :data-active="ctrl ? '1' : '0'"
        :disabled="props.disabled"
        :aria-pressed="ctrl ? 'true' : 'false'"
        @click="toggleCtrl"
        aria-label="Ctrl"
        title="Ctrl (toggle)"
      >
        Ctrl
      </button>
      <button
        type="button"
        :class="KEY_CLASSES"
        :data-active="alt ? '1' : '0'"
        :disabled="props.disabled"
        :aria-pressed="alt ? 'true' : 'false'"
        @click="toggleAlt"
        aria-label="Alt"
        title="Alt (toggle)"
      >
        Alt
      </button>
      <button
        type="button"
        :class="KEY_CLASSES"
        :data-active="shift ? '1' : '0'"
        :disabled="props.disabled"
        :aria-pressed="shift ? 'true' : 'false'"
        @click="toggleShift"
        aria-label="Shift"
        title="Shift (toggle)"
      >
        Shift
      </button>

      <span class="oc-terminal-keybar__sep" aria-hidden="true" />

      <button type="button" :class="KEY_CLASSES" :disabled="props.disabled" @click="sendEsc">Esc</button>
      <button type="button" :class="KEY_CLASSES" :disabled="props.disabled" @click="sendTab">Tab</button>
      <button type="button" :class="KEY_CLASSES" :disabled="props.disabled" @click="sendBackspace">Bksp</button>
      <button type="button" :class="KEY_CLASSES" :disabled="props.disabled" @click="sendEnter">Enter</button>

      <span class="oc-terminal-keybar__sep" aria-hidden="true" />

      <button type="button" :class="KEY_CLASSES" :disabled="props.disabled" @click="sendArrow('D')">Left</button>
      <button type="button" :class="KEY_CLASSES" :disabled="props.disabled" @click="sendArrow('B')">Down</button>
      <button type="button" :class="KEY_CLASSES" :disabled="props.disabled" @click="sendArrow('A')">Up</button>
      <button type="button" :class="KEY_CLASSES" :disabled="props.disabled" @click="sendArrow('C')">Right</button>
      <button type="button" :class="KEY_CLASSES" :disabled="props.disabled" @click="sendHomeEnd('home')">Home</button>
      <button type="button" :class="KEY_CLASSES" :disabled="props.disabled" @click="sendHomeEnd('end')">End</button>
      <button type="button" :class="KEY_CLASSES" :disabled="props.disabled" @click="sendTildeKey(5)">PgUp</button>
      <button type="button" :class="KEY_CLASSES" :disabled="props.disabled" @click="sendTildeKey(6)">PgDn</button>
    </div>
  </div>
</template>

<style scoped>
.oc-terminal-keybar {
  position: relative;
  padding: 10px 8px calc(18px + var(--oc-safe-area-bottom-visual, 0px));
  /* A subtle fade at the bottom to keep keys legible on the terminal background. */
  background: linear-gradient(to top, rgba(16, 20, 21, 0.92) 0%, rgba(16, 20, 21, 0.5) 40%, rgba(16, 20, 21, 0) 100%);
}

.oc-terminal-keybar__scroller {
  display: flex;
  align-items: center;
  gap: 14px;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-x;
  overscroll-behavior-x: contain;
  padding: 8px 10px;
}

.oc-terminal-keybar__sep {
  width: 1px;
  height: 18px;
  flex: 0 0 auto;
  background: rgba(233, 239, 231, 0.12);
}

.oc-terminal-keybar__key {
  flex: 0 0 auto;
  border: 0;
  background: transparent;
  color: rgba(233, 239, 231, 0.82);
  letter-spacing: 0.01em;
  -webkit-tap-highlight-color: transparent;
}

.oc-terminal-keybar__key:disabled {
  opacity: 0.4;
}

.oc-terminal-keybar__key:active {
  color: rgba(233, 239, 231, 1);
}

/* Modifier indication without boxing the key. */
.oc-terminal-keybar__key[data-active='1'] {
  color: rgba(255, 200, 130, 0.95);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 5px;
}

/* Hide scrollbars on mobile without removing scrollability. */
.oc-terminal-keybar__scroller::-webkit-scrollbar {
  height: 0;
}
</style>

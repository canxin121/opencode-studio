<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  modelValue: number
  minWidth?: number
  maxWidth?: number
  disabled?: boolean
  showRightPane?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void
  (e: 'dragStart'): void
  (e: 'dragEnd'): void
  (e: 'dblclick'): void
}>()

const isDragging = ref(false)
const startX = ref(0)
const startWidth = ref(0)
const previewWidth = ref(0)
const pointerTarget = ref<HTMLElement | null>(null)
const pointerId = ref<number | null>(null)
const showRightPane = computed(() => props.showRightPane !== false)
const effectiveRightWidth = computed(() => (showRightPane.value ? previewWidth.value : 0))

watch(
  () => props.modelValue,
  (value) => {
    if (isDragging.value) return
    previewWidth.value = value
  },
  { immediate: true },
)

watch(
  () => props.showRightPane,
  (value) => {
    if (value !== false || !isDragging.value) return
    isDragging.value = false
    emit('dragEnd')
    cleanupPointerState()
  },
)

function clampWidth(raw: number): number {
  let out = raw
  if (props.minWidth !== undefined) {
    out = Math.max(props.minWidth, out)
  }
  if (props.maxWidth !== undefined) {
    out = Math.min(props.maxWidth, out)
  }
  return out
}

function cleanupPointerState() {
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', handlePointerUp)
  window.removeEventListener('pointercancel', handlePointerUp)

  document.body.style.cursor = ''
  document.body.style.userSelect = ''

  const target = pointerTarget.value
  const id = pointerId.value
  if (target && id !== null) {
    try {
      if (target.hasPointerCapture(id)) {
        target.releasePointerCapture(id)
      }
    } catch {
      // ignore
    }
  }

  pointerTarget.value = null
  pointerId.value = null
}

function handlePointerDown(e: PointerEvent) {
  if (props.disabled) return
  if (e.button !== 0) return

  const target = e.currentTarget as HTMLElement | null
  if (!target) return
  target.setPointerCapture(e.pointerId)
  pointerTarget.value = target
  pointerId.value = e.pointerId

  isDragging.value = true
  startX.value = e.clientX
  startWidth.value = props.modelValue
  previewWidth.value = props.modelValue

  emit('dragStart')

  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', handlePointerUp)
  window.addEventListener('pointercancel', handlePointerUp)

  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function handlePointerMove(e: PointerEvent) {
  if (!isDragging.value) return
  e.preventDefault()

  const deltaX = startX.value - e.clientX
  previewWidth.value = clampWidth(startWidth.value + deltaX)
}

function handlePointerUp() {
  if (!isDragging.value) return

  const next = clampWidth(previewWidth.value)
  isDragging.value = false
  emit('update:modelValue', next)
  emit('dragEnd')

  cleanupPointerState()
}

onBeforeUnmount(() => {
  if (!isDragging.value) return
  cleanupPointerState()
})
</script>

<template>
  <div class="flex h-full min-w-0 overflow-hidden">
    <div class="min-w-0 flex-1 overflow-hidden">
      <slot name="left" />
    </div>

    <div
      v-show="showRightPane"
      class="group relative z-20 -mx-1.5 flex h-full w-3 cursor-col-resize items-center justify-center select-none touch-none"
      :class="{ 'pointer-events-none opacity-50': disabled }"
      @pointerdown="handlePointerDown"
      @dblclick="$emit('dblclick')"
    >
      <div class="h-full w-px bg-border/40 transition-colors group-hover:bg-primary/50" />
    </div>

    <div
      class="relative shrink-0 overflow-hidden"
      :aria-hidden="!showRightPane"
      :class="[showRightPane ? '' : 'pointer-events-none', { 'transition-[width] duration-200 ease-out': !isDragging }]"
      :style="{ width: `${effectiveRightWidth}px` }"
    >
      <slot name="right" />
    </div>
  </div>
</template>

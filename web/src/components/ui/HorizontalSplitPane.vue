<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

const props = defineProps<{
  modelValue: number
  minWidth?: number
  maxWidth?: number
  disabled?: boolean
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

function handlePointerDown(e: PointerEvent) {
  if (props.disabled) return
  if (e.button !== 0) return

  const target = e.currentTarget as HTMLElement
  target.setPointerCapture(e.pointerId)

  isDragging.value = true
  startX.value = e.clientX
  startWidth.value = props.modelValue

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
  let newWidth = startWidth.value + deltaX

  if (props.minWidth !== undefined) {
    newWidth = Math.max(props.minWidth, newWidth)
  }
  if (props.maxWidth !== undefined) {
    newWidth = Math.min(props.maxWidth, newWidth)
  }

  emit('update:modelValue', newWidth)
}

function handlePointerUp(e: PointerEvent) {
  if (!isDragging.value) return

  isDragging.value = false
  emit('dragEnd')

  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', handlePointerUp)
  window.removeEventListener('pointercancel', handlePointerUp)

  document.body.style.cursor = ''
  document.body.style.userSelect = ''

  try {
    const target = e.target as HTMLElement
    if (target && target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId)
    }
  } catch {
    // ignore
  }
}

onBeforeUnmount(() => {
  if (!isDragging.value) return
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', handlePointerUp)
  window.removeEventListener('pointercancel', handlePointerUp)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
})
</script>

<template>
  <div class="flex h-full min-w-0 overflow-hidden">
    <div class="min-w-0 flex-1 overflow-hidden">
      <slot name="left" />
    </div>

    <div
      class="group relative z-20 -mx-1.5 flex h-full w-3 cursor-col-resize items-center justify-center select-none touch-none"
      :class="{ 'pointer-events-none opacity-50': disabled }"
      @pointerdown="handlePointerDown"
      @dblclick="$emit('dblclick')"
    >
      <div class="h-full w-px bg-border/40 transition-colors group-hover:bg-primary/50" />
    </div>

    <div
      class="relative shrink-0 overflow-hidden"
      :class="{ 'transition-[width] duration-200 ease-out': !isDragging }"
      :style="{ width: `${modelValue}px` }"
    >
      <slot name="right" />
    </div>
  </div>
</template>

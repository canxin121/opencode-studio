<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    paneIds: string[]
    ratios?: number[]
    minPaneWidth?: number
    disabled?: boolean
  }>(),
  {
    ratios: () => [],
    minPaneWidth: 220,
    disabled: false,
  },
)

const emit = defineEmits<{
  (e: 'update:ratios', value: number[]): void
  (e: 'dragStart'): void
  (e: 'dragEnd'): void
}>()

const hostRef = ref<HTMLElement | null>(null)
const isDragging = ref(false)
const activeHandleIndex = ref(-1)
const startX = ref(0)
const startRatios = ref<number[]>([])
const localRatios = ref<number[]>([])
const pointerTarget = ref<HTMLElement | null>(null)
const pointerId = ref<number | null>(null)

function normalizeRatios(paneIds: string[], rawRatios: readonly number[] | null | undefined): number[] {
  const ids = Array.isArray(paneIds) ? paneIds : []
  if (!ids.length) return []

  const ratios = Array.isArray(rawRatios) ? rawRatios : []
  const weighted = ids.map((_, idx) => {
    const value = Number(ratios[idx])
    return Number.isFinite(value) && value > 0 ? value : 1
  })

  const total = weighted.reduce((sum, value) => sum + value, 0)
  if (!(total > 0)) {
    return ids.map(() => 1 / ids.length)
  }

  return weighted.map((value) => value / total)
}

const displayRatios = computed(() => {
  if (localRatios.value.length === props.paneIds.length) {
    return normalizeRatios(props.paneIds, localRatios.value)
  }
  return normalizeRatios(props.paneIds, props.ratios)
})

watch(
  () => [props.paneIds, props.ratios] as const,
  () => {
    if (isDragging.value) return
    localRatios.value = normalizeRatios(props.paneIds, props.ratios)
  },
  { deep: true, immediate: true },
)

function cleanupDraggingState() {
  isDragging.value = false
  activeHandleIndex.value = -1
  startX.value = 0
  startRatios.value = []

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

function handlePointerDown(event: PointerEvent, handleIndex: number) {
  if (props.disabled) return
  if (event.button !== 0) return
  if (handleIndex < 0 || handleIndex >= props.paneIds.length - 1) return

  const target = event.currentTarget as HTMLElement | null
  if (!target) return

  target.setPointerCapture(event.pointerId)
  pointerTarget.value = target
  pointerId.value = event.pointerId

  isDragging.value = true
  activeHandleIndex.value = handleIndex
  startX.value = event.clientX
  startRatios.value = displayRatios.value.slice()

  emit('dragStart')

  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', handlePointerUp)
  window.addEventListener('pointercancel', handlePointerUp)

  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function handlePointerMove(event: PointerEvent) {
  if (!isDragging.value) return
  const host = hostRef.value
  if (!host) return

  const ratios = startRatios.value
  const splitIndex = activeHandleIndex.value
  if (!ratios.length || splitIndex < 0 || splitIndex >= ratios.length - 1) return

  const hostWidth = host.getBoundingClientRect().width
  if (!(hostWidth > 0)) return

  event.preventDefault()

  const startLeft = ratios[splitIndex]
  const startRight = ratios[splitIndex + 1]
  const pairTotal = startLeft + startRight
  if (!(pairTotal > 0)) return

  const minRatioFromPx = Math.max(0, props.minPaneWidth / hostWidth)
  const minRatio = Math.min(minRatioFromPx, pairTotal / 2)

  const deltaRatio = (event.clientX - startX.value) / hostWidth
  const next = [...ratios]

  let nextLeft = startLeft + deltaRatio
  nextLeft = Math.max(minRatio, Math.min(pairTotal - minRatio, nextLeft))
  const nextRight = pairTotal - nextLeft

  next[splitIndex] = nextLeft
  next[splitIndex + 1] = nextRight

  const normalized = normalizeRatios(props.paneIds, next)
  localRatios.value = normalized
}

function handlePointerUp() {
  if (!isDragging.value) return

  const nextRatios = normalizeRatios(
    props.paneIds,
    localRatios.value.length === props.paneIds.length ? localRatios.value : startRatios.value,
  )

  cleanupDraggingState()
  emit('update:ratios', nextRatios)
  emit('dragEnd')
}

onBeforeUnmount(() => {
  cleanupDraggingState()
})
</script>

<template>
  <div ref="hostRef" class="flex h-full min-w-0 overflow-hidden">
    <template v-for="(paneId, index) in paneIds" :key="paneId">
      <div
        class="h-full min-w-0 shrink-0 overflow-hidden"
        :style="{ width: `${Math.max(0, Math.min(1, displayRatios[index] || 0)) * 100}%` }"
      >
        <slot name="pane" :paneId="paneId" :index="index" />
      </div>

      <div
        v-if="index < paneIds.length - 1"
        class="group relative z-20 -mx-1.5 flex h-full w-3 cursor-col-resize items-center justify-center select-none touch-none"
        :class="{ 'pointer-events-none opacity-50': disabled }"
        @pointerdown="handlePointerDown($event, index)"
      >
        <div class="h-full w-px bg-border/40 transition-colors group-hover:bg-primary/50" />
      </div>
    </template>
  </div>
</template>

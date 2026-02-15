<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { JsonValue as DynamicValue } from '@/types/json'

type Key = string | number

const props = defineProps<{
  items: DynamicValue[]
  getKey?: (item: DynamicValue, index: number) => Key
  getHeight?: (item: DynamicValue, index: number) => number
  overscan?: number
  class?: string
}>()

const el = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(0)

const overscan = computed(() => {
  const n = props.overscan ?? 8
  return Number.isFinite(n) && n >= 0 ? n : 8
})

function onScroll() {
  if (!el.value) return
  scrollTop.value = el.value.scrollTop
}

function measure() {
  if (!el.value) return
  viewportHeight.value = el.value.clientHeight
}

let ro: ResizeObserver | null = null
onMounted(() => {
  measure()
  ro = new ResizeObserver(() => measure())
  if (el.value) ro.observe(el.value)
})

onBeforeUnmount(() => {
  if (ro && el.value) ro.unobserve(el.value)
  ro = null
})

watch(
  () => props.items,
  () => {
    // When items change, keep scroll state but recompute measurements.
    measure()
  },
  { deep: false },
)

const heights = computed<number[]>(() => {
  const fn = props.getHeight
  const out: number[] = new Array(props.items.length)
  for (let i = 0; i < props.items.length; i += 1) {
    const h = fn ? fn(props.items[i], i) : 32
    out[i] = Number.isFinite(h) && h > 0 ? h : 32
  }
  return out
})

const offsets = computed<number[]>(() => {
  // offsets[i] = top offset for item i
  const out: number[] = new Array(props.items.length + 1)
  out[0] = 0
  for (let i = 0; i < props.items.length; i += 1) {
    out[i + 1] = out[i]! + heights.value[i]!
  }
  return out
})

const totalHeight = computed(() => offsets.value[offsets.value.length - 1] || 0)

function lowerBound(arr: number[], value: number): number {
  // First index i where arr[i] >= value
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((arr[mid] || 0) < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

const startIndex = computed(() => {
  const top = Math.max(0, scrollTop.value)
  const i = Math.max(0, lowerBound(offsets.value, top) - 1)
  return Math.max(0, i - overscan.value)
})

const endIndex = computed(() => {
  const bottom = Math.max(0, scrollTop.value + viewportHeight.value)
  const i = Math.min(props.items.length, lowerBound(offsets.value, bottom) + overscan.value)
  return Math.max(startIndex.value, i)
})

const visible = computed(() => {
  const items = props.items
  const s = startIndex.value
  const e = endIndex.value
  const out: Array<{ item: DynamicValue; index: number; key: Key }> = []
  for (let i = s; i < e; i += 1) {
    const item = items[i]
    const key = props.getKey ? props.getKey(item, i) : i
    out.push({ item, index: i, key })
  }
  return out
})

const paddingTop = computed(() => offsets.value[startIndex.value] || 0)

defineExpose({
  scrollToTop: () => {
    if (!el.value) return
    el.value.scrollTop = 0
    scrollTop.value = 0
  },
})
</script>

<template>
  <div ref="el" :class="['relative overflow-auto', props.class]" @scroll="onScroll">
    <div class="relative w-full" :style="{ height: totalHeight + 'px' }">
      <div class="absolute left-0 right-0" :style="{ top: paddingTop + 'px' }">
        <template v-for="row in visible" :key="row.key">
          <slot :item="row.item" :index="row.index" />
        </template>
      </div>
    </div>
  </div>
</template>

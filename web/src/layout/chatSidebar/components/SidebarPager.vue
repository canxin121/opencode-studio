<script setup lang="ts">
import { computed } from 'vue'
import { RiArrowLeftSLine, RiArrowRightSLine } from '@remixicon/vue'

import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    page: number
    pageCount: number
    size?: 'sm' | 'md'
    disabled?: boolean
    prevLabel?: string
    nextLabel?: string
  }>(),
  {
    size: 'sm',
    prevLabel: 'Previous page',
    nextLabel: 'Next page',
  },
)

const emit = defineEmits<{
  (e: 'update:page', v: number): void
}>()

const normalizedPageCount = computed(() => Math.max(1, Math.floor(props.pageCount || 1)))
const maxPage = computed(() => Math.max(0, normalizedPageCount.value - 1))
const normalizedPage = computed(() => Math.max(0, Math.min(maxPage.value, Math.floor(props.page || 0))))

const canPrev = computed(() => normalizedPage.value > 0)
const canNext = computed(() => normalizedPage.value < maxPage.value)

const buttonClass = computed(() =>
  props.size === 'md'
    ? 'h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:dark:bg-accent/40 hover:bg-primary/6 disabled:opacity-40 disabled:pointer-events-none active:scale-95 transition'
    : 'h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:dark:bg-accent/40 hover:bg-primary/6 disabled:opacity-40 disabled:pointer-events-none active:scale-95 transition',
)

const valueClass = computed(() =>
  props.size === 'md'
    ? 'text-[11px] font-mono text-muted-foreground/60'
    : 'text-[10px] font-mono text-muted-foreground/60',
)

function setPage(next: number) {
  const clamped = Math.max(0, Math.min(maxPage.value, Math.floor(next || 0)))
  if (clamped === normalizedPage.value) return
  emit('update:page', clamped)
}

function prevPage() {
  if (props.disabled) return
  if (!canPrev.value) return
  setPage(normalizedPage.value - 1)
}

function nextPage() {
  if (props.disabled) return
  if (!canNext.value) return
  setPage(normalizedPage.value + 1)
}
</script>

<template>
  <div class="inline-flex items-center gap-1">
    <button
      type="button"
      :class="buttonClass"
      :disabled="props.disabled || !canPrev"
      :aria-label="prevLabel"
      :title="prevLabel"
      @click.stop="prevPage"
    >
      <RiArrowLeftSLine class="h-4 w-4" />
    </button>

    <span :class="cn(valueClass)">{{ normalizedPage + 1 }}/{{ normalizedPageCount }}</span>

    <button
      type="button"
      :class="buttonClass"
      :disabled="props.disabled || !canNext"
      :aria-label="nextLabel"
      :title="nextLabel"
      @click.stop="nextPage"
    >
      <RiArrowRightSLine class="h-4 w-4" />
    </button>
  </div>
</template>

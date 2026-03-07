<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RiArrowLeftSLine, RiArrowRightSLine } from '@remixicon/vue'

import Input from '@/components/ui/Input.vue'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    page: number
    totalPages: number
    disabled?: boolean
    size?: 'sm' | 'md'
    prevLabel?: string
    nextLabel?: string
    pageInputLabel?: string
    class?: string
  }>(),
  {
    disabled: false,
    size: 'sm',
    prevLabel: 'Previous page',
    nextLabel: 'Next page',
    pageInputLabel: 'Current page',
    class: '',
  },
)

const emit = defineEmits<{
  (e: 'update:page', value: number): void
}>()

const normalizedTotalPages = computed(() => Math.max(1, Math.floor(Number(props.totalPages) || 1)))
const normalizedPage = computed(() => {
  const page = Math.floor(Number(props.page) || 1)
  return Math.max(1, Math.min(normalizedTotalPages.value, page))
})

const canGoPrev = computed(() => !props.disabled && normalizedPage.value > 1)
const canGoNext = computed(() => !props.disabled && normalizedPage.value < normalizedTotalPages.value)

const rootClass = computed(() =>
  cn(
    'inline-flex items-center gap-1.5 text-muted-foreground',
    props.size === 'md' ? 'text-[11px]' : 'text-[10px]',
    props.class,
  ),
)
const buttonClass = computed(() =>
  props.size === 'md'
    ? 'h-8 w-8 inline-flex items-center justify-center rounded-md border border-sidebar-border/70 bg-sidebar-accent/20 hover:bg-sidebar-accent/40 hover:text-foreground disabled:opacity-40 disabled:pointer-events-none transition'
    : 'h-6 w-6 inline-flex items-center justify-center rounded-md border border-sidebar-border/70 bg-sidebar-accent/20 hover:bg-sidebar-accent/40 hover:text-foreground disabled:opacity-40 disabled:pointer-events-none transition',
)
const inputClass = computed(() =>
  props.size === 'md'
    ? 'h-7 w-11 px-2 py-0 text-center text-[11px] tabular-nums'
    : 'h-6 w-10 px-1.5 py-0 text-center text-[10px] tabular-nums',
)
const totalClass = computed(() => (props.size === 'md' ? 'text-[11px] tabular-nums' : 'text-[10px] tabular-nums'))

const pageInput = ref(String(normalizedPage.value))

watch(
  () => normalizedPage.value,
  (value) => {
    pageInput.value = String(value)
  },
  { immediate: true },
)

function emitPage(nextPage: number) {
  const clamped = Math.max(1, Math.min(normalizedTotalPages.value, Math.floor(nextPage || 1)))
  if (clamped === normalizedPage.value) return
  emit('update:page', clamped)
}

function goToPrevPage() {
  if (!canGoPrev.value) return
  emitPage(normalizedPage.value - 1)
}

function goToNextPage() {
  if (!canGoNext.value) return
  emitPage(normalizedPage.value + 1)
}

function jumpToPage() {
  const nextPage = Math.floor(Number(pageInput.value) || normalizedPage.value)
  emitPage(nextPage)
  pageInput.value = String(Math.max(1, Math.min(normalizedTotalPages.value, nextPage)))
}

function resetPageInput() {
  pageInput.value = String(normalizedPage.value)
}
</script>

<template>
  <div :class="rootClass">
    <button
      type="button"
      :class="buttonClass"
      :disabled="!canGoPrev"
      :aria-label="prevLabel"
      :title="prevLabel"
      @click.stop="goToPrevPage"
    >
      <RiArrowLeftSLine class="h-4 w-4" />
    </button>

    <div class="inline-flex items-center gap-1">
      <Input
        v-model="pageInput"
        type="text"
        inputmode="numeric"
        pattern="[0-9]*"
        :class="inputClass"
        :aria-label="pageInputLabel"
        @keydown.enter.prevent="jumpToPage"
        @blur="resetPageInput"
      />
      <span class="text-muted-foreground/70">/</span>
      <span :class="totalClass">{{ normalizedTotalPages }}</span>
    </div>

    <button
      type="button"
      :class="buttonClass"
      :disabled="!canGoNext"
      :aria-label="nextLabel"
      :title="nextLabel"
      @click.stop="goToNextPage"
    >
      <RiArrowRightSLine class="h-4 w-4" />
    </button>
  </div>
</template>

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
const pageDigits = computed(() => String(normalizedTotalPages.value).length)

const rootClass = computed(() =>
  cn(
    'inline-flex items-center gap-1.5 text-muted-foreground',
    props.size === 'md' ? 'text-[11px]' : 'text-[10px]',
    props.class,
  ),
)
const buttonClass = computed(() =>
  props.size === 'md'
    ? 'h-7 w-7 inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-sidebar-accent/45 hover:text-foreground disabled:opacity-35 disabled:pointer-events-none transition-colors'
    : 'h-6 w-6 inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-sidebar-accent/45 hover:text-foreground disabled:opacity-35 disabled:pointer-events-none transition-colors',
)
const inputClass = computed(() =>
  props.size === 'md'
    ? 'h-6 px-1 py-0 text-center text-[11px] tabular-nums !rounded-none !border-0 !border-b border-sidebar-border/55 !bg-transparent !shadow-none focus-visible:!ring-0 focus-visible:!border-foreground/70'
    : 'h-5 px-1 py-0 text-center text-[10px] tabular-nums !rounded-none !border-0 !border-b border-sidebar-border/55 !bg-transparent !shadow-none focus-visible:!ring-0 focus-visible:!border-foreground/70',
)
const totalClass = computed(() => (props.size === 'md' ? 'text-[11px] tabular-nums' : 'text-[10px] tabular-nums'))
const inputStyle = computed(() => ({
  width: `calc(${pageDigits.value}ch + ${props.size === 'md' ? '0.7rem' : '0.55rem'})`,
}))

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
        :style="inputStyle"
        :maxlength="pageDigits"
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

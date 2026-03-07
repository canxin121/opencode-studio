<script setup lang="ts">
import { computed } from 'vue'

import PaginationControls from '@/components/ui/PaginationControls.vue'

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

function setPage(next: number) {
  const clamped = Math.max(0, Math.min(maxPage.value, Math.floor(next || 0)))
  if (clamped === normalizedPage.value) return
  emit('update:page', clamped)
}
</script>

<template>
  <PaginationControls
    :page="normalizedPage + 1"
    :total-pages="normalizedPageCount"
    :disabled="props.disabled"
    :size="props.size"
    :prev-label="prevLabel"
    :next-label="nextLabel"
    @update:page="(next) => setPage(next - 1)"
  />
</template>

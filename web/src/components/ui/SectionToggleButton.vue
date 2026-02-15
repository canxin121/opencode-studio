<script setup lang="ts">
import { type HTMLAttributes, computed } from 'vue'
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/vue'

import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  label: string
  count?: string | number | null
  class?: HTMLAttributes['class']
  showActions?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  count: null,
  showActions: true,
})

const emit = defineEmits<{
  (e: 'toggle'): void
}>()

const hasCount = computed(() => props.count !== null && props.count !== undefined)
</script>

<template>
  <button type="button" :class="cn('oc-vscode-section-head group', props.class)" @click="emit('toggle')">
    <component :is="open ? RiArrowDownSLine : RiArrowRightSLine" class="h-3.5 w-3.5" />
    <span class="oc-vscode-section-label">{{ label }}</span>
    <span v-if="hasCount" class="oc-vscode-count-badge">{{ count }}</span>
    <span v-if="showActions && $slots.actions" class="oc-vscode-row-actions !pointer-events-auto !opacity-100">
      <slot name="actions" />
    </span>
  </button>
</template>

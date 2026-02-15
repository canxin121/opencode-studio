<script setup lang="ts">
import { type HTMLAttributes, computed } from 'vue'

import { cn } from '@/lib/utils'

type SegmentedButtonSize = 'sm' | 'xs'

interface Props {
  active?: boolean
  size?: SegmentedButtonSize
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  active: false,
  size: 'xs',
})

const sizeClass = computed(() =>
  props.size === 'sm'
    ? 'h-7 rounded-sm px-2.5 text-xs font-medium transition'
    : 'h-6 rounded-[5px] px-2 text-[11px] font-medium transition',
)

const stateClass = computed(() =>
  props.active ? 'bg-sidebar-accent/80 text-foreground' : 'text-muted-foreground hover:text-foreground',
)
</script>

<template>
  <button type="button" role="tab" :aria-selected="active" :class="cn(sizeClass, stateClass, props.class)">
    <slot />
  </button>
</template>

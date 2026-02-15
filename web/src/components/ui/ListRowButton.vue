<script setup lang="ts">
import { type HTMLAttributes, computed } from 'vue'

import { cn } from '@/lib/utils'

type ListRowSize = 'md' | 'sm'

interface Props {
  active?: boolean
  destructive?: boolean
  size?: ListRowSize
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  active: false,
  destructive: false,
  size: 'sm',
})

const sizeClass = computed(() =>
  props.size === 'md' ? 'rounded-lg px-3 py-3 text-left' : 'rounded-lg px-3 py-2 text-left',
)

const stateClass = computed(() => (props.active ? 'bg-secondary/60' : 'hover:bg-secondary/40'))
</script>

<template>
  <button
    type="button"
    :class="
      cn(
        'w-full flex items-start gap-2 transition-colors disabled:pointer-events-none disabled:opacity-50',
        sizeClass,
        stateClass,
        props.destructive ? 'text-destructive' : '',
        props.class,
      )
    "
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
import { type HTMLAttributes, computed } from 'vue'

import Button from '@/components/ui/Button.vue'
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
  <Button
    type="button"
    variant="ghost"
    size="xs"
    :class="
      cn(
        'h-auto w-full items-start gap-2 text-left shadow-none',
        sizeClass,
        stateClass,
        props.destructive ? 'text-destructive' : '',
        props.class,
      )
    "
  >
    <slot />
  </Button>
</template>

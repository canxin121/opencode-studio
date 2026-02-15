<script setup lang="ts">
import { type HTMLAttributes } from 'vue'

import { cn } from '@/lib/utils'

interface Props {
  active?: boolean
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  active: false,
})
</script>

<template>
  <button
    type="button"
    :class="
      cn(
        'h-7 sm:h-8 inline-flex items-center gap-1 sm:gap-1.5 rounded-md px-1.5 sm:px-2 hover:bg-secondary/40',
        props.active ? 'bg-secondary/60' : '',
        props.class,
      )
    "
  >
    <slot />
  </button>
</template>

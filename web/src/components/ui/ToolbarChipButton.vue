<script setup lang="ts">
import { type HTMLAttributes } from 'vue'

import Button from '@/components/ui/Button.vue'
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
  <Button
    type="button"
    variant="ghost"
    size="xs"
    :class="
      cn(
        'h-7 sm:h-8 gap-1 sm:gap-1.5 rounded-md px-1.5 sm:px-2 shadow-none hover:bg-secondary/40',
        props.active ? 'bg-secondary/60' : '',
        props.class,
      )
    "
  >
    <slot />
  </Button>
</template>

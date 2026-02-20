<script setup lang="ts">
import { type HTMLAttributes, useAttrs } from 'vue'

import { cn } from '@/lib/utils'

interface Props {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
const attrs = useAttrs()
</script>

<template>
  <button
    v-bind="attrs"
    type="button"
    :class="
      cn('min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50', props.class)
    "
  >
    <slot />
  </button>
</template>

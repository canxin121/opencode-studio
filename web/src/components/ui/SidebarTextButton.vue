<script setup lang="ts">
import { type HTMLAttributes, useAttrs } from 'vue'

import Button from '@/components/ui/Button.vue'
import { cn } from '@/lib/utils'

interface Props {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
const attrs = useAttrs()
</script>

<template>
  <Button
    v-bind="attrs"
    type="button"
    variant="ghost"
    size="mini"
    :class="
      cn(
        'h-auto min-w-0 justify-start rounded-none px-0 py-0 text-left shadow-none focus-visible:ring-2 focus-visible:ring-primary/50',
        props.class,
      )
    "
  >
    <slot />
  </Button>
</template>

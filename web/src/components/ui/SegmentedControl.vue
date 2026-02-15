<script setup lang="ts">
import { type HTMLAttributes } from 'vue'

import { cn } from '@/lib/utils'

interface Props {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <div
    role="tablist"
    :class="cn('grid gap-1 rounded-sm border border-sidebar-border/70 bg-sidebar-accent/20 p-0.5', props.class)"
  >
    <slot />
  </div>
</template>

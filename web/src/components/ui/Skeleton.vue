<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
  rounded?: boolean
}>()
</script>

<template>
  <div
    :class="
      cn(
        'oc-skeleton relative overflow-hidden bg-muted/60',
        props.rounded === false ? 'rounded-none' : 'rounded-md',
        props.class,
      )
    "
  />
</template>

<style scoped>
.oc-skeleton::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.06), transparent);
  animation: oc-skeleton-shimmer 1.2s ease-in-out infinite;
}

@keyframes oc-skeleton-shimmer {
  100% {
    transform: translateX(100%);
  }
}

/* Dark theme needs a slightly brighter shimmer to read. */
:global(.dark) .oc-skeleton::after {
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
}
</style>

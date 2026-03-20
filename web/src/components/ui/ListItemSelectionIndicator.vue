<script setup lang="ts">
import { RiCheckLine } from '@remixicon/vue'

withDefaults(
  defineProps<{
    selected?: boolean
  }>(),
  {
    selected: false,
  },
)
</script>

<template>
  <span
    class="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border border-sidebar-border/80 transition-colors"
    :class="selected ? 'border-primary/70 bg-primary/15 text-primary' : 'text-transparent bg-transparent'"
    aria-hidden="true"
  >
    <RiCheckLine class="h-3 w-3" />
  </span>
</template>

<script setup lang="ts">
import Skeleton from '@/components/ui/Skeleton.vue'

withDefaults(
  defineProps<{
    rows?: number
    compact?: boolean
    withHeader?: boolean
  }>(),
  {
    rows: 4,
    compact: false,
    withHeader: true,
  },
)
</script>

<template>
  <div class="rounded-md border border-sidebar-border/40 bg-muted/10 px-2 py-2 animate-in fade-in-0 duration-200">
    <div v-if="withHeader" class="mb-2 flex items-center justify-between gap-2">
      <Skeleton class="h-2.5 w-20" />
      <Skeleton class="h-2.5 w-10" />
    </div>
    <div class="space-y-1.5">
      <div v-for="idx in rows" :key="idx" class="rounded-md border border-sidebar-border/30 bg-sidebar/60 px-2 py-1.5">
        <div class="flex items-center gap-2">
          <Skeleton class="h-2.5 w-2.5 rounded-full" />
          <Skeleton class="h-2.5" :class="idx % 3 === 0 ? 'w-2/3' : idx % 2 === 0 ? 'w-4/5' : 'w-3/4'" />
        </div>
        <Skeleton v-if="!compact" class="mt-1.5 h-2 w-1/3" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import PluginMountHost from '@/components/plugins/PluginMountHost.vue'
import type { ChatMount } from '@/plugins/host/mounts'

const props = defineProps<{
  mount: ChatMount
  height?: number
}>()

const frameHeight = computed(() => {
  const raw = Number(props.height || props.mount.height || 0)
  if (!Number.isFinite(raw) || raw <= 0) return 260
  return Math.max(120, Math.floor(raw))
})
</script>

<template>
  <section class="rounded-lg border border-border bg-muted/10 overflow-hidden">
    <header
      class="px-3 py-2 border-b border-border/60 bg-background/80 text-xs text-muted-foreground flex items-center"
    >
      <span class="font-medium text-foreground">{{ mount.title }}</span>
      <span class="ml-2 font-mono opacity-70">{{ mount.pluginId }}</span>
    </header>
    <PluginMountHost :mount="mount" :fixed-height="frameHeight" />
  </section>
</template>

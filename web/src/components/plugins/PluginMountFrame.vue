<script setup lang="ts">
import { computed, ref } from 'vue'

import { pluginAssetEntryUrl, type ChatMount } from '@/plugins/host/mounts'

const props = defineProps<{
  mount: ChatMount
  height?: number
}>()

const loaded = ref(false)

const frameUrl = computed(() => pluginAssetEntryUrl(props.mount.pluginId, props.mount.entry))
const frameHeight = computed(() => {
  const raw = Number(props.height || 0)
  if (!Number.isFinite(raw) || raw <= 0) return 260
  return Math.max(120, Math.floor(raw))
})
</script>

<template>
  <section class="rounded-lg border border-border bg-muted/10 overflow-hidden">
    <header class="px-3 py-2 border-b border-border/60 bg-background/80 text-xs text-muted-foreground flex items-center">
      <span class="font-medium text-foreground">{{ mount.title }}</span>
      <span class="ml-2 font-mono opacity-70">{{ mount.pluginId }}</span>
    </header>
    <div class="relative w-full" :style="{ height: `${frameHeight}px` }">
      <iframe
        class="w-full h-full bg-background"
        :src="frameUrl"
        :title="mount.title"
        loading="lazy"
        @load="loaded = true"
      />
      <div
        v-if="!loaded"
        class="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground bg-background/85"
      >
        Loading plugin UI...
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import PluginMountFrame from '@/components/plugins/PluginMountFrame.vue'
import type { ChatMount } from '@/plugins/host/mounts'

defineProps<{
  mounts: ChatMount[]
}>()
</script>

<template>
  <div v-if="mounts.length" class="space-y-3 mb-4">
    <PluginMountFrame
      v-for="mount in mounts"
      :key="`${mount.pluginId}:${mount.surface}:${mount.entry}:${mount.mode}`"
      :mount="mount"
    />
  </div>
</template>

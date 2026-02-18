<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import PluginMountHost from '@/components/plugins/PluginMountHost.vue'
import type { ChatMount } from '@/plugins/host/mounts'

const props = defineProps<{
  mounts: ChatMount[]
}>()

const emit = defineEmits<{
  (event: 'reserve-change', px: number): void
}>()

type ReserveMap = Record<string, number>
const reserveByKey = ref<ReserveMap>({})

function mountKey(mount: ChatMount): string {
  return `${mount.pluginId}:${mount.surface}:${mount.entry}:${mount.mode}`
}

function recomputeReserve() {
  const values = Object.values(reserveByKey.value)
  const max = values.length ? Math.max(0, ...values) : 0
  emit('reserve-change', max)
}

function setReserve(key: string, px: number) {
  const nextPx = Number.isFinite(px) && px > 0 ? Math.max(0, Math.floor(px)) : 0
  if (reserveByKey.value[key] === nextPx) return
  reserveByKey.value = {
    ...reserveByKey.value,
    [key]: nextPx,
  }
  recomputeReserve()
}

watch(
  () => props.mounts.map(mountKey).join('|'),
  () => {
    const keep = new Set(props.mounts.map(mountKey))
    const next: ReserveMap = {}
    for (const [key, value] of Object.entries(reserveByKey.value)) {
      if (keep.has(key)) next[key] = value
    }
    reserveByKey.value = next
    recomputeReserve()
  },
  { immediate: true },
)

const hasMounts = computed(() => props.mounts.length > 0)
</script>

<template>
  <div v-if="hasMounts" class="pointer-events-none w-full flex flex-col items-stretch gap-2">
    <div v-for="mount in mounts" :key="mountKey(mount)" class="pointer-events-none w-full">
      <div class="pointer-events-auto w-full min-w-0">
        <PluginMountHost class="w-full min-w-0" :mount="mount" @reserve-change="(px) => setReserve(mountKey(mount), px)" />
      </div>
    </div>
  </div>
</template>

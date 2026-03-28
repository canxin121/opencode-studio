<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RiCloseLine } from '@remixicon/vue'

import IconButton from '@/components/ui/IconButton.vue'
import WorkspacePaneHeader from '@/layout/WorkspacePaneHeader.vue'
import { MAIN_TABS, type MainTabId } from '@/app/navigation/mainTabs'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{
  windowId: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const ui = useUiStore()
const { t } = useI18n()

const TAB_PATHS = MAIN_TABS.reduce(
  (acc, item) => {
    acc[item.id] = item.path
    return acc
  },
  {} as Record<MainTabId, string>,
)

const targetWindow = computed(() => ui.getWorkspaceWindowById(props.windowId))

const frameSrc = computed(() => {
  const tab = targetWindow.value
  if (!tab || typeof window === 'undefined') return ''

  const path = TAB_PATHS[tab.mainTab] || '/chat'
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(tab.routeQuery || {})) {
    const k = String(key || '').trim()
    const v = String(value || '').trim()
    if (!k || !v) continue
    params.set(k, v)
  }
  params.set('windowId', String(tab.id || '').trim())
  params.set('ocEmbed', '1')

  const query = params.toString()
  return query ? `${path}?${query}` : path
})

function closeSplit() {
  emit('close')
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col border-l border-border/60 bg-background">
    <WorkspacePaneHeader :window-tab="targetWindow">
      <template #actions>
        <IconButton
          size="xs"
          :tooltip="String(t('header.windowTabs.closeSplit'))"
          :aria-label="String(t('header.windowTabs.closeSplit'))"
          :is-touch-pointer="false"
          @click="closeSplit"
        >
          <RiCloseLine class="h-3.5 w-3.5" />
        </IconButton>
      </template>
    </WorkspacePaneHeader>

    <div class="min-h-0 flex-1 overflow-hidden bg-background">
      <iframe v-if="frameSrc" :src="frameSrc" class="h-full w-full border-0" />
      <div v-else class="flex h-full items-center justify-center px-4 text-xs text-muted-foreground">
        {{ t('header.windowTabs.splitNoContent') }}
      </div>
    </div>
  </section>
</template>

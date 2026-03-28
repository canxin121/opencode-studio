<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RiCloseLine } from '@remixicon/vue'

import IconButton from '@/components/ui/IconButton.vue'
import WorkspacePaneHeader from '@/layout/WorkspacePaneHeader.vue'
import { useUiStore } from '@/stores/ui'

const props = withDefaults(
  defineProps<{
    windowId?: string | null
    showHeader?: boolean
    showClose?: boolean
  }>(),
  {
    windowId: null,
    showHeader: true,
    showClose: false,
  },
)

const emit = defineEmits<{
  (e: 'close'): void
}>()

const ui = useUiStore()
const { t } = useI18n()

const targetWindow = computed(() => {
  const targetId = String(props.windowId || '').trim()
  if (targetId) {
    const matched = ui.getWorkspaceWindowById(targetId)
    if (matched) return matched
  }
  return ui.activeWorkspaceWindow || ui.workspaceWindows[0] || null
})

function closePane() {
  emit('close')
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-background">
    <WorkspacePaneHeader v-if="showHeader" :window-tab="targetWindow">
      <template #actions>
        <IconButton
          v-if="showClose"
          size="xs"
          :tooltip="String(t('header.windowTabs.closeSplit'))"
          :aria-label="String(t('header.windowTabs.closeSplit'))"
          :is-touch-pointer="false"
          @click="closePane"
        >
          <RiCloseLine class="h-3.5 w-3.5" />
        </IconButton>
      </template>
    </WorkspacePaneHeader>

    <div class="min-h-0 flex-1 overflow-hidden">
      <router-view />
    </div>
  </section>
</template>

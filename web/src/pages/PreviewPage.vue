<script setup lang="ts">
import { computed } from 'vue'

import WorkspacePreviewDockPanel from '@/features/workspacePreview/components/WorkspacePreviewDockPanel.vue'
import WorkspacePreviewPageSidebar from '@/features/workspacePreview/components/WorkspacePreviewPageSidebar.vue'
import { useDesktopSidebarResize } from '@/composables/useDesktopSidebarResize'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const { startDesktopSidebarResize } = useDesktopSidebarResize()

const showPreviewSidebar = computed(() => (ui.isMobile ? ui.isSessionSwitcherOpen : ui.isSidebarOpen))
</script>

<template>
  <div class="flex h-full min-h-0 overflow-hidden bg-background text-foreground">
    <aside
      v-if="showPreviewSidebar"
      class="relative min-h-0 overflow-hidden"
      :class="ui.isMobile ? 'w-full' : 'flex-shrink-0'"
      :style="ui.isMobile ? undefined : { width: `${ui.sidebarWidth}px` }"
    >
      <div
        v-if="!ui.isMobile"
        class="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-primary/40"
        @pointerdown="startDesktopSidebarResize"
      />
      <WorkspacePreviewPageSidebar />
    </aside>

    <div class="min-w-0 flex-1 overflow-hidden" v-show="!ui.isMobile || !ui.isSessionSwitcherOpen">
      <WorkspacePreviewDockPanel :show-controls="false" viewer-mode="responsive" />
    </div>
  </div>
</template>

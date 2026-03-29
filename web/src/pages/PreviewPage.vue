<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'

import WorkspacePreviewDockPanel from '@/features/workspacePreview/components/WorkspacePreviewDockPanel.vue'
import WorkspacePreviewPageSidebar from '@/features/workspacePreview/components/WorkspacePreviewPageSidebar.vue'
import { WORKSPACE_SIDEBAR_PANEL_HOST_SELECTOR } from '@/layout/workspaceSidebarHost'
import { useUiStore } from '@/stores/ui'
import { useWorkspacePreviewStore } from '@/stores/workspacePreview'
import { isEmbeddedWorkspacePaneContext } from '@/app/windowScope'

const ui = useUiStore()
const preview = useWorkspacePreviewStore()
const route = useRoute()
const { t } = useI18n()

const isEmbeddedWorkspacePane = computed(() => isEmbeddedWorkspacePaneContext(route.query))
const useDesktopSidebarHost = computed(() => !ui.isCompactLayout && !isEmbeddedWorkspacePane.value)
const showPreviewSidebar = computed(() => {
  if (isEmbeddedWorkspacePane.value) return false
  if (useDesktopSidebarHost.value) return true
  return ui.isCompactLayout ? ui.isSessionSwitcherOpen : ui.isSidebarOpen
})

function basenameFromPath(rawPath: string): string {
  const normalized = String(rawPath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/g, '')
  if (!normalized) return ''
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] || ''
}

function hostFromUrl(rawUrl: string): string {
  const candidate = String(rawUrl || '').trim()
  if (!candidate) return ''
  try {
    const parsed = new URL(candidate)
    return String(parsed.hostname || parsed.host || '').trim()
  } catch {
    return ''
  }
}

function syncPreviewWindowTitle() {
  const base = String(t('nav.preview'))
  const active = preview.activeSession
  const detail = active
    ? basenameFromPath(active.runDirectory) || basenameFromPath(active.directory) || hostFromUrl(active.targetUrl)
    : ''
  const title = detail ? `${base} · ${detail}` : base

  ui.setWorkspaceWindowTitleFromRoute(route.query, title)
}

watch(
  () => [preview.activeSessionId, preview.activeSession?.id, route.query],
  () => {
    syncPreviewWindowTitle()
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex h-full min-h-0 overflow-hidden bg-background text-foreground">
    <Teleport :to="WORKSPACE_SIDEBAR_PANEL_HOST_SELECTOR" :disabled="!useDesktopSidebarHost">
      <aside
        v-if="showPreviewSidebar"
        class="relative h-full min-h-0 overflow-hidden bg-sidebar text-sidebar-foreground"
        :class="ui.isCompactLayout || useDesktopSidebarHost ? 'w-full' : 'flex-shrink-0'"
        :style="ui.isCompactLayout || useDesktopSidebarHost ? undefined : { width: `${ui.sidebarWidth}px` }"
      >
        <WorkspacePreviewPageSidebar />
      </aside>
    </Teleport>

    <div class="min-w-0 flex-1 overflow-hidden" v-show="!ui.isCompactLayout || !ui.isSessionSwitcherOpen">
      <WorkspacePreviewDockPanel controls-variant="viewport" viewer-mode="responsive" />
    </div>
  </div>
</template>

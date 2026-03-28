<script setup lang="ts">
import HelpDialog from '@/components/HelpDialog.vue'
import ImageViewerDialog from '@/components/ImageViewerDialog.vue'
import McpDialog from '@/components/McpDialog.vue'
import HorizontalSplitPane from '@/components/ui/HorizontalSplitPane.vue'
import MultiPaneHorizontalSplit from '@/components/ui/MultiPaneHorizontalSplit.vue'
import Skeleton from '@/components/ui/Skeleton.vue'
import AppHeader from '@/layout/AppHeader.vue'
import ChatSidebar from '@/layout/ChatSidebar.vue'
import BottomNav from '@/layout/BottomNav.vue'
import WorkspaceDockPanel from '@/layout/WorkspaceDockPanel.vue'
import WorkspaceWindowTabs from '@/layout/WorkspaceWindowTabs.vue'
import WorkspaceSplitPaneView from '@/layout/WorkspaceSplitPaneView.vue'
import WorkspacePrimaryPaneView from '@/layout/WorkspacePrimaryPaneView.vue'
import { MAIN_TABS, type MainTabId } from '@/app/navigation/mainTabs'
import { WORKSPACE_SIDEBAR_HOST_ID } from '@/layout/workspaceSidebarHost'
import { readWorkspaceWindowDragIdFromDataTransfer } from '@/layout/workspaceWindowDrag'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import { useUiStore } from '@/stores/ui'
import { useToastsStore } from '@/stores/toasts'
import { useAppRuntime } from '@/app/runtime/useAppRuntime'
import { useDesktopSidebarResize } from '@/composables/useDesktopSidebarResize'

const ui = useUiStore()
const toasts = useToastsStore()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { startDesktopSidebarResize } = useDesktopSidebarResize()
useAppRuntime()

const TAB_PATHS = MAIN_TABS.reduce(
  (acc, item) => {
    acc[item.id] = item.path
    return acc
  },
  {} as Record<MainTabId, string>,
)

const isEmbeddedWorkspacePane = computed(() => String(route.query?.ocEmbed || '').trim() === '1')

const usesChatShellSidebar = computed(() => {
  if (isEmbeddedWorkspacePane.value) return false
  const shellSidebar = String(route.meta?.shellSidebar || '')
    .trim()
    .toLowerCase()
  if (shellSidebar === 'chat') return true
  if (shellSidebar === 'none') return false
  return String(route.path || '')
    .toLowerCase()
    .startsWith('/chat')
})

const mobileSidebarPointerReady = ref(false)
let mobileSidebarPointerRafA: number | null = null
let mobileSidebarPointerRafB: number | null = null

function clearMobileSidebarPointerRafs() {
  if (mobileSidebarPointerRafA !== null) {
    window.cancelAnimationFrame(mobileSidebarPointerRafA)
    mobileSidebarPointerRafA = null
  }
  if (mobileSidebarPointerRafB !== null) {
    window.cancelAnimationFrame(mobileSidebarPointerRafB)
    mobileSidebarPointerRafB = null
  }
}

watch(
  () => ({
    isCompactLayout: ui.isCompactLayout,
    switcherOpen: ui.isSessionSwitcherOpen,
    usesChatShellSidebar: usesChatShellSidebar.value,
  }),
  ({ isCompactLayout, switcherOpen, usesChatShellSidebar: usesSidebar }) => {
    clearMobileSidebarPointerRafs()
    if (!isCompactLayout || !usesSidebar || !switcherOpen) {
      mobileSidebarPointerReady.value = false
      return
    }

    mobileSidebarPointerReady.value = false
    mobileSidebarPointerRafA = window.requestAnimationFrame(() => {
      mobileSidebarPointerRafA = null
      mobileSidebarPointerRafB = window.requestAnimationFrame(() => {
        mobileSidebarPointerRafB = null
        mobileSidebarPointerReady.value = true
      })
    })
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  clearMobileSidebarPointerRafs()
})

// Mobile UX: navigating should switch focus to main content.
// The same store flag is used as a "sidebar" across mobile panels (sessions, terminal, etc).
watch(
  () => route.fullPath,
  (next, prev) => {
    if (!ui.isCompactLayout) return
    if (!ui.isSessionSwitcherOpen) return
    if (next === prev) return
    ui.setSessionSwitcherOpen(false)
  },
)

const mobileBottomNavInset =
  'calc(var(--oc-bottom-nav-height, 56px) + var(--oc-safe-area-bottom, 0px) - clamp(0px, var(--oc-keyboard-inset, 0px), var(--oc-bottom-nav-height, 56px)))'

const showBottomNav = computed(() => ui.isCompactLayout && ui.isMobileDevice && !isEmbeddedWorkspacePane.value)
const compactBottomInset = computed(() => (showBottomNav.value ? mobileBottomNavInset : '0px'))
const showWorkspaceWindowTabs = computed(() => !ui.isCompactLayout && !isEmbeddedWorkspacePane.value)
const showWorkspacePaneHeader = computed(() => !ui.isCompactLayout && !isEmbeddedWorkspacePane.value)
const showDesktopSidebarHost = computed(() => !ui.isCompactLayout && !isEmbeddedWorkspacePane.value)
const workspaceVisibleWindowIds = computed(() => ui.workspaceVisibleWindowIds)
const selectedWorkspaceGroupId = computed(() => String(ui.activeWorkspaceGroupId || '').trim())
const selectedWorkspaceGroup = computed(() => ui.getWorkspaceGroupById(selectedWorkspaceGroupId.value))
const groupPaneRatios = computed(() => {
  if (!selectedWorkspaceGroupId.value) return []
  return ui.getWorkspaceGroupSplitPaneRatios(selectedWorkspaceGroupId.value)
})
const isGroupPaneMode = computed(
  () =>
    !isEmbeddedWorkspacePane.value &&
    Boolean(selectedWorkspaceGroupId.value) &&
    workspaceVisibleWindowIds.value.length > 0,
)
const activePaneId = computed(() =>
  String(ui.activeWorkspaceWindowId || workspaceVisibleWindowIds.value[0] || '').trim(),
)
const showWorkspaceRightDock = computed(
  () =>
    !ui.isCompactLayout &&
    !isEmbeddedWorkspacePane.value &&
    !selectedWorkspaceGroupId.value &&
    ui.isWorkspaceDockOpen &&
    workspaceVisibleWindowIds.value.length === 1,
)
const splitDropHover = ref(false)
const isGroupPaneResizing = ref(false)
const isLeftSidebarResizing = ref(false)
const leftSidebarPreviewWidth = ref(ui.sidebarWidth)
const isWorkspaceDockResizing = ref(false)
const desktopSidebarRenderWidth = computed(() => {
  if (!showDesktopSidebarHost.value || !ui.isSidebarOpen) return 0
  return isLeftSidebarResizing.value ? leftSidebarPreviewWidth.value : ui.sidebarWidth
})

function matchKeysForTab(tab: MainTabId): string[] {
  if (tab === 'chat') return ['sessionId']
  if (tab === 'files') return ['filePath']
  return []
}

function getWorkspaceWindowGroupId(windowId: string): string {
  const targetId = String(windowId || '').trim()
  if (!targetId) return ''
  for (const group of ui.workspaceGroups) {
    if (group.tabIds.includes(targetId)) return group.id
  }
  return ''
}

function isUngroupedWorkspaceWindow(windowId: string): boolean {
  const targetId = String(windowId || '').trim()
  if (!targetId) return false
  if (!ui.getWorkspaceWindowById(targetId)) return false
  return !getWorkspaceWindowGroupId(targetId)
}

function readDraggedWorkspaceWindowId(event: DragEvent): string {
  const fromStore = String(ui.workspaceWindowDragId || '').trim()
  if (fromStore) return fromStore
  return readWorkspaceWindowDragIdFromDataTransfer(event.dataTransfer)
}

function hasEquivalentWindowInGroup(sourceWindowId: string, groupId: string): boolean {
  const sourceId = String(sourceWindowId || '').trim()
  const targetGroupId = String(groupId || '').trim()
  if (!sourceId || !targetGroupId) return false

  const source = ui.getWorkspaceWindowById(sourceId)
  const group = ui.getWorkspaceGroupById(targetGroupId)
  if (!source || !group) return false
  if (group.tabIds.includes(sourceId)) return true

  const matchKeys = matchKeysForTab(source.mainTab)
  return Boolean(
    ui.findWorkspaceWindowByTabAndQuery(source.mainTab, source.routeQuery, {
      keys: matchKeys,
      windowIds: group.tabIds,
    }),
  )
}

function hasEquivalentWindowInTargetIds(sourceWindowId: string, targetIds: string[]): boolean {
  const sourceId = String(sourceWindowId || '').trim()
  if (!sourceId) return false

  const source = ui.getWorkspaceWindowById(sourceId)
  if (!source) return false

  const matchKeys = matchKeysForTab(source.mainTab)
  return Boolean(
    ui.findWorkspaceWindowByTabAndQuery(source.mainTab, source.routeQuery, {
      keys: matchKeys,
      windowIds: targetIds,
    }),
  )
}

function handleGroupPaneRatiosUpdate(nextRatios: number[]) {
  const targetGroupId = selectedWorkspaceGroupId.value
  if (!targetGroupId) return
  ui.setWorkspaceGroupSplitPaneRatios(targetGroupId, nextRatios)
}

function handleGroupPaneResizeStart() {
  isGroupPaneResizing.value = true
}

function handleGroupPaneResizeEnd() {
  window.requestAnimationFrame(() => {
    isGroupPaneResizing.value = false
  })
}

function handleDesktopSidebarResize(event: PointerEvent) {
  startDesktopSidebarResize(event, {
    deferCommit: true,
    onStart: () => {
      leftSidebarPreviewWidth.value = ui.sidebarWidth
      isLeftSidebarResizing.value = true
    },
    onPreviewWidth: (nextWidth) => {
      leftSidebarPreviewWidth.value = nextWidth
    },
    onEnd: (finalWidth) => {
      leftSidebarPreviewWidth.value = finalWidth
      window.requestAnimationFrame(() => {
        isLeftSidebarResizing.value = false
      })
    },
  })
}

function handleWorkspaceDockResizeStart() {
  isWorkspaceDockResizing.value = true
}

function handleWorkspaceDockResizeEnd() {
  window.requestAnimationFrame(() => {
    isWorkspaceDockResizing.value = false
  })
}

const showWorkspaceSplitDropZone = computed(() => {
  if (ui.isCompactLayout || isEmbeddedWorkspacePane.value) return false
  const sourceId = String(ui.workspaceWindowDragId || '').trim()
  if (!sourceId) return false
  return isUngroupedWorkspaceWindow(sourceId)
})

function handleSplitDropZoneDragEnter(event: DragEvent) {
  const sourceId = readDraggedWorkspaceWindowId(event)
  if (!isUngroupedWorkspaceWindow(sourceId)) return
  splitDropHover.value = true
}

function handleSplitDropZoneDragOver(event: DragEvent) {
  const sourceId = readDraggedWorkspaceWindowId(event)
  if (!isUngroupedWorkspaceWindow(sourceId)) return

  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  splitDropHover.value = true
}

function handleSplitDropZoneDragLeave(event: DragEvent) {
  const host = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (host && related && host.contains(related)) return
  splitDropHover.value = false
}

function handleSplitDropZoneDrop(event: DragEvent) {
  const sourceWindowId = readDraggedWorkspaceWindowId(event)

  splitDropHover.value = false
  ui.endWorkspaceWindowDrag()

  if (!sourceWindowId) return
  if (!isUngroupedWorkspaceWindow(sourceWindowId)) return

  event.preventDefault()

  const targetGroup = selectedWorkspaceGroup.value
  if (targetGroup) {
    if (hasEquivalentWindowInGroup(sourceWindowId, targetGroup.id)) {
      toasts.push('error', String(t('header.windowTabs.splitDropAlreadyInGroup')))
      return
    }

    const moved = ui.moveWorkspaceWindowToGroup(sourceWindowId, targetGroup.id, { activateTargetGroup: false })
    if (!moved) {
      toasts.push('error', String(t('header.windowTabs.splitDropFailed')))
      return
    }

    ui.setWorkspaceGroupCollapsed(targetGroup.id, false)
    ui.selectWorkspaceGroup(targetGroup.id)
    return
  }

  const baseWindowId = String(ui.workspaceVisibleWindowIds[0] || '').trim()
  if (!baseWindowId || !isUngroupedWorkspaceWindow(baseWindowId)) {
    toasts.push('error', String(t('header.windowTabs.splitDropNeedsTab')))
    return
  }

  if (baseWindowId === sourceWindowId) {
    toasts.push('info', String(t('header.windowTabs.splitDropSameTab')))
    return
  }

  if (hasEquivalentWindowInTargetIds(sourceWindowId, [baseWindowId])) {
    toasts.push('error', String(t('header.windowTabs.splitDropAlreadyInGroup')))
    return
  }

  const newGroupId = ui.createWorkspaceGroup()
  const movedBase = ui.moveWorkspaceWindowToGroup(baseWindowId, newGroupId, { activateTargetGroup: false })
  const movedSource = ui.moveWorkspaceWindowToGroup(sourceWindowId, newGroupId, { activateTargetGroup: false })

  if (!movedBase || !movedSource) {
    toasts.push('error', String(t('header.windowTabs.splitDropFailed')))
    return
  }

  ui.setWorkspaceGroupCollapsed(newGroupId, false)
  ui.selectWorkspaceGroup(newGroupId)
}

function toRouteQuery(query: Record<string, string>): Record<string, string> | undefined {
  const entries = Object.entries(query || {})
  if (!entries.length) return undefined
  return Object.fromEntries(entries)
}

function normalizeQueryRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const k = String(key || '').trim()
    if (!k || k === 'windowId' || k === 'windowid' || k === 'ocEmbed') continue
    const v = Array.isArray(value)
      ? String(value.find((item) => String(item || '').trim()) || '').trim()
      : String(value || '').trim()
    if (!v) continue
    out[k] = v
  }
  return out
}

function areQueriesEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false
  }
  return true
}

async function syncRouteToActiveWorkspaceWindow() {
  if (isEmbeddedWorkspacePane.value) return
  if (selectedWorkspaceGroupId.value) return

  const target = ui.activeWorkspaceWindow || ui.workspaceWindows[0] || null
  if (!target) return

  const path = TAB_PATHS[target.mainTab] || '/chat'
  const currentQuery = normalizeQueryRecord(route.query)
  const currentWindowId = String(route.query?.windowId || route.query?.windowid || '').trim()
  if (route.path === path && areQueriesEqual(currentQuery, target.routeQuery || {}) && currentWindowId === target.id) {
    return
  }

  const query = toRouteQuery({
    ...(target.routeQuery || {}),
    windowId: target.id,
  })
  await router
    .replace({
      path,
      ...(query ? { query } : {}),
    })
    .catch(() => {})
}

watch(
  () => activePaneId.value,
  (next, prev) => {
    if (isEmbeddedWorkspacePane.value) return
    if (selectedWorkspaceGroupId.value) return
    if (!next || next === prev) return
    void syncRouteToActiveWorkspaceWindow()
  },
)

watch(
  () => showWorkspaceSplitDropZone.value,
  (visible) => {
    if (!visible) splitDropHover.value = false
  },
)

watch(
  () => isGroupPaneMode.value,
  (enabled) => {
    if (!enabled) isGroupPaneResizing.value = false
  },
)

watch(
  () => showDesktopSidebarHost.value,
  (visible) => {
    if (!visible) isLeftSidebarResizing.value = false
  },
)

watch(
  () => showWorkspaceRightDock.value,
  (visible) => {
    if (!visible) isWorkspaceDockResizing.value = false
  },
)
</script>

<template>
  <div class="main-content-safe-area relative h-[100dvh] bg-background text-foreground overflow-hidden flex flex-col">
    <HelpDialog v-if="!isEmbeddedWorkspacePane" />
    <McpDialog v-if="!isEmbeddedWorkspacePane" />
    <ImageViewerDialog />

    <div class="flex flex-1 flex-col overflow-hidden">
      <AppHeader v-if="!isEmbeddedWorkspacePane" />

      <div class="flex flex-1 overflow-hidden">
        <aside
          v-if="showDesktopSidebarHost"
          class="relative h-full overflow-hidden border-r border-border bg-sidebar"
          :style="{ width: `${desktopSidebarRenderWidth}px` }"
          :aria-hidden="!ui.isSidebarOpen"
          :class="ui.isSidebarOpen ? '' : 'pointer-events-none'"
        >
          <div
            v-if="ui.isSidebarOpen"
            class="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/40"
            @pointerdown="handleDesktopSidebarResize"
          />

          <div :id="WORKSPACE_SIDEBAR_HOST_ID" class="h-full min-h-0">
            <ChatSidebar v-if="usesChatShellSidebar && ui.isSidebarOpen && !isLeftSidebarResizing" />
            <div
              v-else-if="ui.isSidebarOpen && isLeftSidebarResizing"
              class="flex h-full items-center justify-center px-3"
            >
              <div class="flex flex-col items-center gap-2 text-center">
                <Skeleton class="h-7 w-7 rounded-full" />
                <span class="text-xs font-medium text-muted-foreground">
                  {{ t('header.windowTabs.resizingSidebar') }}
                </span>
              </div>
            </div>
          </div>
        </aside>

        <div class="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <div
            v-if="ui.isCompactLayout && usesChatShellSidebar"
            v-show="ui.isSessionSwitcherOpen"
            class="absolute inset-x-0 top-0 z-40 bg-sidebar"
            :class="mobileSidebarPointerReady ? '' : 'pointer-events-none'"
            :style="{ bottom: compactBottomInset }"
            :aria-hidden="!ui.isSessionSwitcherOpen"
          >
            <ChatSidebar mobile-variant />
          </div>

          <WorkspaceWindowTabs v-if="showWorkspaceWindowTabs" />

          <div
            v-if="isGroupPaneMode && showDesktopSidebarHost && !usesChatShellSidebar"
            class="hidden"
            aria-hidden="true"
          >
            <router-view />
          </div>

          <main
            class="relative min-h-0 flex-1 overflow-hidden"
            :style="
              ui.isCompactLayout
                ? {
                    paddingBottom: compactBottomInset,
                  }
                : undefined
            "
          >
            <MultiPaneHorizontalSplit
              v-if="isGroupPaneMode"
              :pane-ids="workspaceVisibleWindowIds"
              :ratios="groupPaneRatios"
              :min-pane-width="280"
              @update:ratios="handleGroupPaneRatiosUpdate"
              @drag-start="handleGroupPaneResizeStart"
              @drag-end="handleGroupPaneResizeEnd"
            >
              <template #pane="{ paneId }">
                <div class="relative h-full min-w-0">
                  <WorkspaceSplitPaneView
                    v-show="!isGroupPaneResizing"
                    :window-id="paneId"
                    class="h-full min-w-0"
                    @close="ui.closeWorkspaceWindow(paneId)"
                  />

                  <div
                    v-show="isGroupPaneResizing"
                    class="flex h-full min-h-0 border-l border-border/60 bg-background"
                    aria-hidden="true"
                  >
                    <div class="flex min-h-0 flex-1 items-center justify-center px-4">
                      <div class="flex w-full max-w-xs flex-col items-center gap-3 px-4 py-6 text-center">
                        <Skeleton class="h-8 w-8 rounded-full" />
                        <Skeleton class="h-2.5 w-32" />
                        <span class="text-xs font-medium text-muted-foreground">
                          {{ t('header.windowTabs.resizingSplit') }}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </MultiPaneHorizontalSplit>

            <HorizontalSplitPane
              v-else-if="showWorkspaceRightDock"
              v-model="ui.workspaceDockWidth"
              :min-width="280"
              :max-width="1200"
              @drag-start="handleWorkspaceDockResizeStart"
              @drag-end="handleWorkspaceDockResizeEnd"
            >
              <template #left>
                <WorkspacePrimaryPaneView
                  v-if="!isWorkspaceDockResizing"
                  :window-id="activePaneId"
                  :show-header="showWorkspacePaneHeader"
                />
                <div v-else class="flex h-full items-center justify-center px-4">
                  <div class="flex flex-col items-center gap-2 text-center">
                    <Skeleton class="h-7 w-7 rounded-full" />
                    <span class="text-xs font-medium text-muted-foreground">
                      {{ t('header.windowTabs.resizingSidebar') }}
                    </span>
                  </div>
                </div>
              </template>
              <template #right>
                <WorkspaceDockPanel v-if="!isWorkspaceDockResizing" />
                <div v-else class="flex h-full items-center justify-center px-4">
                  <div class="flex flex-col items-center gap-2 text-center">
                    <Skeleton class="h-7 w-7 rounded-full" />
                    <span class="text-xs font-medium text-muted-foreground">
                      {{ t('header.windowTabs.resizingSidebar') }}
                    </span>
                  </div>
                </div>
              </template>
            </HorizontalSplitPane>

            <WorkspacePrimaryPaneView
              v-else-if="isEmbeddedWorkspacePane || workspaceVisibleWindowIds.length === 1"
              :window-id="activePaneId"
              :show-header="showWorkspacePaneHeader"
            />

            <div v-else class="flex h-full items-center justify-center px-4 text-xs text-muted-foreground">
              {{ t('header.windowTabs.splitNoContent') }}
            </div>

            <div
              v-if="showWorkspaceSplitDropZone"
              class="pointer-events-none absolute inset-y-0 right-0 z-40 flex w-28 items-stretch justify-end pr-2"
            >
              <div
                class="pointer-events-auto my-2 flex w-full items-center justify-center rounded-lg border border-dashed px-2 text-center text-[11px] font-medium leading-4 transition-colors"
                :class="
                  splitDropHover
                    ? 'border-primary/70 bg-primary/15 text-primary'
                    : 'border-border/70 bg-background/70 text-muted-foreground'
                "
                @dragenter="handleSplitDropZoneDragEnter"
                @dragover="handleSplitDropZoneDragOver"
                @dragleave="handleSplitDropZoneDragLeave"
                @drop="handleSplitDropZoneDrop"
              >
                <span>{{ t('header.windowTabs.dragToSplit') }}</span>
              </div>
            </div>
          </main>
        </div>
      </div>

      <BottomNav v-if="showBottomNav" />
    </div>
  </div>
</template>

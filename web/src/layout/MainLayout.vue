<script setup lang="ts">
import HelpDialog from '@/components/HelpDialog.vue'
import ImageViewerDialog from '@/components/ImageViewerDialog.vue'
import McpDialog from '@/components/McpDialog.vue'
import MultiPaneHorizontalSplit from '@/components/ui/MultiPaneHorizontalSplit.vue'
import Skeleton from '@/components/ui/Skeleton.vue'
import AppDesktopSidebar from '@/layout/AppDesktopSidebar.vue'
import AppHeader from '@/layout/AppHeader.vue'
import ChatSidebar from '@/layout/ChatSidebar.vue'
import BottomNav from '@/layout/BottomNav.vue'
import WorkspaceEditorGroupPane from '@/layout/WorkspaceEditorGroupPane.vue'
import WorkspacePrimaryPaneView from '@/layout/WorkspacePrimaryPaneView.vue'
import { WORKSPACE_MAIN_TABS, type MainTabId } from '@/app/navigation/mainTabs'
import {
  hasEmbeddedWorkspacePaneQuery,
  isEmbeddedWorkspacePaneContext,
  withEmbeddedWorkspaceScopeQuery,
} from '@/app/windowScope'
import { WORKSPACE_SIDEBAR_HOST_ID } from '@/layout/workspaceSidebarHost'
import {
  hasWorkspaceWindowDragDataTransfer,
  readWorkspaceWindowDragIdFromDataTransfer,
  readWorkspaceWindowTemplateFromDataTransfer,
  type WorkspaceWindowTemplateDragData,
} from '@/layout/workspaceWindowDrag'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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

const TAB_PATHS = WORKSPACE_MAIN_TABS.reduce(
  (acc, item) => {
    acc[item.id] = item.path
    return acc
  },
  {} as Record<MainTabId, string>,
)

const isEmbeddedWorkspacePane = computed(() => isEmbeddedWorkspacePaneContext(route.query))

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
  window.removeEventListener('dragend', handleGlobalWorkspaceDragTerminateFallback, true)
  window.removeEventListener('drop', handleGlobalWorkspaceDragTerminateFallback, true)
  window.removeEventListener('blur', handleGlobalWorkspaceDragTerminateFallback)
  clearWorkspaceDragRuntimeState()
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
const showDesktopSidebarHost = computed(() => !ui.isCompactLayout && !isEmbeddedWorkspacePane.value)
const useWorkspaceWindowLayout = computed(() => !ui.isCompactLayout && !isEmbeddedWorkspacePane.value)
const workspaceGroupPaneIds = computed(() =>
  ui.workspaceGroups.map((group) => String(group.id || '').trim()).filter(Boolean),
)
const selectedWorkspaceGroupId = computed(() => {
  const activeId = String(ui.activeWorkspaceGroupId || '').trim()
  if (activeId && workspaceGroupPaneIds.value.includes(activeId)) return activeId
  return workspaceGroupPaneIds.value[0] || ''
})
const groupPaneRatios = computed(() => {
  if (!workspaceGroupPaneIds.value.length) return []
  return ui.getWorkspaceGroupSplitPaneRatios(selectedWorkspaceGroupId.value || workspaceGroupPaneIds.value[0] || '')
})
const isGroupPaneMode = computed(() => useWorkspaceWindowLayout.value && workspaceGroupPaneIds.value.length > 0)
const activePrimaryWindowId = computed(() =>
  String(ui.activeWorkspaceWindowId || ui.workspaceVisibleWindowIds[0] || ui.workspaceWindows[0]?.id || '').trim(),
)
const isGroupPaneResizing = ref(false)
const isLeftSidebarResizing = ref(false)
const desktopSidebarAsideEl = ref<HTMLElement | null>(null)
const isAnySidebarResizing = computed(() => isLeftSidebarResizing.value)
const isWorkspaceDropDragActive = ref(false)
const workspacePaneDropTarget = ref<{ paneId: string; position: WorkspaceDropPosition } | null>(null)
const DESKTOP_SIDEBAR_COLLAPSED_WIDTH = 76
const showWorkspacePaneDropTargets = computed(
  () =>
    useWorkspaceWindowLayout.value &&
    !isAnySidebarResizing.value &&
    !isGroupPaneResizing.value &&
    (Boolean(String(ui.workspaceWindowDragId || '').trim()) || isWorkspaceDropDragActive.value),
)
const desktopSidebarRenderWidth = computed(() => {
  if (!showDesktopSidebarHost.value) return 0
  if (ui.isSidebarOpen) return ui.sidebarWidth
  return DESKTOP_SIDEBAR_COLLAPSED_WIDTH
})

type WorkspaceDropPosition = 'before' | 'replace' | 'after'

type WorkspaceDropSource =
  | {
      kind: 'window'
      windowId: string
      tab: MainTabId
      query: Record<string, string>
      title?: string
      matchKeys: string[]
    }
  | {
      kind: 'template'
      tab: MainTabId
      query: Record<string, string>
      title?: string
      matchKeys: string[]
      windowId?: string
    }

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

function readDraggedWorkspaceWindowId(event: DragEvent, opts?: { hasTemplate?: boolean }): string {
  const fromTransfer = readWorkspaceWindowDragIdFromDataTransfer(event.dataTransfer)
  if (fromTransfer) return fromTransfer
  if (opts?.hasTemplate) return ''
  return String(ui.workspaceWindowDragId || '').trim()
}

function hasWorkspaceDragDataType(event: DragEvent): boolean {
  return hasWorkspaceWindowDragDataTransfer(event.dataTransfer)
}

function handleGroupPaneRatiosUpdate(nextRatios: number[]) {
  const targetGroupId = selectedWorkspaceGroupId.value || workspaceGroupPaneIds.value[0] || ''
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

function setDesktopSidebarPreviewWidth(width: number) {
  const el = desktopSidebarAsideEl.value
  if (!el) return
  if (!(width >= 0)) return
  el.style.width = `${Math.round(width)}px`
}

function handleDesktopSidebarResize(event: PointerEvent) {
  startDesktopSidebarResize(event, {
    deferCommit: true,
    onStart: () => {
      isLeftSidebarResizing.value = true
      setDesktopSidebarPreviewWidth(ui.sidebarWidth)
    },
    onPreviewWidth: (nextWidth) => {
      setDesktopSidebarPreviewWidth(nextWidth)
    },
    onEnd: (finalWidth) => {
      setDesktopSidebarPreviewWidth(finalWidth)
      window.requestAnimationFrame(() => {
        isLeftSidebarResizing.value = false
      })
    },
  })
}

function workspaceDockRequestQuery() {
  const request = ui.workspaceDockFileRequest
  const targetPath = String(request?.path || '').trim()
  if (!targetPath) return null

  const action = String(request?.action || '')
    .trim()
    .toLowerCase()
  const line = Number(request?.line)
  const column = Number(request?.column)
  const anchor = String(request?.anchor || '').trim()

  if (action === 'reveal') {
    return withEmbeddedWorkspaceScopeQuery(
      {
        gitPath: targetPath,
        gitAction: 'reveal',
        ...(Number.isFinite(line) && line > 0 ? { gitLine: String(Math.floor(line)) } : {}),
        ...(Number.isFinite(column) && column > 0 ? { gitColumn: String(Math.floor(column)) } : {}),
        ...(anchor ? { gitAnchor: anchor } : {}),
      },
      route.query,
    )
  }

  return withEmbeddedWorkspaceScopeQuery(
    {
      filePath: targetPath,
      ...(Number.isFinite(line) && line > 0 ? { fileLine: String(Math.floor(line)) } : {}),
      ...(Number.isFinite(column) && column > 0 ? { fileColumn: String(Math.floor(column)) } : {}),
      ...(anchor ? { fileAnchor: anchor } : {}),
    },
    route.query,
  )
}

function normalizeTemplateSource(source: WorkspaceWindowTemplateDragData): WorkspaceDropSource | null {
  const tab = source.tab
  if (!tab) return null

  const queryRaw = source.query && typeof source.query === 'object' ? source.query : {}
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(queryRaw || {})) {
    const k = String(key || '').trim()
    const v = String(value || '').trim()
    if (!k || !v) continue
    query[k] = v
  }

  const title = String(source.title || '').trim()
  const windowId = String(source.windowId || '').trim()
  const matchKeysRaw = Array.isArray(source.matchKeys) ? source.matchKeys : []
  const matchKeys =
    matchKeysRaw
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .filter((item, idx, list) => list.indexOf(item) === idx) || []

  return {
    kind: 'template',
    tab,
    query,
    ...(title ? { title } : {}),
    ...(windowId ? { windowId } : {}),
    matchKeys: matchKeys.length ? matchKeys : matchKeysForTab(tab),
  }
}

function resolveWorkspaceDropSource(event: DragEvent): WorkspaceDropSource | null {
  const templateSourceRaw = readWorkspaceWindowTemplateFromDataTransfer(event.dataTransfer)
  const templateSource = templateSourceRaw ? normalizeTemplateSource(templateSourceRaw) : null
  if (templateSource?.kind === 'template' && templateSource.windowId) {
    const templateWindow = ui.getWorkspaceWindowById(templateSource.windowId)
    if (templateWindow) {
      return {
        kind: 'window',
        windowId: templateWindow.id,
        tab: templateWindow.mainTab,
        query: templateWindow.routeQuery || {},
        title: String(templateWindow.title || '').trim() || undefined,
        matchKeys: matchKeysForTab(templateWindow.mainTab),
      }
    }
  }

  const sourceWindowId = readDraggedWorkspaceWindowId(event, { hasTemplate: Boolean(templateSource) })
  if (sourceWindowId) {
    const sourceWindow = ui.getWorkspaceWindowById(sourceWindowId)
    if (sourceWindow) {
      return {
        kind: 'window',
        windowId: sourceWindowId,
        tab: sourceWindow.mainTab,
        query: sourceWindow.routeQuery || {},
        title: String(sourceWindow.title || '').trim() || undefined,
        matchKeys: matchKeysForTab(sourceWindow.mainTab),
      }
    }
  }

  return templateSource
}

function clearWorkspacePaneDropVisualState() {
  isWorkspaceDropDragActive.value = false
  workspacePaneDropTarget.value = null
}

function clearWorkspaceDragRuntimeState() {
  clearWorkspacePaneDropVisualState()
  ui.endWorkspaceWindowDrag()
}

function ensureDropSourceWindowId(source: WorkspaceDropSource): string {
  if (source.kind === 'window') {
    return String(source.windowId || '').trim()
  }

  return ui.openWorkspaceWindow(source.tab, {
    activate: false,
    query: source.query,
    title: source.title,
    matchKeys: source.matchKeys,
  })
}

function replacePaneWithDropSource(targetPaneId: string, source: WorkspaceDropSource): boolean {
  const targetGroupId = String(targetPaneId || '').trim()
  if (!targetGroupId) return false
  if (!ui.getWorkspaceGroupById(targetGroupId)) return false

  const sourceWindowId = ensureDropSourceWindowId(source)
  if (!sourceWindowId) return false

  const sourceGroupId = getWorkspaceWindowGroupId(sourceWindowId)
  if (sourceGroupId === targetGroupId) {
    ui.selectWorkspaceGroup(targetGroupId)
    ui.selectWorkspaceWindow(sourceWindowId)
    return true
  }

  return ui.moveWorkspaceWindowToGroup(sourceWindowId, targetGroupId, { activateTargetGroup: true })
}

function insertDropSourceAtPane(
  targetPaneId: string,
  position: Exclude<WorkspaceDropPosition, 'replace'>,
  source: WorkspaceDropSource,
): boolean {
  const targetGroupId = String(targetPaneId || '').trim()
  if (!targetGroupId) return false
  if (!ui.getWorkspaceGroupById(targetGroupId)) return false

  const sourceWindowId = ensureDropSourceWindowId(source)
  if (!sourceWindowId) return false
  if (!ui.getWorkspaceWindowById(sourceWindowId)) return false

  const groupIds = ui.workspaceGroups.map((group) => group.id)
  const targetGroupIndex = groupIds.indexOf(targetGroupId)
  if (targetGroupIndex < 0) return false

  const insertIndex = position === 'before' ? targetGroupIndex : targetGroupIndex + 1
  const sourceGroupId = getWorkspaceWindowGroupId(sourceWindowId)
  const sourceGroup = sourceGroupId ? ui.getWorkspaceGroupById(sourceGroupId) : null
  if (
    source.kind === 'window' &&
    sourceGroup &&
    sourceGroup.tabIds.length === 1 &&
    sourceGroup.tabIds[0] === sourceWindowId
  ) {
    const reordered = ui.moveWorkspaceGroupToIndex(sourceGroup.id, insertIndex)
    if (!reordered) return false
    ui.selectWorkspaceGroup(sourceGroup.id)
    ui.selectWorkspaceWindow(sourceWindowId)
    return true
  }

  const inserted = ui.insertWorkspaceWindowIntoGroupSplit(targetGroupId, sourceWindowId, insertIndex)
  if (!inserted) return false

  ui.selectWorkspaceWindow(sourceWindowId)
  return true
}

function workspacePaneDropZoneClass(paneId: string, position: WorkspaceDropPosition): string {
  const active = workspacePaneDropTarget.value
  const isActive = active?.paneId === paneId && active.position === position
  return isActive
    ? 'border-primary/70 bg-primary/18 text-primary shadow-[inset_0_0_0_1px_rgba(59,130,246,0.28)]'
    : 'border-border/65 bg-background/70 text-muted-foreground'
}

function workspacePaneDropZoneLabel(position: WorkspaceDropPosition): string {
  if (position === 'before') return String(t('header.windowTabs.dropInsertBefore'))
  if (position === 'after') return String(t('header.windowTabs.dropInsertAfter'))
  return String(t('header.windowTabs.dropReplace'))
}

function handleWorkspaceMainDragEnter(event: DragEvent) {
  if (!resolveWorkspaceDropSource(event) && !hasWorkspaceDragDataType(event)) return
  isWorkspaceDropDragActive.value = true
}

function handleWorkspaceMainDragOver(event: DragEvent) {
  const source = resolveWorkspaceDropSource(event)
  if (!source && !hasWorkspaceDragDataType(event)) return

  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = source?.kind === 'window' ? 'move' : 'copy'
  }
  isWorkspaceDropDragActive.value = true
}

function handleWorkspaceMainDragLeave(event: DragEvent) {
  const host = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (host && related && host.contains(related)) return
  // Keep drag session active while dragging across overlay boundaries.
  // DragLeave relatedTarget can be null/unstable on some runtimes.
  workspacePaneDropTarget.value = null
}

function handleWorkspaceMainDrop() {
  clearWorkspaceDragRuntimeState()
}

function handleGlobalWorkspaceDragStart(event: DragEvent) {
  if (!hasWorkspaceDragDataType(event)) return
  isWorkspaceDropDragActive.value = true
}

function handleGlobalWorkspaceDragEnd() {
  clearWorkspaceDragRuntimeState()
}

function handleWorkspacePaneOverlayDragOver(event: DragEvent) {
  const source = resolveWorkspaceDropSource(event)
  if (!source && !hasWorkspaceDragDataType(event)) return

  event.preventDefault()
  event.stopPropagation()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = source?.kind === 'window' ? 'move' : 'copy'
  }

  isWorkspaceDropDragActive.value = true
}

function handleWorkspacePaneOverlayDrop(event: DragEvent) {
  event.preventDefault()
  event.stopPropagation()
  clearWorkspaceDragRuntimeState()
}

function handleGlobalWorkspaceDragTerminateFallback() {
  const hasDragId = Boolean(String(ui.workspaceWindowDragId || '').trim())
  if (!hasDragId && !isWorkspaceDropDragActive.value && !workspacePaneDropTarget.value) return
  clearWorkspaceDragRuntimeState()
}

onMounted(() => {
  window.addEventListener('dragend', handleGlobalWorkspaceDragTerminateFallback, true)
  window.addEventListener('drop', handleGlobalWorkspaceDragTerminateFallback, true)
  window.addEventListener('blur', handleGlobalWorkspaceDragTerminateFallback)
})

function handleWorkspacePaneDropDragOver(event: DragEvent, paneId: string, position: WorkspaceDropPosition) {
  const source = resolveWorkspaceDropSource(event)
  if (!source && !hasWorkspaceDragDataType(event)) return

  const targetId = String(paneId || '').trim()
  if (!targetId) return
  if (!ui.getWorkspaceGroupById(targetId)) return

  event.preventDefault()
  event.stopPropagation()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = source?.kind === 'window' ? 'move' : 'copy'
  }

  isWorkspaceDropDragActive.value = true
  workspacePaneDropTarget.value = {
    paneId: targetId,
    position,
  }
}

function handleWorkspacePaneDropDragLeave(event: DragEvent, paneId: string, position: WorkspaceDropPosition) {
  const host = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (host && related && host.contains(related)) return

  const targetId = String(paneId || '').trim()
  if (!targetId) return

  const active = workspacePaneDropTarget.value
  if (active?.paneId === targetId && active.position === position) {
    workspacePaneDropTarget.value = null
  }
}

async function handleWorkspacePaneDrop(event: DragEvent, paneId: string, position: WorkspaceDropPosition) {
  const source = resolveWorkspaceDropSource(event)
  clearWorkspacePaneDropVisualState()
  ui.endWorkspaceWindowDrag()
  if (!source) return

  event.preventDefault()
  event.stopPropagation()

  const targetId = String(paneId || '').trim()
  if (!targetId) return

  let ok = false
  if (position === 'replace') {
    ok = replacePaneWithDropSource(targetId, source)
  } else {
    ok = insertDropSourceAtPane(targetId, position, source)
  }

  if (!ok) {
    toasts.push('error', String(t('header.windowTabs.splitDropFailed')))
    return
  }

  await syncRouteToActiveWorkspaceWindow()
}

function hasRouteQueryKey(rawQuery: unknown, key: string): boolean {
  if (!rawQuery || typeof rawQuery !== 'object') return false
  return Object.prototype.hasOwnProperty.call(rawQuery, key)
}

function stripSessionWindowKeysFromRouteQuery(rawQuery: unknown): Record<string, unknown> {
  if (!rawQuery || typeof rawQuery !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(rawQuery as Record<string, unknown>)) {
    const normalizedKey = String(key || '')
      .trim()
      .toLowerCase()
    if (!normalizedKey) continue
    if (normalizedKey === 'windowid' || normalizedKey === 'sessionid' || normalizedKey === 'session') continue
    out[key] = value
  }
  return out
}

async function syncRouteToActiveWorkspaceWindow() {
  if (!useWorkspaceWindowLayout.value) return
  if (isEmbeddedWorkspacePane.value || hasEmbeddedWorkspacePaneQuery(route.query)) return

  const target = ui.activeWorkspaceWindow || ui.workspaceWindows[0] || null
  if (!target) return

  const path = TAB_PATHS[target.mainTab] || '/chat'
  const hasAnyQuery = Object.keys(route.query || {}).length > 0
  if (route.path === path && !hasAnyQuery) {
    return
  }

  await router
    .replace({
      path,
    })
    .catch(() => {})
}

watch(
  () => String(ui.activeWorkspaceWindowId || '').trim(),
  (next, prev) => {
    if (!useWorkspaceWindowLayout.value) return
    if (isEmbeddedWorkspacePane.value) return
    if (!next || next === prev) return
    void syncRouteToActiveWorkspaceWindow()
  },
)

watch(
  () => ({
    path: route.path,
    query: route.query,
    embedded: isEmbeddedWorkspacePane.value,
  }),
  ({ path, query, embedded }) => {
    if (!useWorkspaceWindowLayout.value) return
    if (embedded || hasEmbeddedWorkspacePaneQuery(query)) return
    const hasSessionOrWindowQuery =
      hasRouteQueryKey(query, 'windowId') ||
      hasRouteQueryKey(query, 'windowid') ||
      hasRouteQueryKey(query, 'sessionId') ||
      hasRouteQueryKey(query, 'sessionid') ||
      hasRouteQueryKey(query, 'session')
    if (!hasSessionOrWindowQuery) return

    const nextQuery = stripSessionWindowKeysFromRouteQuery(query)
    const hasNextQuery = Object.keys(nextQuery).length > 0
    void router
      .replace({
        path,
        ...(hasNextQuery ? { query: nextQuery } : {}),
      })
      .catch(() => {})
  },
  { immediate: true, deep: true },
)

watch(
  () => showWorkspacePaneDropTargets.value,
  (visible) => {
    if (!visible) {
      clearWorkspacePaneDropVisualState()
    }
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
  () => Number(ui.workspaceDockFileRequestSeq || 0),
  (seq, prev) => {
    if (!Number.isFinite(seq) || seq <= 0 || seq === prev) return
    const nextQuery = workspaceDockRequestQuery()
    if (!nextQuery) return
    void router.push({ path: '/files', query: nextQuery }).catch(() => {})
  },
)
</script>

<template>
  <div
    class="main-content-safe-area relative h-[100dvh] bg-background text-foreground overflow-hidden flex flex-col"
    @dragstart="handleGlobalWorkspaceDragStart"
    @dragend="handleGlobalWorkspaceDragEnd"
  >
    <HelpDialog v-if="!isEmbeddedWorkspacePane" />
    <McpDialog v-if="!isEmbeddedWorkspacePane" />
    <ImageViewerDialog />

    <div class="flex flex-1 flex-col overflow-hidden">
      <AppHeader v-if="!isEmbeddedWorkspacePane" />

      <div class="flex flex-1 overflow-hidden">
        <aside
          v-if="showDesktopSidebarHost"
          ref="desktopSidebarAsideEl"
          class="relative h-full overflow-hidden bg-sidebar"
          :style="{ width: `${desktopSidebarRenderWidth}px` }"
          :class="[
            'border-r border-border',
            isLeftSidebarResizing ? '' : 'transition-[width,border-color] duration-200 ease-out',
          ]"
        >
          <div
            v-if="ui.isSidebarOpen"
            class="absolute right-0 top-0 z-30 h-full w-1 cursor-col-resize hover:bg-primary/40"
            @pointerdown="handleDesktopSidebarResize"
          />

          <div
            :id="WORKSPACE_SIDEBAR_HOST_ID"
            class="relative h-full min-h-0"
            :class="{ 'oc-sidebar-host-resizing': isLeftSidebarResizing }"
          >
            <AppDesktopSidebar :expanded="ui.isSidebarOpen" :resizing="isLeftSidebarResizing" />

            <div
              v-if="ui.isSidebarOpen && isLeftSidebarResizing"
              class="oc-sidebar-resize-overlay pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-3"
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

          <div v-if="showDesktopSidebarHost && !usesChatShellSidebar" class="hidden" aria-hidden="true">
            <router-view />
          </div>

          <main
            class="relative min-h-0 flex-1 overflow-hidden"
            @dragenter="handleWorkspaceMainDragEnter"
            @dragover="handleWorkspaceMainDragOver"
            @dragleave="handleWorkspaceMainDragLeave"
            @drop="handleWorkspaceMainDrop"
            :style="
              ui.isCompactLayout
                ? {
                    paddingBottom: compactBottomInset,
                  }
                : undefined
            "
          >
            <div v-if="isGroupPaneMode" class="relative h-full min-h-0">
              <div v-show="!isAnySidebarResizing" class="h-full min-h-0">
                <MultiPaneHorizontalSplit
                  v-if="isGroupPaneMode"
                  :pane-ids="workspaceGroupPaneIds"
                  :ratios="groupPaneRatios"
                  :min-pane-width="280"
                  @update:ratios="handleGroupPaneRatiosUpdate"
                  @drag-start="handleGroupPaneResizeStart"
                  @drag-end="handleGroupPaneResizeEnd"
                >
                  <template #pane="{ paneId }">
                    <div class="relative h-full min-w-0">
                      <WorkspaceEditorGroupPane
                        v-show="!isGroupPaneResizing"
                        :group-id="paneId"
                        class="h-full min-w-0"
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

                      <div
                        v-if="showWorkspacePaneDropTargets"
                        class="workspace-pane-drop-overlay workspace-pane-drop-overlay--below-tabs pointer-events-none absolute inset-x-0 bottom-0 top-9 z-30 p-2 pt-0"
                        aria-hidden="true"
                      >
                        <div
                          class="pointer-events-auto flex h-full items-stretch gap-2"
                          @dragover="handleWorkspacePaneOverlayDragOver"
                          @drop="handleWorkspacePaneOverlayDrop"
                        >
                          <div
                            class="pointer-events-auto flex min-h-0 w-1/4 items-center justify-center rounded-md border text-center text-[10px] font-medium leading-4 transition-colors"
                            :class="workspacePaneDropZoneClass(paneId, 'before')"
                            @dragover="handleWorkspacePaneDropDragOver($event, paneId, 'before')"
                            @dragleave="handleWorkspacePaneDropDragLeave($event, paneId, 'before')"
                            @drop="void handleWorkspacePaneDrop($event, paneId, 'before')"
                          >
                            {{ workspacePaneDropZoneLabel('before') }}
                          </div>

                          <div
                            class="pointer-events-auto flex min-h-0 flex-1 items-center justify-center rounded-md border text-center text-[10px] font-medium leading-4 transition-colors"
                            :class="workspacePaneDropZoneClass(paneId, 'replace')"
                            @dragover="handleWorkspacePaneDropDragOver($event, paneId, 'replace')"
                            @dragleave="handleWorkspacePaneDropDragLeave($event, paneId, 'replace')"
                            @drop="void handleWorkspacePaneDrop($event, paneId, 'replace')"
                          >
                            {{ workspacePaneDropZoneLabel('replace') }}
                          </div>

                          <div
                            class="pointer-events-auto flex min-h-0 w-1/4 items-center justify-center rounded-md border text-center text-[10px] font-medium leading-4 transition-colors"
                            :class="workspacePaneDropZoneClass(paneId, 'after')"
                            @dragover="handleWorkspacePaneDropDragOver($event, paneId, 'after')"
                            @dragleave="handleWorkspacePaneDropDragLeave($event, paneId, 'after')"
                            @drop="void handleWorkspacePaneDrop($event, paneId, 'after')"
                          >
                            {{ workspacePaneDropZoneLabel('after') }}
                          </div>
                        </div>
                      </div>
                    </div>
                  </template>
                </MultiPaneHorizontalSplit>

                <div v-else-if="isEmbeddedWorkspacePane" class="relative h-full min-h-0">
                  <WorkspacePrimaryPaneView :window-id="activePrimaryWindowId" />

                  <div
                    v-if="showWorkspacePaneDropTargets && selectedWorkspaceGroupId"
                    class="pointer-events-auto absolute inset-0 z-30 flex items-stretch gap-2"
                    aria-hidden="true"
                    @dragover="handleWorkspacePaneOverlayDragOver"
                    @drop="handleWorkspacePaneOverlayDrop"
                  >
                    <div
                      class="pointer-events-auto flex min-h-0 w-1/4 items-center justify-center rounded-md border text-center text-[10px] font-medium leading-4 transition-colors"
                      :class="workspacePaneDropZoneClass(selectedWorkspaceGroupId, 'before')"
                      @dragover="handleWorkspacePaneDropDragOver($event, selectedWorkspaceGroupId, 'before')"
                      @dragleave="handleWorkspacePaneDropDragLeave($event, selectedWorkspaceGroupId, 'before')"
                      @drop="void handleWorkspacePaneDrop($event, selectedWorkspaceGroupId, 'before')"
                    >
                      {{ workspacePaneDropZoneLabel('before') }}
                    </div>

                    <div
                      class="pointer-events-auto flex min-h-0 flex-1 items-center justify-center rounded-md border text-center text-[10px] font-medium leading-4 transition-colors"
                      :class="workspacePaneDropZoneClass(selectedWorkspaceGroupId, 'replace')"
                      @dragover="handleWorkspacePaneDropDragOver($event, selectedWorkspaceGroupId, 'replace')"
                      @dragleave="handleWorkspacePaneDropDragLeave($event, selectedWorkspaceGroupId, 'replace')"
                      @drop="void handleWorkspacePaneDrop($event, selectedWorkspaceGroupId, 'replace')"
                    >
                      {{ workspacePaneDropZoneLabel('replace') }}
                    </div>

                    <div
                      class="pointer-events-auto flex min-h-0 w-1/4 items-center justify-center rounded-md border text-center text-[10px] font-medium leading-4 transition-colors"
                      :class="workspacePaneDropZoneClass(selectedWorkspaceGroupId, 'after')"
                      @dragover="handleWorkspacePaneDropDragOver($event, selectedWorkspaceGroupId, 'after')"
                      @dragleave="handleWorkspacePaneDropDragLeave($event, selectedWorkspaceGroupId, 'after')"
                      @drop="void handleWorkspacePaneDrop($event, selectedWorkspaceGroupId, 'after')"
                    >
                      {{ workspacePaneDropZoneLabel('after') }}
                    </div>
                  </div>
                </div>

                <div v-else class="flex h-full items-center justify-center px-4 text-xs text-muted-foreground">
                  {{ t('header.windowTabs.splitNoContent') }}
                </div>
              </div>

              <div
                v-show="isAnySidebarResizing"
                class="workspace-main-resize-placeholder absolute inset-0 z-20 flex items-center justify-center px-4"
                aria-hidden="true"
              >
                <div class="flex w-full max-w-xs flex-col items-center gap-3 px-4 py-6 text-center">
                  <Skeleton class="h-8 w-8 rounded-full" />
                  <Skeleton class="h-2.5 w-32" />
                  <span class="text-xs font-medium text-muted-foreground">
                    {{ t('header.windowTabs.resizingSidebar') }}
                  </span>
                </div>
              </div>
            </div>

            <div v-else-if="ui.isCompactLayout" class="relative h-full min-h-0">
              <WorkspacePrimaryPaneView :window-id="activePrimaryWindowId" />
            </div>

            <div v-else-if="isEmbeddedWorkspacePane" class="relative h-full min-h-0">
              <WorkspacePrimaryPaneView :window-id="activePrimaryWindowId" />

              <div
                v-if="showWorkspacePaneDropTargets && selectedWorkspaceGroupId"
                class="pointer-events-auto absolute inset-0 z-30 flex items-stretch gap-2"
                aria-hidden="true"
                @dragover="handleWorkspacePaneOverlayDragOver"
                @drop="handleWorkspacePaneOverlayDrop"
              >
                <div
                  class="pointer-events-auto flex min-h-0 w-1/4 items-center justify-center rounded-md border text-center text-[10px] font-medium leading-4 transition-colors"
                  :class="workspacePaneDropZoneClass(selectedWorkspaceGroupId, 'before')"
                  @dragover="handleWorkspacePaneDropDragOver($event, selectedWorkspaceGroupId, 'before')"
                  @dragleave="handleWorkspacePaneDropDragLeave($event, selectedWorkspaceGroupId, 'before')"
                  @drop="void handleWorkspacePaneDrop($event, selectedWorkspaceGroupId, 'before')"
                >
                  {{ workspacePaneDropZoneLabel('before') }}
                </div>

                <div
                  class="pointer-events-auto flex min-h-0 flex-1 items-center justify-center rounded-md border text-center text-[10px] font-medium leading-4 transition-colors"
                  :class="workspacePaneDropZoneClass(selectedWorkspaceGroupId, 'replace')"
                  @dragover="handleWorkspacePaneDropDragOver($event, selectedWorkspaceGroupId, 'replace')"
                  @dragleave="handleWorkspacePaneDropDragLeave($event, selectedWorkspaceGroupId, 'replace')"
                  @drop="void handleWorkspacePaneDrop($event, selectedWorkspaceGroupId, 'replace')"
                >
                  {{ workspacePaneDropZoneLabel('replace') }}
                </div>

                <div
                  class="pointer-events-auto flex min-h-0 w-1/4 items-center justify-center rounded-md border text-center text-[10px] font-medium leading-4 transition-colors"
                  :class="workspacePaneDropZoneClass(selectedWorkspaceGroupId, 'after')"
                  @dragover="handleWorkspacePaneDropDragOver($event, selectedWorkspaceGroupId, 'after')"
                  @dragleave="handleWorkspacePaneDropDragLeave($event, selectedWorkspaceGroupId, 'after')"
                  @drop="void handleWorkspacePaneDrop($event, selectedWorkspaceGroupId, 'after')"
                >
                  {{ workspacePaneDropZoneLabel('after') }}
                </div>
              </div>
            </div>

            <div v-else class="flex h-full items-center justify-center px-4 text-xs text-muted-foreground">
              {{ t('header.windowTabs.splitNoContent') }}
            </div>
          </main>
        </div>
      </div>

      <BottomNav v-if="showBottomNav" />
    </div>
  </div>
</template>

<style>
#workspace-sidebar-host.oc-sidebar-host-resizing > :not(.oc-sidebar-resize-overlay) {
  visibility: hidden;
  pointer-events: none;
}
</style>

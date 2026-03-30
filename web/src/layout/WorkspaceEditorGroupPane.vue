<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  RiChat4Line,
  RiCloseLine,
  RiFolder6Line,
  RiGitMergeLine,
  RiGlobalLine,
  RiSettings3Line,
  RiTerminalBoxLine,
} from '@remixicon/vue'

import { WORKSPACE_MAIN_TABS, type MainTabId } from '@/app/navigation/mainTabs'
import {
  WORKSPACE_WINDOW_DRAG_MIME,
  hasWorkspaceWindowDragDataTransfer,
  readWorkspaceWindowDragIdFromDataTransfer,
  readWorkspaceWindowTemplateFromDataTransfer,
  writeWorkspaceWindowTemplateToDataTransfer,
  type WorkspaceWindowTemplateDragData,
} from '@/layout/workspaceWindowDrag'
import { cn } from '@/lib/utils'
import { readWorkspacePaneFocusWindowId } from '@/app/windowScope'
import { useUiStore, type WorkspaceWindowTab } from '@/stores/ui'

const props = defineProps<{
  groupId: string
}>()

const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const TAB_ICONS: Record<MainTabId, Component> = {
  chat: RiChat4Line,
  files: RiFolder6Line,
  preview: RiGlobalLine,
  terminal: RiTerminalBoxLine,
  git: RiGitMergeLine,
  settings: RiSettings3Line,
}

const TAB_PATHS = WORKSPACE_MAIN_TABS.reduce(
  (acc, item) => {
    acc[item.id] = item.path
    return acc
  },
  {} as Record<MainTabId, string>,
)

const TAB_LABEL_KEYS = WORKSPACE_MAIN_TABS.reduce(
  (acc, item) => {
    acc[item.id] = item.labelKey
    return acc
  },
  {} as Record<MainTabId, string>,
)

const windowMap = computed(() => {
  const out = new Map<string, WorkspaceWindowTab>()
  for (const item of ui.workspaceWindows) {
    out.set(item.id, item)
  }
  return out
})

const group = computed(() => ui.getWorkspaceGroupById(props.groupId))

const groupTabs = computed<WorkspaceWindowTab[]>(() => {
  const target = group.value
  if (!target) return []
  const out: WorkspaceWindowTab[] = []
  for (const tabId of target.tabIds) {
    const item = windowMap.value.get(String(tabId || '').trim())
    if (item) out.push(item)
  }
  return out
})

const activeWindow = computed<WorkspaceWindowTab | null>(() => {
  const target = group.value
  const tabs = groupTabs.value
  if (!target || !tabs.length) return null

  const preferredId = String(target.activeWindowId || '').trim()
  if (preferredId) {
    const matched = tabs.find((item) => item.id === preferredId)
    if (matched) return matched
  }

  return tabs[0] || null
})

const activeWindowId = computed(() => String(activeWindow.value?.id || '').trim())
const canDragTabs = computed(() => !ui.isCompactLayout)
const isTabStripDropActive = ref(false)
const frameEl = ref<HTMLIFrameElement | null>(null)
let clearFrameFocusBridge: (() => void) | null = null

function clearFrameFocusListeners() {
  clearFrameFocusBridge?.()
  clearFrameFocusBridge = null
}

function resolvePaneFocusWindowId(): string {
  const target = group.value
  if (!target) return ''
  const preferredId = String(target.activeWindowId || '').trim()
  if (preferredId && target.tabIds.includes(preferredId)) return preferredId
  return String(target.tabIds[0] || '').trim()
}

function focusPaneWindow(windowId?: string) {
  const requestedWindowId = String(windowId || '').trim()
  const hasRequestedWindow = requestedWindowId
    ? groupTabs.value.some((item) => String(item.id || '').trim() === requestedWindowId)
    : false

  const targetWindowId = hasRequestedWindow ? requestedWindowId : resolvePaneFocusWindowId()
  if (!targetWindowId) return
  if (String(ui.focusedWorkspaceWindowId || '').trim() === targetWindowId) return
  ui.setFocusedWorkspaceWindow(targetWindowId)
}

function handlePanePointerDown() {
  focusPaneWindow()
}

function bindFrameFocusListeners() {
  clearFrameFocusListeners()

  const frame = frameEl.value
  if (!frame) return

  try {
    const frameWindow = frame.contentWindow
    const frameDocument = frame.contentDocument
    if (!frameWindow || !frameDocument) return

    const handleFramePointerDown = () => {
      focusPaneWindow()
    }
    const handleFrameFocusIn = () => {
      focusPaneWindow()
    }

    frameWindow.addEventListener('pointerdown', handleFramePointerDown, true)
    frameWindow.addEventListener('mousedown', handleFramePointerDown, true)
    frameDocument.addEventListener('focusin', handleFrameFocusIn, true)

    clearFrameFocusBridge = () => {
      frameWindow.removeEventListener('pointerdown', handleFramePointerDown, true)
      frameWindow.removeEventListener('mousedown', handleFramePointerDown, true)
      frameDocument.removeEventListener('focusin', handleFrameFocusIn, true)
    }
  } catch {
    clearFrameFocusBridge = null
  }
}

function handleFrameLoad() {
  bindFrameFocusListeners()
}

function handleWorkspacePaneFocusMessage(event: MessageEvent) {
  if (event.origin !== window.location.origin) return

  const targetWindowId = readWorkspacePaneFocusWindowId(event.data)
  if (!targetWindowId) return
  if (!groupTabs.value.some((tab) => tab.id === targetWindowId)) return

  focusPaneWindow(targetWindowId)
}

onMounted(() => {
  window.addEventListener('message', handleWorkspacePaneFocusMessage)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', handleWorkspacePaneFocusMessage)
  clearFrameFocusListeners()
})

function tabLabel(tab: MainTabId): string {
  return String(t(TAB_LABEL_KEYS[tab]))
}

function windowTitle(windowTab: WorkspaceWindowTab): string {
  const customTitle = String(windowTab.title || '').trim()
  if (customTitle) return customTitle

  const base = tabLabel(windowTab.mainTab)
  const siblings = groupTabs.value.filter((item) => item.mainTab === windowTab.mainTab)
  if (siblings.length <= 1) return base
  const idx = siblings.findIndex((item) => item.id === windowTab.id)
  if (idx < 0) return base
  return `${base} ${idx + 1}`
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

async function navigateToWindow(windowId: string, replace = true) {
  const target = ui.getWorkspaceWindowById(windowId)
  if (!target) return

  const path = TAB_PATHS[target.mainTab] || '/chat'
  const currentQuery = normalizeQueryRecord(route.query)
  const targetQuery = target.routeQuery || {}
  const currentWindowId = String(route.query?.windowId || route.query?.windowid || '').trim()
  if (route.path === path && areQueriesEqual(currentQuery, targetQuery) && currentWindowId === target.id) return

  const query = toRouteQuery({
    ...targetQuery,
    windowId: target.id,
  })
  const payload = {
    path,
    ...(query ? { query } : {}),
  }

  if (replace) {
    await router.replace(payload).catch(() => {})
    return
  }

  await router.push(payload).catch(() => {})
}

function getWorkspaceWindowGroupId(windowId: string): string {
  const targetId = String(windowId || '').trim()
  if (!targetId) return ''
  for (const item of ui.workspaceGroups) {
    if (item.tabIds.includes(targetId)) return item.id
  }
  return ''
}

function matchKeysForTab(tab: MainTabId): string[] {
  if (tab === 'chat') return ['sessionId']
  if (tab === 'files') return ['filePath']
  return []
}

function normalizeTemplateSource(source: WorkspaceWindowTemplateDragData): WorkspaceWindowTemplateDragData | null {
  const tab = source.tab
  if (!tab) return null

  const windowId = String(source.windowId || '').trim()
  const queryRaw = source.query && typeof source.query === 'object' ? source.query : {}
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(queryRaw || {})) {
    const k = String(key || '').trim()
    const v = String(value || '').trim()
    if (!k || !v) continue
    query[k] = v
  }

  const title = String(source.title || '').trim()
  const matchKeysRaw = Array.isArray(source.matchKeys) ? source.matchKeys : []
  const matchKeys =
    matchKeysRaw
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .filter((item, idx, list) => list.indexOf(item) === idx) || []

  return {
    tab,
    ...(windowId ? { windowId } : {}),
    ...(Object.keys(query).length ? { query } : {}),
    ...(title ? { title } : {}),
    matchKeys: matchKeys.length ? matchKeys : matchKeysForTab(tab),
  }
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

type GroupDropSource =
  | {
      kind: 'window'
      windowId: string
    }
  | {
      kind: 'template'
      data: WorkspaceWindowTemplateDragData
    }

function resolveGroupDropSource(event: DragEvent): GroupDropSource | null {
  const rawTemplate = readWorkspaceWindowTemplateFromDataTransfer(event.dataTransfer)
  const normalizedTemplate = rawTemplate ? normalizeTemplateSource(rawTemplate) : null
  const templateWindowId = String(normalizedTemplate?.windowId || '').trim()
  if (templateWindowId && ui.getWorkspaceWindowById(templateWindowId)) {
    return {
      kind: 'window',
      windowId: templateWindowId,
    }
  }

  const sourceWindowId = readDraggedWorkspaceWindowId(event, { hasTemplate: Boolean(normalizedTemplate) })
  if (sourceWindowId && ui.getWorkspaceWindowById(sourceWindowId)) {
    return {
      kind: 'window',
      windowId: sourceWindowId,
    }
  }

  if (!normalizedTemplate) return null

  return {
    kind: 'template',
    data: normalizedTemplate,
  }
}

function isWindowActive(windowId: string): boolean {
  return String(windowId || '').trim() === activeWindowId.value
}

function isWindowFocused(windowId: string): boolean {
  return String(windowId || '').trim() === String(ui.focusedWorkspaceWindowId || '').trim()
}

function tabClass(windowId: string): string {
  const active = isWindowActive(windowId)
  const focused = isWindowFocused(windowId)
  return cn(
    'group flex min-w-[140px] max-w-[240px] select-none items-center rounded-md border transition-colors cursor-default active:cursor-grabbing',
    active
      ? focused
        ? 'border-primary/50 bg-background text-foreground shadow-[0_1px_0_rgba(0,0,0,0.1)]'
        : 'border-border/70 bg-secondary/40 text-foreground/85'
      : 'border-transparent bg-transparent text-muted-foreground hover:border-border/60 hover:bg-secondary/60 hover:text-foreground',
  )
}

const frameSrc = computed(() => {
  const tab = activeWindow.value
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

async function activateTab(windowId: string) {
  const targetId = String(windowId || '').trim()
  const groupId = String(props.groupId || '').trim()
  if (!targetId || !groupId) return

  ui.selectWorkspaceGroup(groupId)
  ui.selectWorkspaceWindow(targetId)
  await navigateToWindow(targetId, true)
}

async function closeTab(windowId: string) {
  const targetId = String(windowId || '').trim()
  if (!targetId) return

  const wasRouteActive = String(ui.activeWorkspaceWindowId || '').trim() === targetId
  ui.closeWorkspaceWindow(targetId)

  if (!wasRouteActive) return
  const fallback = ui.activeWorkspaceWindow || ui.workspaceWindows[0] || null
  if (!fallback) return
  await navigateToWindow(fallback.id, true)
}

function clearTabStripDropState() {
  isTabStripDropActive.value = false
}

function handleTabDragStart(event: DragEvent, windowId: string) {
  if (!canDragTabs.value) {
    event.preventDefault()
    return
  }

  const id = String(windowId || '').trim()
  if (!id) return

  ui.beginWorkspaceWindowDrag(id)

  const transfer = event.dataTransfer
  if (!transfer) return
  transfer.effectAllowed = 'move'

  const source = ui.getWorkspaceWindowById(id)
  const wroteTemplate = source
    ? writeWorkspaceWindowTemplateToDataTransfer(transfer, {
        tab: source.mainTab,
        query: source.routeQuery,
        title: String(source.title || '').trim() || undefined,
        matchKeys: matchKeysForTab(source.mainTab),
        windowId: id,
      })
    : false

  try {
    transfer.setData(WORKSPACE_WINDOW_DRAG_MIME, id)
  } catch {
    // Ignore runtime restrictions on custom MIME writes.
  }

  if (!wroteTemplate) {
    try {
      transfer.setData('text/plain', id)
    } catch {
      // Ignore plain-text write failures when custom MIME is available.
    }
  }
}

function handleTabDragEnd(_event: DragEvent) {
  ui.endWorkspaceWindowDrag()
  clearTabStripDropState()
}

function handleTabStripDragOver(event: DragEvent) {
  const source = resolveGroupDropSource(event)
  if (!source && !hasWorkspaceDragDataType(event)) return

  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = source?.kind === 'window' ? 'move' : 'copy'
  }
  isTabStripDropActive.value = true
}

function handleTabStripDragLeave(event: DragEvent) {
  if (!isTabStripDropActive.value) return
  const host = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (host && related && host.contains(related)) return
  clearTabStripDropState()
}

async function handleTabStripDrop(event: DragEvent) {
  const targetGroupId = String(props.groupId || '').trim()
  const source = resolveGroupDropSource(event)

  clearTabStripDropState()
  ui.endWorkspaceWindowDrag()

  if (!targetGroupId || !source) return

  event.preventDefault()

  let sourceWindowId = ''
  if (source.kind === 'window') {
    sourceWindowId = source.windowId
  } else {
    sourceWindowId = ui.openWorkspaceWindow(source.data.tab, {
      activate: false,
      query: source.data.query,
      title: source.data.title,
      matchKeys: source.data.matchKeys,
      reuseExisting: false,
    })
  }

  if (!sourceWindowId) return

  const sourceGroupId = getWorkspaceWindowGroupId(sourceWindowId)
  if (sourceGroupId !== targetGroupId) {
    const moved = ui.moveWorkspaceWindowToGroup(sourceWindowId, targetGroupId, { activateTargetGroup: true })
    if (!moved) return
  } else {
    ui.selectWorkspaceGroup(targetGroupId)
    ui.selectWorkspaceWindow(sourceWindowId)
  }

  await navigateToWindow(sourceWindowId, true)
}
</script>

<template>
  <section
    class="app-region-no-drag flex h-full min-h-0 flex-col border-l border-border/60 bg-background"
    @pointerdown.capture="handlePanePointerDown"
  >
    <div
      class="relative min-h-0 border-b border-border/60 bg-secondary/20 px-1.5 py-1"
      :class="isTabStripDropActive ? 'bg-primary/10 ring-1 ring-inset ring-primary/50' : ''"
      @dragover="handleTabStripDragOver"
      @dragleave="handleTabStripDragLeave"
      @drop="void handleTabStripDrop($event)"
    >
      <div class="flex min-w-0 items-center gap-1 overflow-x-auto">
        <div
          v-for="windowTab in groupTabs"
          :key="`${groupId}:${windowTab.id}`"
          :class="tabClass(windowTab.id)"
          :draggable="canDragTabs"
          role="button"
          tabindex="0"
          :title="windowTitle(windowTab)"
          @click="void activateTab(windowTab.id)"
          @keydown.enter.prevent="void activateTab(windowTab.id)"
          @keydown.space.prevent="void activateTab(windowTab.id)"
          @dragstart="handleTabDragStart($event, windowTab.id)"
          @dragend="handleTabDragEnd($event)"
        >
          <div class="flex min-w-0 flex-1 select-none items-center gap-2 px-2 py-1.5 text-left">
            <component :is="TAB_ICONS[windowTab.mainTab]" class="h-3.5 w-3.5 flex-shrink-0" />
            <span class="truncate text-[12px] font-medium">{{ windowTitle(windowTab) }}</span>
          </div>

          <button
            type="button"
            class="mr-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-secondary/80 hover:text-foreground"
            :class="isWindowActive(windowTab.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
            :title="String(t('header.windowTabs.closeCurrent'))"
            :aria-label="String(t('header.windowTabs.closeCurrent'))"
            @click.stop="void closeTab(windowTab.id)"
          >
            <RiCloseLine class="h-3.5 w-3.5" />
          </button>
        </div>

        <div v-if="!groupTabs.length" class="px-2 py-1 text-[11px] text-muted-foreground">
          {{ t('header.windowTabs.splitNoContent') }}
        </div>
      </div>

      <div
        v-if="isTabStripDropActive"
        class="workspace-tab-strip-drop-overlay pointer-events-none absolute inset-x-1.5 inset-y-1 flex items-center justify-center rounded-md border border-dashed border-primary/50 bg-primary/10"
        aria-hidden="true"
      >
        <span class="px-2 text-[10px] font-medium text-primary">
          {{ t('header.windowTabs.dropIntoTabs') }}
        </span>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-hidden bg-background">
      <iframe v-if="frameSrc" ref="frameEl" :src="frameSrc" class="h-full w-full border-0" @load="handleFrameLoad" />
      <div v-else class="flex h-full items-center justify-center px-4 text-xs text-muted-foreground">
        {{ t('header.windowTabs.splitNoContent') }}
      </div>
    </div>
  </section>
</template>

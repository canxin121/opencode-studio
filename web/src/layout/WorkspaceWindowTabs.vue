<script setup lang="ts">
import { computed, ref, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  RiAddLine,
  RiChat4Line,
  RiCloseLine,
  RiFolder6Line,
  RiGitMergeLine,
  RiGlobalLine,
  RiMore2Line,
  RiTerminalBoxLine,
} from '@remixicon/vue'

import OptionMenu from '@/components/ui/OptionMenu.vue'
import type { OptionMenuGroup, OptionMenuItem } from '@/components/ui/optionMenu.types'
import { MAIN_TABS, type MainTabId } from '@/app/navigation/mainTabs'
import { WORKSPACE_WINDOW_DRAG_MIME, readWorkspaceWindowDragIdFromDataTransfer } from '@/layout/workspaceWindowDrag'
import { cn } from '@/lib/utils'
import { useUiStore, type WorkspaceWindowGroup, type WorkspaceWindowTab } from '@/stores/ui'

const ui = useUiStore()
const router = useRouter()
const route = useRoute()
const { t } = useI18n()

const TAB_ICONS: Record<MainTabId, Component> = {
  chat: RiChat4Line,
  files: RiFolder6Line,
  preview: RiGlobalLine,
  terminal: RiTerminalBoxLine,
  git: RiGitMergeLine,
}

const TAB_PATHS = MAIN_TABS.reduce(
  (acc, item) => {
    acc[item.id] = item.path
    return acc
  },
  {} as Record<MainTabId, string>,
)

const TAB_LABEL_KEYS = MAIN_TABS.reduce(
  (acc, item) => {
    acc[item.id] = item.labelKey
    return acc
  },
  {} as Record<MainTabId, string>,
)

const groups = computed(() => ui.workspaceGroups)
const windows = computed(() => ui.workspaceWindows)
const selectedGroupId = computed(() => String(ui.activeWorkspaceGroupId || '').trim())
const activeWindowId = computed(() => String(ui.activeWorkspaceWindowId || '').trim())
const groupDropTargetId = ref('')
const replaceDropTargetId = ref('')
const ungroupDropActive = ref(false)
const draggedWindowId = computed(() => String(ui.workspaceWindowDragId || '').trim())
const isWindowDragActive = computed(() => Boolean(draggedWindowId.value))
const groupMenuOpen = ref(false)
const groupMenuAnchorEl = ref<HTMLElement | null>(null)
const groupMenuTargetGroupId = ref('')

const GROUP_MENU_ACTION_TOGGLE = 'toggle-collapse'
const GROUP_MENU_ACTION_EQUALIZE = 'equalize-split'
const GROUP_MENU_ACTION_CLOSE = 'close-group'

const windowsById = computed(() => {
  const map = new Map<string, WorkspaceWindowTab>()
  for (const item of windows.value) {
    map.set(item.id, item)
  }
  return map
})

const groupedWindowIds = computed(() => {
  const ids = new Set<string>()
  for (const group of groups.value) {
    for (const id of group.tabIds || []) {
      ids.add(String(id || '').trim())
    }
  }
  return ids
})

const ungroupedWindows = computed(() => {
  const grouped = groupedWindowIds.value
  return windows.value.filter((item) => !grouped.has(item.id))
})

const isGroupedDragSource = computed(() => Boolean(getWindowGroupId(draggedWindowId.value)))
const selectedUngroupedWindowId = computed(() => {
  if (selectedGroupId.value) return ''
  const activeId = activeWindowId.value
  if (!activeId) return ''
  if (getWindowGroupId(activeId)) return ''
  return activeId
})

function groupTabs(group: WorkspaceWindowGroup): WorkspaceWindowTab[] {
  const map = windowsById.value
  const out: WorkspaceWindowTab[] = []
  for (const id of group.tabIds || []) {
    const item = map.get(String(id || '').trim())
    if (item) out.push(item)
  }
  return out
}

function tabLabel(tab: MainTabId): string {
  return String(t(TAB_LABEL_KEYS[tab]))
}

function windowTitle(windowTab: WorkspaceWindowTab): string {
  const customTitle = String(windowTab.title || '').trim()
  if (customTitle) return customTitle

  const base = tabLabel(windowTab.mainTab)
  if (windowTab.mainTab === 'chat') {
    const sid = String(windowTab.routeQuery?.sessionId || '').trim()
    if (sid) return `${base} · ${sid.slice(0, 8)}`
  }
  const siblings = windows.value.filter((item) => item.mainTab === windowTab.mainTab)
  if (siblings.length <= 1) return base
  const idx = siblings.findIndex((item) => item.id === windowTab.id)
  if (idx < 0) return base
  return `${base} ${idx + 1}`
}

function normalizeQueryValue(raw: unknown): string | undefined {
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const normalized = normalizeQueryValue(item)
      if (normalized) return normalized
    }
    return undefined
  }
  if (raw === null || typeof raw === 'undefined') return undefined
  const text = String(raw).trim()
  return text || undefined
}

function normalizeQueryRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const k = String(key || '').trim()
    if (!k || k === 'windowId' || k === 'windowid' || k === 'ocEmbed') continue
    const normalized = normalizeQueryValue(value)
    if (!normalized) continue
    out[k] = normalized
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

function toRouteQuery(query: Record<string, string>): Record<string, string> | undefined {
  const entries = Object.entries(query || {})
  if (!entries.length) return undefined
  return Object.fromEntries(entries)
}

function resolveTargetWindow(targetId?: string | null): WorkspaceWindowTab | null {
  const preferred = String(targetId || '').trim()
  if (preferred) {
    const matched = windows.value.find((item) => item.id === preferred)
    if (matched) return matched
  }
  return ui.activeWorkspaceWindow || windows.value[0] || null
}

async function navigateToWindow(windowId: string, replace = true) {
  const target = resolveTargetWindow(windowId)
  if (!target) return

  ui.activateWorkspaceWindow(target.id)

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

async function syncRouteToActiveWindow() {
  const target = resolveTargetWindow(ui.activeWorkspaceWindowId)
  if (!target) return
  await navigateToWindow(target.id, true)
}

function hexToRgb(color: string): { r: number; g: number; b: number } | null {
  const value = String(color || '').trim()
  const matched = /^#([0-9a-fA-F]{6})$/.exec(value)
  if (!matched) return null
  const hex = matched[1]
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null
  return { r, g, b }
}

function rgba(color: string, alpha: number): string {
  const rgb = hexToRgb(color)
  if (!rgb) return color
  const a = Math.max(0, Math.min(1, alpha))
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`
}

function groupMarkerStyle(group: WorkspaceWindowGroup): Record<string, string> {
  const isSelected = selectedGroupId.value === String(group.id || '').trim()
  const color = String(group.color || '').trim() || '#60a5fa'
  return {
    backgroundColor: rgba(color, isSelected ? 0.94 : 0.2),
    borderColor: rgba(color, isSelected ? 0.98 : 0.56),
    color: isSelected ? 'rgba(255, 255, 255, 0.98)' : rgba(color, 0.96),
    boxShadow: isSelected
      ? `0 1px 0 ${rgba(color, 0.38)}, inset 0 -1px 0 rgba(0, 0, 0, 0.18)`
      : `inset 0 0 0 1px ${rgba(color, 0.26)}`,
  }
}

function groupUnderlineStyle(group: WorkspaceWindowGroup): Record<string, string> {
  const isSelected = selectedGroupId.value === String(group.id || '').trim()
  const color = String(group.color || '').trim() || '#60a5fa'
  return {
    backgroundColor: rgba(color, isSelected ? 0.94 : 0.58),
    boxShadow: isSelected ? `0 0 0 1px ${rgba(color, 0.22)}` : 'none',
  }
}

function groupUnderlineClass(groupId: string): string {
  const isSelected = selectedGroupId.value === String(groupId || '').trim()
  return cn(
    'pointer-events-none absolute inset-x-0 -bottom-[3px] rounded-full transition-all',
    isSelected ? 'h-[3px]' : 'h-[2px]',
  )
}

function groupClass(groupId: string): string {
  const isDropTarget = isWindowDragActive.value && groupDropTargetId.value === groupId
  return cn(
    'group relative flex items-center gap-1 px-0.5 pb-1 pt-0.5 transition-colors',
    isDropTarget ? 'rounded-md bg-primary/10 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.56)]' : '',
  )
}

async function createGroup() {
  ui.createWorkspaceGroup()
}

async function closeGroup(groupId: string) {
  const targetId = String(groupId || '').trim()
  if (!targetId) return
  ui.closeWorkspaceGroup(targetId)
}

function toggleGroupCollapsed(groupId: string) {
  const targetId = String(groupId || '').trim()
  if (!targetId) return
  ui.toggleWorkspaceGroupCollapsed(targetId)
}

const groupMenuGroups = computed<OptionMenuGroup[]>(() => {
  const group = groups.value.find((item) => item.id === groupMenuTargetGroupId.value)
  if (!group) return []

  const toggleLabel = group.collapsed
    ? String(t('header.windowTabs.expandGroup'))
    : String(t('header.windowTabs.collapseGroup'))

  return [
    {
      id: 'group-actions',
      items: [
        {
          id: GROUP_MENU_ACTION_TOGGLE,
          label: toggleLabel,
        },
        {
          id: GROUP_MENU_ACTION_EQUALIZE,
          label: String(t('header.windowTabs.equalizeSplit')),
          disabled: group.splitWindowIds.length < 2,
        },
        {
          id: GROUP_MENU_ACTION_CLOSE,
          label: String(t('header.windowTabs.closeGroup')),
          variant: 'destructive',
        },
      ],
    },
  ]
})

function setGroupMenuOpen(next: boolean) {
  groupMenuOpen.value = next
  if (next) return
  groupMenuTargetGroupId.value = ''
  groupMenuAnchorEl.value = null
}

function openGroupMenu(groupId: string, event: MouseEvent) {
  const targetId = String(groupId || '').trim()
  if (!targetId) return
  if (!groups.value.some((item) => item.id === targetId)) return

  selectGroup(targetId)
  groupMenuTargetGroupId.value = targetId
  groupMenuAnchorEl.value = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  groupMenuOpen.value = true
}

function handleGroupMenuSelect(item: OptionMenuItem) {
  const groupId = String(groupMenuTargetGroupId.value || '').trim()
  const group = groups.value.find((entry) => entry.id === groupId)
  if (!group) return

  if (item.id === GROUP_MENU_ACTION_TOGGLE) {
    toggleGroupCollapsed(group.id)
    return
  }

  if (item.id === GROUP_MENU_ACTION_EQUALIZE) {
    if (group.splitWindowIds.length < 2) return
    ui.setWorkspaceGroupSplitPaneRatios(
      group.id,
      group.splitWindowIds.map(() => 1),
    )
    return
  }

  if (item.id === GROUP_MENU_ACTION_CLOSE) {
    void closeGroup(group.id)
  }
}

function selectGroup(groupId: string) {
  const targetId = String(groupId || '').trim()
  if (!targetId) return
  ui.selectWorkspaceGroup(targetId)
}

function getWindowGroupId(windowId: string): string {
  const target = String(windowId || '').trim()
  if (!target) return ''
  for (const group of groups.value) {
    if (group.tabIds.includes(target)) return group.id
  }
  return ''
}

async function activateWindow(windowId: string) {
  const targetId = String(windowId || '').trim()
  if (!targetId) return

  const groupId = getWindowGroupId(targetId)
  if (groupId) {
    ui.selectWorkspaceGroup(groupId)
    ui.ensureWorkspaceWindowInGroupSplit(groupId, targetId)
  }
  if (!groupId) {
    ui.selectWorkspaceWindow(targetId)
  }

  ui.activateWorkspaceWindow(targetId)
  await navigateToWindow(targetId, true)
}

async function closeWindow(windowId: string) {
  const targetId = String(windowId || '').trim()
  if (!targetId) return
  const wasRouteActive = ui.activeWorkspaceWindowId === targetId
  ui.closeWorkspaceWindow(targetId)
  if (wasRouteActive) {
    await syncRouteToActiveWindow()
  }
}

function readDraggedWorkspaceWindowId(event: DragEvent): string {
  const fromStore = draggedWindowId.value
  if (fromStore) return fromStore
  return readWorkspaceWindowDragIdFromDataTransfer(event.dataTransfer)
}

function clearTabReplaceDropTarget() {
  replaceDropTargetId.value = ''
}

function clearGroupDropTarget() {
  groupDropTargetId.value = ''
}

function clearUngroupDropTarget() {
  ungroupDropActive.value = false
}

function handleGroupDragOver(event: DragEvent, targetGroupId: string) {
  const sourceWindowId = readDraggedWorkspaceWindowId(event)
  const destinationGroupId = String(targetGroupId || '').trim()
  if (!sourceWindowId || !destinationGroupId) return

  const sourceGroupId = getWindowGroupId(sourceWindowId)
  if (sourceGroupId && sourceGroupId === destinationGroupId) return

  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  groupDropTargetId.value = destinationGroupId
}

function handleGroupDragLeave(event: DragEvent, targetGroupId: string) {
  const destinationGroupId = String(targetGroupId || '').trim()
  if (!destinationGroupId || groupDropTargetId.value !== destinationGroupId) return
  const host = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (host && related && host.contains(related)) return
  groupDropTargetId.value = ''
}

async function handleGroupDrop(event: DragEvent, targetGroupId: string) {
  const sourceWindowId = readDraggedWorkspaceWindowId(event)
  const destinationGroupId = String(targetGroupId || '').trim()

  clearGroupDropTarget()
  clearTabReplaceDropTarget()
  ui.endWorkspaceWindowDrag()

  if (!sourceWindowId || !destinationGroupId) return

  event.preventDefault()

  const moved = ui.moveWorkspaceWindowToGroup(sourceWindowId, destinationGroupId, {
    activateTargetGroup: false,
  })
  if (!moved) return

  ui.selectWorkspaceGroup(destinationGroupId)

  const destination = ui.getWorkspaceGroupById(destinationGroupId)
  if (destination?.collapsed) {
    ui.setWorkspaceGroupCollapsed(destinationGroupId, false)
  }
}

function handleUngroupedDragOver(event: DragEvent) {
  const sourceWindowId = readDraggedWorkspaceWindowId(event)
  if (!sourceWindowId) return
  if (!getWindowGroupId(sourceWindowId)) return

  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  ungroupDropActive.value = true
}

function handleUngroupedDragLeave(event: DragEvent) {
  if (!ungroupDropActive.value) return
  const host = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (host && related && host.contains(related)) return
  ungroupDropActive.value = false
}

function handleUngroupedDrop(event: DragEvent) {
  const sourceWindowId = readDraggedWorkspaceWindowId(event)

  clearUngroupDropTarget()
  clearGroupDropTarget()
  clearTabReplaceDropTarget()
  ui.endWorkspaceWindowDrag()

  if (!sourceWindowId) return
  if (!getWindowGroupId(sourceWindowId)) return

  event.preventDefault()
  ui.ungroupWorkspaceWindow(sourceWindowId)
}

function handleTabDragStart(event: DragEvent, windowId: string) {
  const id = String(windowId || '').trim()
  if (!id) return

  ui.beginWorkspaceWindowDrag(id)

  const transfer = event.dataTransfer
  if (!transfer) return
  transfer.effectAllowed = 'move'
  transfer.setData(WORKSPACE_WINDOW_DRAG_MIME, id)
  transfer.setData('text/plain', id)
}

function handleTabDragEnd(_event: DragEvent, windowId: string) {
  ui.endWorkspaceWindowDrag(windowId)
  clearGroupDropTarget()
  clearTabReplaceDropTarget()
  clearUngroupDropTarget()
}

function handleTabDragOver(event: DragEvent, targetWindowId: string) {
  const sourceId = readDraggedWorkspaceWindowId(event)
  const targetId = String(targetWindowId || '').trim()
  if (!sourceId || !targetId || sourceId === targetId) return

  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  replaceDropTargetId.value = targetId
}

function handleTabDragLeave(event: DragEvent, targetWindowId: string) {
  const targetId = String(targetWindowId || '').trim()
  if (!targetId || replaceDropTargetId.value !== targetId) return
  const host = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (host && related && host.contains(related)) return
  replaceDropTargetId.value = ''
}

async function handleTabDrop(event: DragEvent, targetWindowId: string) {
  const sourceId = readDraggedWorkspaceWindowId(event)
  const targetId = String(targetWindowId || '').trim()

  clearGroupDropTarget()
  clearTabReplaceDropTarget()
  ui.endWorkspaceWindowDrag()

  if (!sourceId || !targetId || sourceId === targetId) return

  event.preventDefault()

  const sourceWasRouteActive = ui.activeWorkspaceWindowId === sourceId
  const targetWasSplit = ui.isWorkspaceWindowInSplit(targetId)
  const replaced = ui.replaceWorkspaceWindowContent(targetId, sourceId, {
    closeSource: true,
    activateTarget: !targetWasSplit,
  })
  if (!replaced) return

  ui.activateWorkspaceWindow(targetId)

  if (targetWasSplit) {
    if (sourceWasRouteActive) {
      await syncRouteToActiveWindow()
    }
    return
  }

  await navigateToWindow(targetId, true)
}

function isWindowActive(windowId: string): boolean {
  const id = String(windowId || '').trim()
  if (!id) return false
  if (selectedGroupId.value) return false
  return selectedUngroupedWindowId.value === id
}

function windowTabClass(windowTab: WorkspaceWindowTab): string {
  const active = isWindowActive(windowTab.id)
  const isReplaceDropTarget = isWindowDragActive.value && replaceDropTargetId.value === windowTab.id
  return cn(
    'group flex items-center min-w-[132px] max-w-[220px] rounded-lg border transition-colors',
    active
      ? 'border-primary/45 bg-secondary/80 text-foreground shadow-[0_1px_0_rgba(0,0,0,0.12)]'
      : 'border-border/55 bg-background/70 text-muted-foreground hover:border-border hover:bg-secondary/45 hover:text-foreground',
    isReplaceDropTarget ? 'border-primary/70 bg-primary/10 text-foreground ring-1 ring-primary/50' : '',
  )
}

function closeButtonClass(windowTab: WorkspaceWindowTab): string {
  return cn(
    'mr-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-secondary/80 hover:text-foreground',
    isWindowActive(windowTab.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
  )
}

const ungroupedZoneClass = computed(() =>
  cn(
    'flex min-w-0 items-center gap-1 rounded-lg border px-1 py-1 transition-colors',
    isWindowDragActive.value && isGroupedDragSource.value ? 'border-dashed border-border/60' : 'border-transparent',
    ungroupDropActive.value ? 'border-primary/70 bg-primary/10 ring-1 ring-primary/50' : '',
  ),
)
</script>

<template>
  <div class="app-region-no-drag border-b border-border/50 bg-secondary/20">
    <div class="flex items-center gap-2 px-2 py-1.5">
      <div class="min-w-0 flex-1 overflow-x-auto">
        <div class="flex min-w-max items-center gap-2 pr-2">
          <div
            :class="ungroupedZoneClass"
            :title="String(t('header.windowTabs.ungroupDrop'))"
            @dragover="handleUngroupedDragOver"
            @dragleave="handleUngroupedDragLeave"
            @drop="handleUngroupedDrop"
          >
            <div
              v-for="windowTab in ungroupedWindows"
              :key="`ungrouped:${windowTab.id}`"
              :class="windowTabClass(windowTab)"
              @dragover="handleTabDragOver($event, windowTab.id)"
              @dragleave="handleTabDragLeave($event, windowTab.id)"
              @drop="void handleTabDrop($event, windowTab.id)"
            >
              <button
                type="button"
                draggable="true"
                class="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                :title="windowTitle(windowTab)"
                @click="void activateWindow(windowTab.id)"
                @dragstart="handleTabDragStart($event, windowTab.id)"
                @dragend="handleTabDragEnd($event, windowTab.id)"
              >
                <component :is="TAB_ICONS[windowTab.mainTab]" class="h-3.5 w-3.5 flex-shrink-0" />
                <span class="truncate text-[12px] font-medium">{{ windowTitle(windowTab) }}</span>
              </button>

              <button
                type="button"
                :class="closeButtonClass(windowTab)"
                :title="String(t('header.windowTabs.closeCurrent'))"
                :aria-label="String(t('header.windowTabs.closeCurrent'))"
                @click.stop="void closeWindow(windowTab.id)"
              >
                <RiCloseLine class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div
            v-for="group in groups"
            :key="group.id"
            :class="groupClass(group.id)"
            @click="selectGroup(group.id)"
            @dragover="handleGroupDragOver($event, group.id)"
            @dragleave="handleGroupDragLeave($event, group.id)"
            @drop="void handleGroupDrop($event, group.id)"
          >
            <button
              type="button"
              class="ml-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border transition-[filter,opacity,transform] hover:brightness-110 active:scale-[0.98]"
              :class="selectedGroupId === group.id ? 'opacity-100' : 'opacity-90 hover:opacity-100'"
              :style="groupMarkerStyle(group)"
              :title="String(t('header.windowTabs.groupMenuTitle'))"
              :aria-label="String(t('header.windowTabs.groupMenuTitle'))"
              @click.stop="openGroupMenu(group.id, $event)"
            >
              <RiMore2Line class="h-3.5 w-3.5" />
            </button>

            <div class="relative z-[1] min-w-0">
              <div v-if="!group.collapsed" class="flex min-w-0 items-center gap-1">
                <div
                  v-for="windowTab in groupTabs(group)"
                  :key="`${group.id}:${windowTab.id}`"
                  :class="windowTabClass(windowTab)"
                  @dragover="handleTabDragOver($event, windowTab.id)"
                  @dragleave="handleTabDragLeave($event, windowTab.id)"
                  @drop="void handleTabDrop($event, windowTab.id)"
                >
                  <button
                    type="button"
                    draggable="true"
                    class="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                    :title="windowTitle(windowTab)"
                    @click="void activateWindow(windowTab.id)"
                    @dragstart="handleTabDragStart($event, windowTab.id)"
                    @dragend="handleTabDragEnd($event, windowTab.id)"
                  >
                    <component :is="TAB_ICONS[windowTab.mainTab]" class="h-3.5 w-3.5 flex-shrink-0" />
                    <span class="truncate text-[12px] font-medium">{{ windowTitle(windowTab) }}</span>
                  </button>

                  <button
                    type="button"
                    :class="closeButtonClass(windowTab)"
                    :title="String(t('header.windowTabs.closeCurrent'))"
                    :aria-label="String(t('header.windowTabs.closeCurrent'))"
                    @click.stop="void closeWindow(windowTab.id)"
                  >
                    <RiCloseLine class="h-3.5 w-3.5" />
                  </button>
                </div>

                <div :class="groupUnderlineClass(group.id)" :style="groupUnderlineStyle(group)" />
              </div>

              <span v-else class="relative z-[1] px-1 text-[10px] font-medium text-muted-foreground">{{
                group.tabIds.length
              }}</span>
            </div>
          </div>

          <button
            type="button"
            class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-background/80 text-muted-foreground transition-colors hover:border-border hover:bg-secondary/60 hover:text-foreground"
            :title="String(t('header.windowTabs.newGroup'))"
            :aria-label="String(t('header.windowTabs.newGroup'))"
            @click="void createGroup()"
          >
            <RiAddLine class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <OptionMenu
        :open="groupMenuOpen"
        :groups="groupMenuGroups"
        :title="String(t('header.windowTabs.groupMenuTitle'))"
        :mobile-title="String(t('header.windowTabs.groupMenuTitle'))"
        :searchable="false"
        :is-mobile-pointer="ui.isMobilePointer"
        :desktop-fixed="true"
        :desktop-anchor-el="groupMenuAnchorEl"
        desktop-placement="bottom-start"
        desktop-class="w-56"
        @update:open="setGroupMenuOpen"
        @select="handleGroupMenuSelect"
      />
    </div>
  </div>
</template>

import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { isMainTabId, type MainTabId } from '@/app/navigation/mainTabs'
import { getLocalJson, getLocalString, setLocalJson, setLocalString } from '@/lib/persist'
import { localStorageKeys } from '@/lib/persistence/storageKeys'

export type MainTab = MainTabId
export type WorkspaceDockPanel = 'chat' | 'changes' | 'git' | 'files' | 'terminal' | 'preview'
export type WorkspaceDockPlacement = 'right' | 'bottom'
export type WorkspaceDockFileAction = 'open' | 'reveal'
export type WorkspaceDockFileRequest = {
  path: string
  action: WorkspaceDockFileAction
  line?: number
  column?: number
  anchor?: string
}

export type ImageViewerItem = {
  src: string
  alt?: string
  title?: string
  key?: string
}

export type WorkspaceWindowTab = {
  id: string
  mainTab: MainTab
  title?: string
  routeQuery: Record<string, string>
  createdAt: number
}

export type WorkspaceWindowGroup = {
  id: string
  color: string
  tabIds: string[]
  collapsed: boolean
  splitWindowIds: string[]
  splitPaneRatios: Record<string, number>
  createdAt: number
}

let workspaceWindowSerial = 0
let workspaceGroupSerial = 0

function nextWorkspaceWindowId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  workspaceWindowSerial += 1
  return `window-${Date.now().toString(36)}-${workspaceWindowSerial.toString(36)}`
}

function nextWorkspaceGroupId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  workspaceGroupSerial += 1
  return `group-${Date.now().toString(36)}-${workspaceGroupSerial.toString(36)}`
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

function normalizeRouteQueryRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const k = String(key || '').trim()
    if (!k) continue
    if (k === 'windowId' || k === 'windowid' || k === 'ocEmbed') continue
    const canonicalKey = k === 'session' || k === 'sessionid' ? 'sessionId' : k === 'filepath' ? 'filePath' : k
    const normalized = normalizeQueryValue(value)
    if (!normalized) continue
    out[canonicalKey] = normalized
  }
  return out
}

function readWindowIdFromRouteQuery(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const source = raw as Record<string, unknown>
  return normalizeQueryValue(source.windowId) || normalizeQueryValue(source.windowid) || ''
}

function areStringRecordsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false
  }
  return true
}

function queryMatchAliasesForKey(key: string): string[] {
  const normalized = String(key || '').trim()
  if (!normalized) return []
  return [normalized]
}

function normalizeMatchQueryValue(key: string, value: string): string {
  const normalizedKey = String(key || '').trim()
  const normalizedValue = String(value || '').trim()
  if (!normalizedValue) return ''

  if (normalizedKey === 'filePath' || normalizedKey === 'filepath') {
    return normalizedValue.replace(/\\/g, '/')
  }

  return normalizedValue
}

function readMatchQueryValue(record: Record<string, string> | null | undefined, key: string): string {
  if (!record) return ''
  const aliases = queryMatchAliasesForKey(key)
  for (const alias of aliases) {
    const candidate = normalizeMatchQueryValue(key, String(record[alias] || ''))
    if (candidate) return candidate
  }
  return ''
}

function defaultMatchKeysForMainTab(tab: MainTab): string[] {
  if (tab === 'chat') return ['sessionId']
  if (tab === 'files') return ['filePath']
  return []
}

function normalizeMatchKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    const key = String(item || '').trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

function sortedStringRecordEntries(record: Record<string, string>): Array<[string, string]> {
  return Object.entries(record || {})
    .map(([key, value]) => [String(key || '').trim(), String(value || '').trim()] as [string, string])
    .filter(([key, value]) => Boolean(key && value))
    .sort(([a], [b]) => a.localeCompare(b))
}

function buildWorkspaceWindowIdentity(tab: MainTab, query: Record<string, string>, matchKeys?: string[]): string {
  const keys = normalizeMatchKeys(matchKeys)
  if (keys.length > 0) {
    const values = keys.map((key) => readMatchQueryValue(query, key))
    if (values.every(Boolean)) {
      return `${tab}::match::${keys.map((key, idx) => `${key}=${values[idx]}`).join('&')}`
    }
  }

  const parts = sortedStringRecordEntries(query)
  return `${tab}::full::${parts.map(([key, value]) => `${key}=${value}`).join('&')}`
}

const WORKSPACE_GROUP_COLORS = [
  '#60a5fa',
  '#34d399',
  '#f59e0b',
  '#f472b6',
  '#a78bfa',
  '#22d3ee',
  '#f87171',
  '#84cc16',
  '#fb7185',
  '#2dd4bf',
] as const

function hashString(value: string): number {
  let hash = 2166136261
  const input = String(value || '')
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
  }
  return Math.abs(hash >>> 0)
}

function isHexColor(raw: unknown): raw is string {
  const value = String(raw || '').trim()
  return /^#([0-9a-fA-F]{6})$/.test(value)
}

function pickWorkspaceGroupColor(seed: string): string {
  const source = String(seed || '').trim()
  const index = source ? hashString(source) % WORKSPACE_GROUP_COLORS.length : 0
  return WORKSPACE_GROUP_COLORS[index] || WORKSPACE_GROUP_COLORS[0]
}

function normalizeIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    const id = String(item || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function normalizeWorkspaceGroupSplitPaneRatios(raw: unknown, splitWindowIds: string[]): Record<string, number> {
  const ids = normalizeIdList(splitWindowIds)
  if (!ids.length) return {}

  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const weighted: Record<string, number> = {}
  let total = 0

  for (const id of ids) {
    const candidate = Number(source[id])
    const weight = Number.isFinite(candidate) && candidate > 0 ? candidate : 1
    weighted[id] = weight
    total += weight
  }

  if (!(total > 0)) {
    total = ids.length
  }

  const out: Record<string, number> = {}
  for (const id of ids) {
    out[id] = weighted[id] / total
  }

  return out
}

function areSplitPaneRatiosEqualByIds(
  left: Record<string, number> | null | undefined,
  right: Record<string, number> | null | undefined,
  splitWindowIds: string[],
): boolean {
  const ids = normalizeIdList(splitWindowIds)
  for (const id of ids) {
    const a = Number(left?.[id] || 0)
    const b = Number(right?.[id] || 0)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false
    if (Math.abs(a - b) > 1e-6) return false
  }
  return true
}

const STORAGE_SIDEBAR_OPEN = localStorageKeys.ui.sidebarOpen
const STORAGE_SIDEBAR_WIDTH = localStorageKeys.ui.sidebarWidth
const STORAGE_GIT_HISTORY_SEARCH_EXPANDED = localStorageKeys.ui.gitHistorySearchExpanded
const STORAGE_ACTIVE_TAB = localStorageKeys.ui.activeMainTab
const STORAGE_WORKSPACE_GROUPS = localStorageKeys.ui.workspaceGroups
const STORAGE_ACTIVE_WORKSPACE_GROUP_ID = localStorageKeys.ui.activeWorkspaceGroupId
const STORAGE_WORKSPACE_WINDOWS = localStorageKeys.ui.workspaceWindows
const STORAGE_ACTIVE_WORKSPACE_WINDOW_ID = localStorageKeys.ui.activeWorkspaceWindowId
const STORAGE_WORKSPACE_SPLIT_WINDOW_ID = localStorageKeys.ui.workspaceSplitWindowId
const STORAGE_WORKSPACE_SPLIT_WINDOW_IDS = localStorageKeys.ui.workspaceSplitWindowIds
const STORAGE_WORKSPACE_SPLIT_WIDTH = localStorageKeys.ui.workspaceSplitWidth
const STORAGE_WORKSPACE_DOCK_OPEN = localStorageKeys.ui.workspaceDockOpen
const STORAGE_WORKSPACE_DOCK_PANEL = localStorageKeys.ui.workspaceDockPanel
const STORAGE_WORKSPACE_DOCK_PLACEMENT = localStorageKeys.ui.workspaceDockPlacement
const STORAGE_WORKSPACE_DOCK_WIDTH = localStorageKeys.ui.workspaceDockWidth
const STORAGE_WORKSPACE_DOCK_HEIGHT = localStorageKeys.ui.workspaceDockHeight

export const useUiStore = defineStore('ui', () => {
  // Explicit semantic signals.
  const isCompactLayout = ref(false)
  const isMobileDevice = ref(false)
  const isTouchPointer = ref(false)

  // Legacy aliases kept for broad compatibility while migrating call sites.
  const isMobile = ref(false)
  const isMobilePointer = ref(false)

  // Left sessions sidebar (desktop) + drill-down list (mobile)
  const isSidebarOpen = ref(getLocalString(STORAGE_SIDEBAR_OPEN) !== 'false')
  watch(isSidebarOpen, (v) => setLocalString(STORAGE_SIDEBAR_OPEN, v ? 'true' : 'false'))

  const sidebarWidth = ref<number>(
    (() => {
      const raw = getLocalString(STORAGE_SIDEBAR_WIDTH)
      const n = raw ? Number(raw) : NaN
      return Number.isFinite(n) ? Math.min(520, Math.max(220, n)) : 280
    })(),
  )
  const hasManuallyResizedLeftSidebar = ref(false)
  watch(sidebarWidth, (v) => {
    setLocalString(STORAGE_SIDEBAR_WIDTH, String(v))
    hasManuallyResizedLeftSidebar.value = true
  })

  // Mobile drill-down: show sessions sidebar OR main content.
  const isSessionSwitcherOpen = ref(false)

  // Explicit session locate request (used to scroll the sessions sidebar on demand).
  // This is intentionally *not* tied to session selection; only user-triggered actions should update the sidebar.
  const sidebarLocateSeq = ref(0)
  const sidebarLocateSessionId = ref<string | null>(null)

  const effectiveSidebarWidth = computed(() => (isSidebarOpen.value && !isCompactLayout.value ? sidebarWidth.value : 0))

  const gitHistorySearchExpanded = ref(getLocalString(STORAGE_GIT_HISTORY_SEARCH_EXPANDED) === 'true')
  watch(gitHistorySearchExpanded, (v) => setLocalString(STORAGE_GIT_HISTORY_SEARCH_EXPANDED, v ? 'true' : 'false'))

  const isWorkspaceDockOpen = ref(getLocalString(STORAGE_WORKSPACE_DOCK_OPEN) === 'true')
  watch(isWorkspaceDockOpen, (v) => setLocalString(STORAGE_WORKSPACE_DOCK_OPEN, v ? 'true' : 'false'))

  const workspaceDockPanel = ref<WorkspaceDockPanel>(
    (() => {
      const raw = getLocalString(STORAGE_WORKSPACE_DOCK_PANEL).trim()
      if (raw === 'chat' || raw === 'changes' || raw === 'terminal' || raw === 'files' || raw === 'preview') {
        return raw
      }
      return 'git'
    })(),
  )
  watch(workspaceDockPanel, (v) => setLocalString(STORAGE_WORKSPACE_DOCK_PANEL, v))

  const workspaceDockFileRequest = ref<WorkspaceDockFileRequest | null>(null)
  const workspaceDockFileRequestSeq = ref(0)

  const workspaceDockPlacement = ref<WorkspaceDockPlacement>('right')
  watch(workspaceDockPlacement, (v) => setLocalString(STORAGE_WORKSPACE_DOCK_PLACEMENT, v))

  const WORKSPACE_DOCK_WIDTH_MIN_PX = 280
  const WORKSPACE_DOCK_WIDTH_MAX_PX = 1200

  const workspaceDockWidth = ref<number>(
    (() => {
      const raw = getLocalString(STORAGE_WORKSPACE_DOCK_WIDTH)
      const n = raw ? Number(raw) : NaN
      return Number.isFinite(n) ? Math.min(WORKSPACE_DOCK_WIDTH_MAX_PX, Math.max(WORKSPACE_DOCK_WIDTH_MIN_PX, n)) : 360
    })(),
  )
  watch(workspaceDockWidth, (v) => {
    setLocalString(
      STORAGE_WORKSPACE_DOCK_WIDTH,
      String(Math.min(WORKSPACE_DOCK_WIDTH_MAX_PX, Math.max(WORKSPACE_DOCK_WIDTH_MIN_PX, v))),
    )
  })

  const workspaceDockHeight = ref<number>(
    (() => {
      const raw = getLocalString(STORAGE_WORKSPACE_DOCK_HEIGHT)
      const n = raw ? Number(raw) : NaN
      return Number.isFinite(n) ? Math.min(520, Math.max(180, n)) : 260
    })(),
  )
  watch(workspaceDockHeight, (v) => {
    setLocalString(STORAGE_WORKSPACE_DOCK_HEIGHT, String(Math.min(520, Math.max(180, v))))
  })

  function normalizeWorkspaceWindowTab(raw: unknown): WorkspaceWindowTab | null {
    if (!raw || typeof raw !== 'object') return null
    const source = raw as Record<string, unknown>

    const id = String(source.id || '').trim()
    if (!id) return null

    const mainTabRaw = String(source.mainTab || '').trim()
    const mainTab: MainTab = isMainTabId(mainTabRaw) ? mainTabRaw : 'chat'
    const title = String(source.title || '').trim()
    const routeQuery = normalizeRouteQueryRecord(source.routeQuery)

    const createdAtRaw = Number(source.createdAt)
    const createdAt = Number.isFinite(createdAtRaw) && createdAtRaw > 0 ? Math.floor(createdAtRaw) : Date.now()

    return {
      id,
      mainTab,
      ...(title ? { title } : {}),
      routeQuery,
      createdAt,
    }
  }

  function createWorkspaceWindowTab(mainTab: MainTab = 'chat', rawQuery?: unknown, title?: string): WorkspaceWindowTab {
    const normalizedTitle = String(title || '').trim()
    return {
      id: nextWorkspaceWindowId(),
      mainTab,
      ...(normalizedTitle ? { title: normalizedTitle } : {}),
      routeQuery: normalizeRouteQueryRecord(rawQuery),
      createdAt: Date.now(),
    }
  }

  const defaultMainTab: MainTab = (() => {
    const raw = getLocalString(STORAGE_ACTIVE_TAB).trim()
    return isMainTabId(raw) ? raw : 'chat'
  })()

  function createWorkspaceWindowGroup(opts?: {
    id?: string
    color?: string
    tabIds?: string[]
    collapsed?: boolean
    splitWindowIds?: string[]
    splitPaneRatios?: Record<string, number>
    createdAt?: number
  }): WorkspaceWindowGroup {
    const groupId = String(opts?.id || '').trim() || nextWorkspaceGroupId()
    const tabIds = normalizeIdList(opts?.tabIds)

    const splitWindowIds = normalizeIdList(opts?.splitWindowIds)
    const splitPaneRatios = normalizeWorkspaceGroupSplitPaneRatios(opts?.splitPaneRatios, splitWindowIds)
    const color = isHexColor(opts?.color) ? opts.color : pickWorkspaceGroupColor(groupId)

    const createdAtRaw = Number(opts?.createdAt)
    const createdAt = Number.isFinite(createdAtRaw) && createdAtRaw > 0 ? Math.floor(createdAtRaw) : Date.now()

    return {
      id: groupId,
      color,
      tabIds,
      collapsed: Boolean(opts?.collapsed),
      splitWindowIds,
      splitPaneRatios,
      createdAt,
    }
  }

  function normalizeWorkspaceWindowGroup(raw: unknown): WorkspaceWindowGroup | null {
    if (!raw || typeof raw !== 'object') return null
    const source = raw as Record<string, unknown>

    const id = String(source.id || '').trim()
    if (!id) return null

    const tabIdsFromCurrentShape = normalizeIdList(source.tabIds)
    const tabIdsFromLegacyWindows = Array.isArray(source.windows)
      ? source.windows
          .map((item) => {
            if (!item || typeof item !== 'object') return ''
            return String((item as Record<string, unknown>).id || '').trim()
          })
          .filter((value): value is string => Boolean(value))
      : []
    const tabIds = tabIdsFromCurrentShape.length > 0 ? tabIdsFromCurrentShape : normalizeIdList(tabIdsFromLegacyWindows)

    const group = createWorkspaceWindowGroup({
      id,
      color: String(source.color || '').trim(),
      tabIds,
      collapsed: Boolean(source.collapsed),
      splitWindowIds: normalizeIdList(source.splitWindowIds),
      splitPaneRatios:
        source.splitPaneRatios && typeof source.splitPaneRatios === 'object'
          ? (source.splitPaneRatios as Record<string, number>)
          : {},
      createdAt: Number(source.createdAt),
    })

    return group
  }

  const workspaceWindows = ref<WorkspaceWindowTab[]>(
    (() => {
      const persisted = getLocalJson<unknown>(STORAGE_WORKSPACE_WINDOWS, [])
      const list = Array.isArray(persisted)
        ? persisted
            .map((item) => normalizeWorkspaceWindowTab(item))
            .filter((item): item is WorkspaceWindowTab => Boolean(item))
        : []
      if (list.length > 0) return list
      return [createWorkspaceWindowTab(defaultMainTab)]
    })(),
  )

  const activeWorkspaceWindowId = ref<string>(
    (() => {
      const raw = getLocalString(STORAGE_ACTIVE_WORKSPACE_WINDOW_ID).trim()
      if (raw && workspaceWindows.value.some((item) => item.id === raw)) return raw
      return workspaceWindows.value[0]?.id || ''
    })(),
  )

  const activeWorkspaceWindow = computed<WorkspaceWindowTab | null>(() => {
    const exact = workspaceWindows.value.find((item) => item.id === activeWorkspaceWindowId.value)
    return exact || workspaceWindows.value[0] || null
  })
  const focusedWorkspaceWindowId = computed<string>(() => String(activeWorkspaceWindowId.value || '').trim())
  const workspaceWindowDragId = ref('')

  function getWorkspaceWindowById(windowId?: string | null): WorkspaceWindowTab | null {
    const id = String(windowId || '').trim()
    if (!id) return null
    return workspaceWindows.value.find((item) => item.id === id) || null
  }

  function ensureWorkspaceWindows(defaultTab: MainTab = 'chat') {
    if (!workspaceWindows.value.length) {
      const seeded = createWorkspaceWindowTab(defaultTab)
      workspaceWindows.value = [seeded]
      activeWorkspaceWindowId.value = seeded.id
      return
    }
    if (!workspaceWindows.value.some((item) => item.id === activeWorkspaceWindowId.value)) {
      if (String(activeWorkspaceGroupId.value || '').trim()) {
        activeWorkspaceWindowId.value = ''
        return
      }
      const fallbackUngrouped = workspaceWindows.value.find((item) => !getWorkspaceWindowGroupId(item.id))
      activeWorkspaceWindowId.value = fallbackUngrouped?.id || ''
    }
  }

  function setFocusedWorkspaceWindow(windowId?: string | null) {
    const id = String(windowId || '').trim()
    if (!id) return
    activateWorkspaceWindow(id)
  }

  watch(
    workspaceWindows,
    (list) => {
      ensureWorkspaceWindows(defaultMainTab)
      if (workspaceWindowDragId.value && !list.some((item) => item.id === workspaceWindowDragId.value)) {
        workspaceWindowDragId.value = ''
      }
      setLocalJson(STORAGE_WORKSPACE_WINDOWS, list)
    },
    { deep: true },
  )

  watch(activeWorkspaceWindowId, (v) => {
    setLocalString(STORAGE_ACTIVE_WORKSPACE_WINDOW_ID, String(v || ''))
  })

  const activeMainTab = computed<MainTab>(() => activeWorkspaceWindow.value?.mainTab || 'chat')
  watch(activeMainTab, (v) => setLocalString(STORAGE_ACTIVE_TAB, v), { immediate: true })

  const WORKSPACE_SPLIT_WIDTH_MIN_PX = 320
  const WORKSPACE_SPLIT_WIDTH_MAX_PX = 1400

  const workspaceSplitWidth = ref<number>(
    (() => {
      const raw = getLocalString(STORAGE_WORKSPACE_SPLIT_WIDTH)
      const n = raw ? Number(raw) : NaN
      return Number.isFinite(n)
        ? Math.min(WORKSPACE_SPLIT_WIDTH_MAX_PX, Math.max(WORKSPACE_SPLIT_WIDTH_MIN_PX, n))
        : 520
    })(),
  )
  watch(workspaceSplitWidth, (v) => {
    setLocalString(
      STORAGE_WORKSPACE_SPLIT_WIDTH,
      String(Math.min(WORKSPACE_SPLIT_WIDTH_MAX_PX, Math.max(WORKSPACE_SPLIT_WIDTH_MIN_PX, v))),
    )
  })

  const workspaceSplitWindowIds = ref<string[]>([])

  const workspaceSplitWindowId = computed<string>(() => workspaceSplitWindowIds.value[0] || '')

  const workspaceGroups = ref<WorkspaceWindowGroup[]>(
    (() => {
      const persisted = getLocalJson<unknown>(STORAGE_WORKSPACE_GROUPS, [])
      const list = Array.isArray(persisted)
        ? persisted
            .map((item) => normalizeWorkspaceWindowGroup(item))
            .filter((item): item is WorkspaceWindowGroup => Boolean(item))
        : []
      return list
    })(),
  )

  const activeWorkspaceGroupId = ref<string>(
    (() => {
      const raw = getLocalString(STORAGE_ACTIVE_WORKSPACE_GROUP_ID).trim()
      if (raw && workspaceGroups.value.some((item) => item.id === raw)) return raw
      return ''
    })(),
  )

  const activeWorkspaceGroup = computed<WorkspaceWindowGroup | null>(() => {
    const exact = workspaceGroups.value.find((item) => item.id === activeWorkspaceGroupId.value)
    return exact || null
  })

  function areWorkspaceGroupsEqual(a: WorkspaceWindowGroup[], b: WorkspaceWindowGroup[]): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
      const left = a[i]
      const right = b[i]
      if (!left || !right) return false
      if (
        left.id !== right.id ||
        left.color !== right.color ||
        left.collapsed !== right.collapsed ||
        left.createdAt !== right.createdAt
      ) {
        return false
      }
      if (left.tabIds.length !== right.tabIds.length) return false
      if (left.splitWindowIds.length !== right.splitWindowIds.length) return false
      for (let j = 0; j < left.tabIds.length; j += 1) {
        if (left.tabIds[j] !== right.tabIds[j]) return false
      }
      for (let j = 0; j < left.splitWindowIds.length; j += 1) {
        if (left.splitWindowIds[j] !== right.splitWindowIds[j]) return false
      }
      if (!areSplitPaneRatiosEqualByIds(left.splitPaneRatios, right.splitPaneRatios, left.splitWindowIds)) return false
    }
    return true
  }

  function sanitizeWorkspaceGroup(group: WorkspaceWindowGroup, consumedTabIds: Set<string>): WorkspaceWindowGroup {
    const validWindowIds = new Set(workspaceWindows.value.map((item) => item.id))
    const windowsById = new Map(workspaceWindows.value.map((item) => [item.id, item] as const))

    const tabIds: string[] = []
    const seenIdentity = new Set<string>()
    for (const rawId of group.tabIds) {
      const id = String(rawId || '').trim()
      if (!id) continue
      if (!validWindowIds.has(id)) continue
      if (consumedTabIds.has(id)) continue

      const windowTab = windowsById.get(id)
      if (!windowTab) continue
      const identity = buildWorkspaceWindowIdentity(
        windowTab.mainTab,
        windowTab.routeQuery,
        defaultMatchKeysForMainTab(windowTab.mainTab),
      )
      if (seenIdentity.has(identity)) continue

      seenIdentity.add(identity)
      consumedTabIds.add(id)
      tabIds.push(id)
    }

    const tabIdSet = new Set(tabIds)
    const splitWindowIds = normalizeIdList(group.splitWindowIds).filter((id) => tabIdSet.has(id))
    const splitPaneRatios = normalizeWorkspaceGroupSplitPaneRatios(group.splitPaneRatios, splitWindowIds)

    return {
      ...group,
      color: isHexColor(group.color) ? group.color : pickWorkspaceGroupColor(group.id),
      tabIds,
      splitWindowIds,
      splitPaneRatios,
      collapsed: Boolean(group.collapsed),
    }
  }

  function ensureWorkspaceGroups() {
    const consumed = new Set<string>()
    const next = workspaceGroups.value.map((group) => sanitizeWorkspaceGroup(group, consumed))
    if (!areWorkspaceGroupsEqual(next, workspaceGroups.value)) {
      workspaceGroups.value = next
    }

    if (workspaceGroups.value.some((item) => item.id === activeWorkspaceGroupId.value)) return
    activeWorkspaceGroupId.value = ''
  }

  function getWorkspaceGroupById(groupId?: string | null): WorkspaceWindowGroup | null {
    const id = String(groupId || '').trim()
    if (!id) return null
    return workspaceGroups.value.find((item) => item.id === id) || null
  }

  function getWorkspaceWindowGroupId(windowId?: string | null): string {
    const id = String(windowId || '').trim()
    if (!id) return ''
    for (const group of workspaceGroups.value) {
      if (group.tabIds.includes(id)) return group.id
    }
    return ''
  }

  function getUngroupedWorkspaceWindowIds(): string[] {
    return workspaceWindows.value
      .filter((item) => !getWorkspaceWindowGroupId(item.id))
      .map((item) => String(item.id || '').trim())
      .filter(Boolean)
  }

  function dedupeUngroupedWorkspaceWindows() {
    const groupedIds = new Set<string>()
    for (const group of workspaceGroups.value) {
      for (const id of group.tabIds || []) {
        const normalized = String(id || '').trim()
        if (normalized) groupedIds.add(normalized)
      }
    }

    const seenIdentity = new Set<string>()
    const removeIds = new Set<string>()
    for (const tab of workspaceWindows.value) {
      const id = String(tab.id || '').trim()
      if (!id || groupedIds.has(id)) continue

      const identity = buildWorkspaceWindowIdentity(
        tab.mainTab,
        tab.routeQuery,
        defaultMatchKeysForMainTab(tab.mainTab),
      )
      if (seenIdentity.has(identity)) {
        removeIds.add(id)
        continue
      }
      seenIdentity.add(identity)
    }

    if (!removeIds.size) return
    workspaceWindows.value = workspaceWindows.value.filter((item) => !removeIds.has(String(item.id || '').trim()))
    if (removeIds.has(String(workspaceWindowDragId.value || '').trim())) {
      workspaceWindowDragId.value = ''
    }
  }

  function setWorkspaceGroupSplitWindowIds(groupId: string, rawIds: string[]): boolean {
    const targetId = String(groupId || '').trim()
    if (!targetId) return false
    const idx = workspaceGroups.value.findIndex((item) => item.id === targetId)
    if (idx < 0) return false
    const group = workspaceGroups.value[idx]
    const tabIdSet = new Set(group.tabIds)
    const nextSplit = normalizeIdList(rawIds).filter((id) => tabIdSet.has(id))
    const nextSplitPaneRatios = normalizeWorkspaceGroupSplitPaneRatios(group.splitPaneRatios, nextSplit)
    const unchanged =
      nextSplit.length === group.splitWindowIds.length &&
      nextSplit.every((id, pos) => id === group.splitWindowIds[pos]) &&
      areSplitPaneRatiosEqualByIds(group.splitPaneRatios, nextSplitPaneRatios, nextSplit)
    if (unchanged) return true
    workspaceGroups.value = workspaceGroups.value.map((item, itemIdx) =>
      itemIdx === idx
        ? {
            ...item,
            splitWindowIds: nextSplit,
            splitPaneRatios: nextSplitPaneRatios,
          }
        : item,
    )
    return true
  }

  function getWorkspaceGroupSplitPaneRatios(groupId: string): number[] {
    const targetId = String(groupId || '').trim()
    if (!targetId) return []
    const group = getWorkspaceGroupById(targetId)
    if (!group) return []
    const normalized = normalizeWorkspaceGroupSplitPaneRatios(group.splitPaneRatios, group.splitWindowIds)
    return group.splitWindowIds.map((id) => Number(normalized[id] || 0)).filter((ratio) => ratio > 0)
  }

  function setWorkspaceGroupSplitPaneRatios(groupId: string, rawRatios: number[]): boolean {
    const targetId = String(groupId || '').trim()
    if (!targetId) return false
    const idx = workspaceGroups.value.findIndex((item) => item.id === targetId)
    if (idx < 0) return false
    const group = workspaceGroups.value[idx]
    const splitIds = normalizeIdList(group.splitWindowIds)
    if (!splitIds.length) return false

    const sourceArray = Array.isArray(rawRatios) ? rawRatios : []
    const byId: Record<string, number> = {}
    for (let i = 0; i < splitIds.length; i += 1) {
      const id = splitIds[i]
      const candidate = Number(sourceArray[i])
      if (Number.isFinite(candidate) && candidate > 0) {
        byId[id] = candidate
      }
    }

    const nextRatios = normalizeWorkspaceGroupSplitPaneRatios(byId, splitIds)
    if (areSplitPaneRatiosEqualByIds(group.splitPaneRatios, nextRatios, splitIds)) return true

    workspaceGroups.value = workspaceGroups.value.map((item, itemIdx) =>
      itemIdx === idx
        ? {
            ...item,
            splitPaneRatios: nextRatios,
          }
        : item,
    )

    return true
  }

  function syncWorkspaceSelectionState() {
    ensureWorkspaceWindows(defaultMainTab)
    ensureWorkspaceGroups()
    dedupeUngroupedWorkspaceWindows()
    ensureWorkspaceWindows(defaultMainTab)

    const selectedGroup = getWorkspaceGroupById(activeWorkspaceGroupId.value)
    if (selectedGroup) {
      const normalizedSplit = normalizeIdList(selectedGroup.splitWindowIds).filter((id) =>
        selectedGroup.tabIds.includes(id),
      )
      if (!normalizedSplit.length && selectedGroup.tabIds.length > 0) {
        setWorkspaceGroupSplitWindowIds(selectedGroup.id, [selectedGroup.tabIds[0]])
      }

      const refreshed = getWorkspaceGroupById(selectedGroup.id)
      if (!refreshed) {
        activeWorkspaceGroupId.value = ''
        activeWorkspaceWindowId.value = ''
        workspaceSplitWindowIds.value = []
        return
      }

      const nextSplit = normalizeIdList(refreshed.splitWindowIds).filter((id) => refreshed.tabIds.includes(id))
      if (!nextSplit.length) {
        activeWorkspaceWindowId.value = ''
        workspaceSplitWindowIds.value = []
        return
      }

      activeWorkspaceWindowId.value = ''
      workspaceSplitWindowIds.value = nextSplit
      return
    }

    activeWorkspaceGroupId.value = ''
    const ungroupedIds = getUngroupedWorkspaceWindowIds()

    if (!ungroupedIds.includes(String(activeWorkspaceWindowId.value || '').trim())) {
      activeWorkspaceWindowId.value = ungroupedIds[0] || ''
    }
    workspaceSplitWindowIds.value = []
  }

  const workspaceVisibleWindowIds = computed<string[]>(() => {
    const selectedGroup = getWorkspaceGroupById(activeWorkspaceGroupId.value)
    if (selectedGroup) {
      return normalizeIdList(selectedGroup.splitWindowIds).filter((id) => selectedGroup.tabIds.includes(id))
    }

    const activeId = String(activeWorkspaceWindowId.value || '').trim()
    if (!activeId) return []
    if (getWorkspaceWindowGroupId(activeId)) return []
    if (!workspaceWindows.value.some((item) => item.id === activeId)) return []
    return [activeId]
  })

  function selectWorkspaceGroup(groupId: string): boolean {
    const targetId = String(groupId || '').trim()
    if (!targetId) return false
    const group = getWorkspaceGroupById(targetId)
    if (!group) return false

    activeWorkspaceGroupId.value = targetId
    const split = normalizeIdList(group.splitWindowIds).filter((id) => group.tabIds.includes(id))
    const nextSplit = split.length > 0 ? split : group.tabIds.slice(0, 1)
    if (nextSplit.length > 0) {
      setWorkspaceGroupSplitWindowIds(targetId, nextSplit)
    } else {
      setWorkspaceGroupSplitWindowIds(targetId, [])
    }
    activeWorkspaceWindowId.value = ''
    syncWorkspaceSelectionState()
    return true
  }

  function selectWorkspaceWindow(windowId: string): boolean {
    const targetId = String(windowId || '').trim()
    if (!targetId) return false
    if (!workspaceWindows.value.some((item) => item.id === targetId)) return false
    if (getWorkspaceWindowGroupId(targetId)) return false
    activeWorkspaceGroupId.value = ''
    activeWorkspaceWindowId.value = targetId
    workspaceSplitWindowIds.value = []
    return true
  }

  function clearWorkspaceSelection() {
    activeWorkspaceGroupId.value = ''
    activeWorkspaceWindowId.value = ''
    workspaceSplitWindowIds.value = []
  }

  function restoreWorkspaceGroupLayout(groupId: string, opts?: { focusedWindowId?: string }) {
    const targetId = String(groupId || '').trim()
    if (!targetId) return
    if (!selectWorkspaceGroup(targetId)) return

    const requested = String(opts?.focusedWindowId || '').trim()
    if (!requested) return
    const group = getWorkspaceGroupById(targetId)
    if (!group || !group.tabIds.includes(requested)) return
    if (!group.splitWindowIds.includes(requested)) {
      setWorkspaceGroupSplitWindowIds(targetId, [...group.splitWindowIds, requested])
    }
    activeWorkspaceWindowId.value = ''
    syncWorkspaceSelectionState()
  }

  function activateWorkspaceGroup(groupId: string) {
    void selectWorkspaceGroup(groupId)
  }

  function createWorkspaceGroup(): string {
    const next = createWorkspaceWindowGroup()
    workspaceGroups.value = [...workspaceGroups.value, next]
    activeWorkspaceGroupId.value = next.id
    syncWorkspaceSelectionState()
    return next.id
  }

  function closeWorkspaceGroup(groupId: string): boolean {
    const targetId = String(groupId || '').trim()
    if (!targetId) return false
    if (!workspaceGroups.value.some((item) => item.id === targetId)) return false
    workspaceGroups.value = workspaceGroups.value.filter((item) => item.id !== targetId)
    if (activeWorkspaceGroupId.value === targetId) {
      activeWorkspaceGroupId.value = ''
    }
    syncWorkspaceSelectionState()
    return true
  }

  function setWorkspaceGroupCollapsed(groupId: string, collapsed: boolean): boolean {
    const targetId = String(groupId || '').trim()
    if (!targetId) return false
    const idx = workspaceGroups.value.findIndex((item) => item.id === targetId)
    if (idx < 0) return false
    const nextCollapsed = Boolean(collapsed)
    if (workspaceGroups.value[idx].collapsed === nextCollapsed) return true
    workspaceGroups.value = workspaceGroups.value.map((item, itemIdx) =>
      itemIdx === idx
        ? {
            ...item,
            collapsed: nextCollapsed,
          }
        : item,
    )
    return true
  }

  function toggleWorkspaceGroupCollapsed(groupId: string): boolean {
    const group = getWorkspaceGroupById(groupId)
    if (!group) return false
    return setWorkspaceGroupCollapsed(group.id, !group.collapsed)
  }

  function ensureWorkspaceWindowInGroupSplit(groupId: string, windowId: string): boolean {
    const targetGroupId = String(groupId || '').trim()
    const targetWindowId = String(windowId || '').trim()
    if (!targetGroupId || !targetWindowId) return false
    const group = getWorkspaceGroupById(targetGroupId)
    if (!group) return false
    if (!group.tabIds.includes(targetWindowId)) return false
    if (group.splitWindowIds.includes(targetWindowId)) return true
    return setWorkspaceGroupSplitWindowIds(targetGroupId, [...group.splitWindowIds, targetWindowId])
  }

  function removeWorkspaceWindowFromGroupSplit(groupId: string, windowId: string): boolean {
    const targetGroupId = String(groupId || '').trim()
    const targetWindowId = String(windowId || '').trim()
    if (!targetGroupId || !targetWindowId) return false
    const group = getWorkspaceGroupById(targetGroupId)
    if (!group) return false
    if (!group.splitWindowIds.includes(targetWindowId)) return false

    const nextSplit = group.splitWindowIds.filter((id) => id !== targetWindowId)
    const changed = setWorkspaceGroupSplitWindowIds(targetGroupId, nextSplit)
    if (!changed) return false

    if (activeWorkspaceGroupId.value === targetGroupId) {
      activeWorkspaceWindowId.value = ''
    }
    syncWorkspaceSelectionState()
    return true
  }

  function moveWorkspaceWindowToGroup(
    windowId: string,
    targetGroupId: string,
    opts?: { sourceGroupId?: string; activateTargetGroup?: boolean },
  ): boolean {
    const sourceWindowId = String(windowId || '').trim()
    const destinationGroupId = String(targetGroupId || '').trim()

    if (!sourceWindowId || !destinationGroupId) return false
    if (!workspaceWindows.value.some((item) => item.id === sourceWindowId)) return false

    const targetGroupIndex = workspaceGroups.value.findIndex((item) => item.id === destinationGroupId)
    if (targetGroupIndex < 0) return false

    const sourceWasSplit = workspaceGroups.value.some((group) => group.splitWindowIds.includes(sourceWindowId))
    const nextGroups = workspaceGroups.value.map((group, idx) => {
      const filteredTabIds = group.tabIds.filter((id) => id !== sourceWindowId)
      const filteredSplit = group.splitWindowIds.filter((id) => id !== sourceWindowId)

      if (idx !== targetGroupIndex) {
        return {
          ...group,
          tabIds: filteredTabIds,
          splitWindowIds: filteredSplit,
        }
      }

      const nextTabIds = filteredTabIds.includes(sourceWindowId) ? filteredTabIds : [...filteredTabIds, sourceWindowId]
      const shouldSplit =
        sourceWasSplit || Boolean(opts?.activateTargetGroup) || activeWorkspaceGroupId.value === destinationGroupId
      const nextSplit = shouldSplit
        ? normalizeIdList([...filteredSplit, sourceWindowId]).filter((id) => nextTabIds.includes(id))
        : filteredSplit

      return {
        ...group,
        tabIds: nextTabIds,
        splitWindowIds: nextSplit,
      }
    })

    workspaceGroups.value = nextGroups

    if (opts?.activateTargetGroup || activeWorkspaceGroupId.value === destinationGroupId) {
      activeWorkspaceGroupId.value = destinationGroupId
      activeWorkspaceWindowId.value = ''
    }

    syncWorkspaceSelectionState()
    return true
  }

  function ungroupWorkspaceWindow(windowId: string): boolean {
    const sourceWindowId = String(windowId || '').trim()
    if (!sourceWindowId) return false
    if (!workspaceWindows.value.some((item) => item.id === sourceWindowId)) return false

    let changed = false
    workspaceGroups.value = workspaceGroups.value.map((group) => {
      if (!group.tabIds.includes(sourceWindowId) && !group.splitWindowIds.includes(sourceWindowId)) return group
      changed = true
      return {
        ...group,
        tabIds: group.tabIds.filter((id) => id !== sourceWindowId),
        splitWindowIds: group.splitWindowIds.filter((id) => id !== sourceWindowId),
      }
    })

    if (!changed) return false
    syncWorkspaceSelectionState()
    return true
  }

  function isWorkspaceGroupSelected(): boolean {
    return Boolean(getWorkspaceGroupById(activeWorkspaceGroupId.value))
  }

  ensureWorkspaceGroups()
  syncWorkspaceSelectionState()

  watch(
    [workspaceWindows, workspaceGroups, activeWorkspaceWindowId, activeWorkspaceGroupId],
    () => {
      syncWorkspaceSelectionState()
    },
    { deep: true },
  )

  watch(
    workspaceGroups,
    (list) => {
      setLocalJson(STORAGE_WORKSPACE_GROUPS, list)
    },
    { deep: true },
  )

  watch(workspaceSplitWindowIds, (list) => {
    setLocalJson(STORAGE_WORKSPACE_SPLIT_WINDOW_IDS, list)
    setLocalString(STORAGE_WORKSPACE_SPLIT_WINDOW_ID, String(list[0] || ''))
  })

  watch(activeWorkspaceGroupId, (v) => {
    setLocalString(STORAGE_ACTIVE_WORKSPACE_GROUP_ID, String(v || ''))
  })

  // Global overlays
  const isHelpDialogOpen = ref(false)
  const isMcpDialogOpen = ref(false)
  const isImageViewerOpen = ref(false)
  const imageViewerItems = ref<ImageViewerItem[]>([])
  const imageViewerActiveIndex = ref(0)
  const imageViewerZoom = ref(1)
  const imageViewerActiveItem = computed(() => {
    const items = imageViewerItems.value
    if (!items.length) return null
    const index = Math.min(Math.max(0, imageViewerActiveIndex.value), items.length - 1)
    return items[index] || null
  })

  // Cross-component session action requests (sidebar -> chat)
  const sessionActionSeq = ref(0)
  const sessionActionId = ref<string | null>(null)

  // Double-Esc abort prompt state (UI-only; actual abort lives in chat store)
  const abortPromptSessionId = ref<string | null>(null)
  const abortPromptExpiresAt = ref<number | null>(null)

  const sessionQueryEnabled = ref(false)

  function setIsCompactLayout(next: boolean) {
    isCompactLayout.value = next
    isMobile.value = next
    if (!next) {
      isSessionSwitcherOpen.value = false
    }
  }

  function setIsMobileDevice(next: boolean) {
    isMobileDevice.value = next
  }

  function setIsTouchPointer(next: boolean) {
    isTouchPointer.value = next
  }

  function setIsMobile(next: boolean) {
    // Legacy API: historically used as compact layout signal.
    setIsCompactLayout(next)
  }

  function setIsMobilePointer(next: boolean) {
    isMobilePointer.value = next
  }

  function toggleSidebar() {
    if (isCompactLayout.value) {
      isSessionSwitcherOpen.value = !isSessionSwitcherOpen.value
      return
    }
    isSidebarOpen.value = !isSidebarOpen.value
    if (isSidebarOpen.value && typeof window !== 'undefined') {
      // When opening and not manually resized, use proportional width.
      if (!hasManuallyResizedLeftSidebar.value) {
        sidebarWidth.value = Math.min(520, Math.max(220, Math.floor(window.innerWidth * 0.2)))
      }
    }
  }

  function setSidebarOpen(open: boolean, opts?: { preserveWidth?: boolean }) {
    const wasOpen = isSidebarOpen.value
    isSidebarOpen.value = open
    if (!open || opts?.preserveWidth || wasOpen) return
    if (typeof window !== 'undefined' && !hasManuallyResizedLeftSidebar.value) {
      sidebarWidth.value = Math.min(520, Math.max(220, Math.floor(window.innerWidth * 0.2)))
    }
  }

  function setSessionSwitcherOpen(open: boolean) {
    isSessionSwitcherOpen.value = open
  }

  function setWorkspaceDockOpen(open: boolean) {
    if (open) {
      workspaceDockPlacement.value = 'right'
    }
    isWorkspaceDockOpen.value = open
  }

  function toggleWorkspaceDock(defaultPanel: WorkspaceDockPanel = 'git') {
    if (isWorkspaceDockOpen.value) {
      isWorkspaceDockOpen.value = false
      return
    }
    workspaceDockPanel.value = defaultPanel
    workspaceDockPlacement.value = 'right'
    isWorkspaceDockOpen.value = true
  }

  function setWorkspaceDockPanel(panel: WorkspaceDockPanel) {
    workspaceDockPanel.value = panel
  }

  function findWorkspaceWindowIndex(windowId: string): number {
    const id = String(windowId || '').trim()
    if (!id) return -1
    return workspaceWindows.value.findIndex((item) => item.id === id)
  }

  function beginWorkspaceWindowDrag(windowId: string) {
    const id = String(windowId || '').trim()
    if (!id) {
      workspaceWindowDragId.value = ''
      return
    }
    if (!workspaceWindows.value.some((item) => item.id === id)) {
      workspaceWindowDragId.value = ''
      return
    }
    workspaceWindowDragId.value = id
  }

  function endWorkspaceWindowDrag(windowId?: string | null) {
    const id = String(windowId || '').trim()
    if (id && workspaceWindowDragId.value && workspaceWindowDragId.value !== id) return
    workspaceWindowDragId.value = ''
  }

  function getResolvedWorkspaceWindowId(windowId?: string | null): string {
    const preferred = String(windowId || '').trim()
    if (preferred && workspaceWindows.value.some((item) => item.id === preferred)) return preferred
    return activeWorkspaceWindow.value?.id || workspaceWindows.value[0]?.id || ''
  }

  function createWorkspaceWindow(
    tab: MainTab = activeMainTab.value,
    opts?: { activate?: boolean; query?: unknown; title?: string },
  ): string {
    return openWorkspaceWindow(tab, {
      activate: opts?.activate,
      query: opts?.query,
      title: opts?.title,
    })
  }

  function openWorkspaceWindow(
    tab: MainTab = activeMainTab.value,
    opts?: { activate?: boolean; query?: unknown; title?: string; matchKeys?: string[] },
  ): string {
    const selectedGroup = getWorkspaceGroupById(activeWorkspaceGroupId.value)
    const query = normalizeRouteQueryRecord(opts?.query)
    const matchKeys = normalizeMatchKeys(opts?.matchKeys)
    const effectiveKeys = matchKeys.length > 0 ? matchKeys : defaultMatchKeysForMainTab(tab)
    const scopeWindowIds = selectedGroup ? selectedGroup.tabIds : getUngroupedWorkspaceWindowIds()

    const existing = findWorkspaceWindowByTabAndQuery(tab, query, {
      keys: effectiveKeys,
      windowIds: scopeWindowIds,
    })
    if (existing) {
      const targetId = existing.id
      setWorkspaceWindowMainTab(targetId, tab)
      setWorkspaceWindowRouteQuery(targetId, query)
      if (typeof opts?.title !== 'undefined') {
        setWorkspaceWindowTitle(targetId, opts.title)
      }

      if (selectedGroup) {
        activeWorkspaceGroupId.value = selectedGroup.id
        ensureWorkspaceWindowInGroupSplit(selectedGroup.id, targetId)
        activeWorkspaceWindowId.value = ''
      } else {
        activeWorkspaceGroupId.value = ''
        if (opts?.activate !== false) {
          activeWorkspaceWindowId.value = targetId
        }
      }

      syncWorkspaceSelectionState()
      return targetId
    }

    const next = createWorkspaceWindowTab(tab, query, opts?.title)
    workspaceWindows.value = [...workspaceWindows.value, next]

    if (selectedGroup) {
      const groupIndex = workspaceGroups.value.findIndex((item) => item.id === selectedGroup.id)
      if (groupIndex >= 0) {
        workspaceGroups.value = workspaceGroups.value.map((group, idx) => {
          if (idx !== groupIndex) return group
          const nextTabIds = normalizeIdList([...group.tabIds, next.id])
          const nextSplit = normalizeIdList([...group.splitWindowIds, next.id]).filter((id) => nextTabIds.includes(id))
          return {
            ...group,
            tabIds: nextTabIds,
            splitWindowIds: nextSplit,
          }
        })
      }
      activeWorkspaceWindowId.value = ''
      syncWorkspaceSelectionState()
      return next.id
    }

    if (opts?.activate !== false) {
      activeWorkspaceGroupId.value = ''
      activeWorkspaceWindowId.value = next.id
    }
    syncWorkspaceSelectionState()
    return next.id
  }

  function findWorkspaceWindowByTabAndQuery(
    tab: MainTab,
    rawQuery: unknown,
    opts?: { keys?: string[]; windowIds?: string[] },
  ): WorkspaceWindowTab | null {
    const query = normalizeRouteQueryRecord(rawQuery)
    const matchKeys = normalizeMatchKeys(opts?.keys)

    const candidates = Array.isArray(opts?.windowIds)
      ? opts.windowIds
          .map((id) => {
            const targetId = String(id || '').trim()
            if (!targetId) return null
            return workspaceWindows.value.find((item) => item.id === targetId) || null
          })
          .filter((item): item is WorkspaceWindowTab => Boolean(item))
      : workspaceWindows.value

    for (const item of candidates) {
      if (item.mainTab !== tab) continue

      if (!matchKeys.length) {
        if (areStringRecordsEqual(item.routeQuery || {}, query)) return item
        continue
      }

      let matched = true
      for (const key of matchKeys) {
        const expected = readMatchQueryValue(query, key)
        if (!expected) {
          matched = false
          break
        }

        const actual = readMatchQueryValue(item.routeQuery || {}, key)
        if (actual !== expected) {
          matched = false
          break
        }
      }
      if (matched) return item
    }

    return null
  }

  function activateWorkspaceWindow(windowId: string) {
    const idx = findWorkspaceWindowIndex(windowId)
    if (idx < 0) return
    const targetId = workspaceWindows.value[idx]?.id || ''
    const groupId = getWorkspaceWindowGroupId(targetId)
    if (groupId) {
      activeWorkspaceGroupId.value = groupId
      ensureWorkspaceWindowInGroupSplit(groupId, targetId)
      activeWorkspaceWindowId.value = ''
    } else {
      activeWorkspaceGroupId.value = ''
      activeWorkspaceWindowId.value = targetId
    }
    syncWorkspaceSelectionState()
  }

  function setWorkspaceWindowMainTab(windowId: string, tab: MainTab) {
    const idx = findWorkspaceWindowIndex(windowId)
    if (idx < 0) return
    const target = workspaceWindows.value[idx]
    if (!target || target.mainTab === tab) return
    workspaceWindows.value = workspaceWindows.value.map((item, itemIdx) =>
      itemIdx === idx
        ? (() => {
            const next = {
              ...item,
              mainTab: tab,
            }
            const { title: _ignored, ...rest } = next
            return rest
          })()
        : item,
    )
  }

  function setWorkspaceWindowTitle(windowId: string, title?: string | null) {
    const idx = findWorkspaceWindowIndex(windowId)
    if (idx < 0) return

    const normalizedTitle = String(title || '').trim()
    const current = workspaceWindows.value[idx]
    const prevTitle = String(current?.title || '').trim()
    if (prevTitle === normalizedTitle) return

    workspaceWindows.value = workspaceWindows.value.map((item, itemIdx) => {
      if (itemIdx !== idx) return item
      if (!normalizedTitle) {
        const { title: _ignored, ...rest } = item
        return rest
      }
      return {
        ...item,
        title: normalizedTitle,
      }
    })
  }

  function setActiveWorkspaceWindowTitle(title?: string | null) {
    const targetId = getResolvedWorkspaceWindowId()
    if (!targetId) return
    setWorkspaceWindowTitle(targetId, title)
  }

  function resolveWorkspaceWindowIdFromRouteQuery(rawQuery: unknown): string {
    const fromRoute = readWindowIdFromRouteQuery(rawQuery)
    if (fromRoute && workspaceWindows.value.some((item) => item.id === fromRoute)) {
      return fromRoute
    }
    return getResolvedWorkspaceWindowId()
  }

  function setWorkspaceWindowTitleFromRoute(rawQuery: unknown, title?: string | null) {
    const targetId = resolveWorkspaceWindowIdFromRouteQuery(rawQuery)
    if (!targetId) return
    setWorkspaceWindowTitle(targetId, title)
  }

  function setWorkspaceWindowRouteQuery(windowId: string, rawQuery: unknown) {
    const idx = findWorkspaceWindowIndex(windowId)
    if (idx < 0) return

    const nextQuery = normalizeRouteQueryRecord(rawQuery)
    const prevQuery = workspaceWindows.value[idx]?.routeQuery || {}
    if (areStringRecordsEqual(prevQuery, nextQuery)) return

    workspaceWindows.value = workspaceWindows.value.map((item, itemIdx) =>
      itemIdx === idx
        ? {
            ...item,
            routeQuery: nextQuery,
          }
        : item,
    )
  }

  function setActiveWorkspaceWindowRouteQuery(rawQuery: unknown) {
    const targetId = getResolvedWorkspaceWindowId()
    if (!targetId) {
      createWorkspaceWindow(defaultMainTab, { activate: true, query: rawQuery })
      return
    }

    setWorkspaceWindowRouteQuery(targetId, rawQuery)
  }

  function syncActiveWorkspaceWindowFromRoute(tab: MainTab, rawQuery: unknown) {
    if (activeWorkspaceGroupId.value) return

    const routeWindowId = readWindowIdFromRouteQuery(rawQuery)
    if (routeWindowId) {
      if (!workspaceWindows.value.some((item) => item.id === routeWindowId)) {
        const seeded: WorkspaceWindowTab = {
          id: routeWindowId,
          mainTab: tab,
          routeQuery: normalizeRouteQueryRecord(rawQuery),
          createdAt: Date.now(),
        }
        workspaceWindows.value = [...workspaceWindows.value, seeded]
      }

      activateWorkspaceWindow(routeWindowId)
      setWorkspaceWindowMainTab(routeWindowId, tab)
      setWorkspaceWindowRouteQuery(routeWindowId, rawQuery)
      return
    }

    setActiveMainTab(tab)
    setActiveWorkspaceWindowRouteQuery(rawQuery)
  }

  function closeWorkspaceWindow(windowId: string) {
    const idx = findWorkspaceWindowIndex(windowId)
    if (idx < 0) return

    if (workspaceWindows.value.length <= 1) {
      const fallback = createWorkspaceWindowTab(defaultMainTab)
      workspaceWindows.value = [fallback]
      workspaceGroups.value = []
      activeWorkspaceGroupId.value = ''
      activeWorkspaceWindowId.value = fallback.id
      workspaceSplitWindowIds.value = []
      syncWorkspaceSelectionState()
      return
    }

    const wasActive = activeWorkspaceWindowId.value === windowId
    const next = workspaceWindows.value.filter((item) => item.id !== windowId)
    workspaceWindows.value = next

    if (wasActive) {
      if (activeWorkspaceGroupId.value) {
        activeWorkspaceWindowId.value = ''
      } else {
        const fallbackIndex = Math.max(0, Math.min(idx, next.length - 1))
        activeWorkspaceWindowId.value = next[fallbackIndex]?.id || next[0]?.id || ''
      }
    }

    syncWorkspaceSelectionState()
  }

  function closeOtherWorkspaceWindows(windowId?: string | null) {
    const targetId = getResolvedWorkspaceWindowId(windowId)
    if (!targetId) return
    const target = workspaceWindows.value.find((item) => item.id === targetId)
    if (!target) return
    workspaceWindows.value = [target]
    workspaceGroups.value = []
    activeWorkspaceGroupId.value = ''
    activeWorkspaceWindowId.value = target.id
    workspaceSplitWindowIds.value = []
    syncWorkspaceSelectionState()
  }

  function closeWorkspaceWindowsToLeft(windowId?: string | null) {
    const targetId = getResolvedWorkspaceWindowId(windowId)
    if (!targetId) return
    const idx = findWorkspaceWindowIndex(targetId)
    if (idx <= 0) return
    workspaceWindows.value = workspaceWindows.value.slice(idx)
    activeWorkspaceWindowId.value = targetId
    syncWorkspaceSelectionState()
  }

  function closeWorkspaceWindowsToRight(windowId?: string | null) {
    const targetId = getResolvedWorkspaceWindowId(windowId)
    if (!targetId) return
    const idx = findWorkspaceWindowIndex(targetId)
    if (idx < 0 || idx >= workspaceWindows.value.length - 1) return
    workspaceWindows.value = workspaceWindows.value.slice(0, idx + 1)
    activeWorkspaceWindowId.value = targetId
    syncWorkspaceSelectionState()
  }

  function closeAllWorkspaceWindows(tab: MainTab = defaultMainTab) {
    const next = createWorkspaceWindowTab(tab)
    workspaceWindows.value = [next]
    workspaceGroups.value = []
    activeWorkspaceGroupId.value = ''
    activeWorkspaceWindowId.value = next.id
    workspaceSplitWindowIds.value = []
    syncWorkspaceSelectionState()
  }

  function splitWorkspaceWindowToRight(windowId: string): boolean {
    const sourceId = String(windowId || '').trim()
    if (!sourceId) return false
    const selectedGroup = getWorkspaceGroupById(activeWorkspaceGroupId.value)
    if (!selectedGroup) return false
    if (!selectedGroup.tabIds.includes(sourceId)) return false
    if (!selectedGroup.splitWindowIds.includes(sourceId)) {
      setWorkspaceGroupSplitWindowIds(selectedGroup.id, [...selectedGroup.splitWindowIds, sourceId])
    }
    activeWorkspaceWindowId.value = ''
    syncWorkspaceSelectionState()
    return Boolean(getWorkspaceGroupById(selectedGroup.id)?.splitWindowIds.includes(sourceId))
  }

  function replaceWorkspaceWindowContent(
    targetWindowId: string | null | undefined,
    sourceWindowId: string | null | undefined,
    opts?: { closeSource?: boolean; activateTarget?: boolean },
  ): boolean {
    const targetId = String(targetWindowId || '').trim()
    const sourceId = String(sourceWindowId || '').trim()
    if (!targetId || !sourceId || targetId === sourceId) return false

    const source = workspaceWindows.value.find((item) => item.id === sourceId)
    const target = workspaceWindows.value.find((item) => item.id === targetId)
    if (!source || !target) return false

    if (opts?.activateTarget !== false) {
      activateWorkspaceWindow(targetId)
    }

    setWorkspaceWindowMainTab(targetId, source.mainTab)
    setWorkspaceWindowRouteQuery(targetId, source.routeQuery)
    setWorkspaceWindowTitle(targetId, source.title)

    if (opts?.closeSource !== false) {
      closeWorkspaceWindow(sourceId)
    }

    return true
  }

  function duplicateWorkspaceWindow(windowId?: string | null): string {
    const targetId = getResolvedWorkspaceWindowId(windowId)
    if (!targetId) return createWorkspaceWindow(defaultMainTab)
    const source = workspaceWindows.value.find((item) => item.id === targetId)
    if (!source) return createWorkspaceWindow(defaultMainTab)
    return createWorkspaceWindow(source.mainTab, { activate: true, query: source.routeQuery, title: source.title })
  }

  function getAdjacentWorkspaceWindowId(direction: 'next' | 'prev', fromWindowId?: string | null): string | null {
    const targetId = getResolvedWorkspaceWindowId(fromWindowId)
    if (!targetId) return null
    const idx = findWorkspaceWindowIndex(targetId)
    if (idx < 0 || workspaceWindows.value.length <= 1) return null
    if (direction === 'next') {
      return workspaceWindows.value[(idx + 1) % workspaceWindows.value.length]?.id || null
    }
    const prevIdx = (idx - 1 + workspaceWindows.value.length) % workspaceWindows.value.length
    return workspaceWindows.value[prevIdx]?.id || null
  }

  function setWorkspaceSplitWindow(windowId: string | null | undefined) {
    const selectedGroup = getWorkspaceGroupById(activeWorkspaceGroupId.value)
    if (!selectedGroup) {
      workspaceSplitWindowIds.value = []
      return
    }

    const id = String(windowId || '').trim()
    if (!id) {
      setWorkspaceGroupSplitWindowIds(selectedGroup.id, [])
      activeWorkspaceWindowId.value = ''
      syncWorkspaceSelectionState()
      return
    }
    if (!selectedGroup.tabIds.includes(id)) {
      setWorkspaceGroupSplitWindowIds(selectedGroup.id, [])
      activeWorkspaceWindowId.value = ''
      syncWorkspaceSelectionState()
      return
    }
    setWorkspaceGroupSplitWindowIds(selectedGroup.id, [id])
    activeWorkspaceWindowId.value = ''
    syncWorkspaceSelectionState()
  }

  function addWorkspaceSplitWindow(windowId: string | null | undefined) {
    const selectedGroup = getWorkspaceGroupById(activeWorkspaceGroupId.value)
    if (!selectedGroup) return

    const id = String(windowId || '').trim()
    if (!id) return
    if (!selectedGroup.tabIds.includes(id)) return
    if (!selectedGroup.splitWindowIds.includes(id)) {
      setWorkspaceGroupSplitWindowIds(selectedGroup.id, [...selectedGroup.splitWindowIds, id])
    }
    activeWorkspaceWindowId.value = ''
    syncWorkspaceSelectionState()
  }

  function removeWorkspaceSplitWindow(windowId: string | null | undefined) {
    const selectedGroup = getWorkspaceGroupById(activeWorkspaceGroupId.value)
    if (!selectedGroup) return

    const id = String(windowId || '').trim()
    if (!id) return
    if (!selectedGroup.splitWindowIds.includes(id)) return

    const nextSplit = selectedGroup.splitWindowIds.filter((item) => item !== id)
    setWorkspaceGroupSplitWindowIds(selectedGroup.id, nextSplit)
    activeWorkspaceWindowId.value = ''
    syncWorkspaceSelectionState()
  }

  function clearWorkspaceSplitWindow() {
    clearWorkspaceSplitWindows()
  }

  function clearWorkspaceSplitWindows() {
    const selectedGroup = getWorkspaceGroupById(activeWorkspaceGroupId.value)
    if (!selectedGroup) {
      workspaceSplitWindowIds.value = []
      return
    }
    setWorkspaceGroupSplitWindowIds(selectedGroup.id, [])
    activeWorkspaceWindowId.value = ''
    syncWorkspaceSelectionState()
  }

  function toggleWorkspaceSplitWindow(windowId: string | null | undefined) {
    const selectedGroup = getWorkspaceGroupById(activeWorkspaceGroupId.value)
    if (!selectedGroup) return

    const id = String(windowId || '').trim()
    if (!id) {
      clearWorkspaceSplitWindows()
      return
    }
    if (!selectedGroup.tabIds.includes(id)) return
    if (selectedGroup.splitWindowIds.includes(id)) {
      removeWorkspaceSplitWindow(id)
      return
    }
    addWorkspaceSplitWindow(id)
  }

  function isWorkspaceWindowInSplit(windowId?: string | null): boolean {
    const id = String(windowId || '').trim()
    if (!id) return false
    const selectedGroup = getWorkspaceGroupById(activeWorkspaceGroupId.value)
    if (!selectedGroup) return false
    return selectedGroup.splitWindowIds.includes(id)
  }

  function positiveIntOrUndefined(raw: unknown): number | undefined {
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0) return undefined
    return Math.floor(value)
  }

  function trimmedStringOrUndefined(raw: unknown): string | undefined {
    const value = typeof raw === 'string' ? raw.trim() : ''
    return value || undefined
  }

  function requestWorkspaceDockFile(
    path: string,
    action: WorkspaceDockFileAction = 'open',
    location?: { line?: number | null; column?: number | null; anchor?: string | null },
  ) {
    const targetPath = String(path || '').trim()
    if (!targetPath) return

    const line = positiveIntOrUndefined(location?.line)
    const column = positiveIntOrUndefined(location?.column)
    const anchor = trimmedStringOrUndefined(location?.anchor)

    workspaceDockPanel.value = 'files'
    workspaceDockPlacement.value = 'right'
    isWorkspaceDockOpen.value = true
    workspaceDockFileRequest.value = {
      path: targetPath,
      action: action === 'reveal' ? 'reveal' : 'open',
      ...(line ? { line } : {}),
      ...(column ? { column } : {}),
      ...(anchor ? { anchor } : {}),
    }
    workspaceDockFileRequestSeq.value += 1
  }

  function setWorkspaceDockPlacement(_placement: WorkspaceDockPlacement) {
    workspaceDockPlacement.value = 'right'
  }

  function openAndLocateSessionInSidebar(sessionId: string | null) {
    const sid = (sessionId || '').trim()
    if (isCompactLayout.value) {
      isSessionSwitcherOpen.value = true
    } else {
      setSidebarOpen(true, { preserveWidth: true })
    }
    sidebarLocateSessionId.value = sid || null
    sidebarLocateSeq.value += 1
  }

  function clearSidebarLocateRequest() {
    sidebarLocateSessionId.value = null
  }

  function setActiveMainTab(tab: MainTab) {
    const targetId = getResolvedWorkspaceWindowId()
    if (!targetId) {
      createWorkspaceWindow(tab, { activate: true })
      return
    }

    const idx = findWorkspaceWindowIndex(targetId)
    if (idx < 0) {
      createWorkspaceWindow(tab, { activate: true })
      return
    }

    const current = workspaceWindows.value[idx]
    if (!current || current.mainTab === tab) return

    workspaceWindows.value = workspaceWindows.value.map((item, itemIdx) =>
      itemIdx === idx
        ? (() => {
            const next = {
              ...item,
              mainTab: tab,
            }
            const { title: _ignored, ...rest } = next
            return rest
          })()
        : item,
    )
  }

  function enableSessionQuery() {
    sessionQueryEnabled.value = true
  }

  function disableSessionQuery() {
    sessionQueryEnabled.value = false
  }

  function toggleHelpDialog() {
    isHelpDialogOpen.value = !isHelpDialogOpen.value
  }
  function setMcpDialogOpen(open: boolean) {
    isMcpDialogOpen.value = open
  }

  function normalizeImageViewerItems(items: ImageViewerItem[]): ImageViewerItem[] {
    if (!Array.isArray(items)) return []
    const out: ImageViewerItem[] = []
    for (const item of items) {
      const src = String(item?.src || '').trim()
      if (!src) continue
      const title = String(item?.title || '').trim()
      const alt = String(item?.alt || '').trim()
      const key = String(item?.key || '').trim()
      out.push({
        src,
        ...(title ? { title } : {}),
        ...(alt ? { alt } : {}),
        ...(key ? { key } : {}),
      })
    }
    return out
  }

  function clampImageViewerIndex(index: number): number {
    const size = imageViewerItems.value.length
    if (!size) return 0
    const n = Number.isFinite(index) ? Math.floor(index) : 0
    if (n < 0) return 0
    if (n >= size) return size - 1
    return n
  }

  function openImageViewer(items: ImageViewerItem[], index = 0) {
    const normalized = normalizeImageViewerItems(items)
    if (!normalized.length) return

    imageViewerItems.value = normalized
    imageViewerActiveIndex.value = clampImageViewerIndex(index)
    imageViewerZoom.value = 1
    isImageViewerOpen.value = true
  }

  function closeImageViewer() {
    isImageViewerOpen.value = false
    imageViewerZoom.value = 1
  }

  function setImageViewerIndex(index: number) {
    imageViewerActiveIndex.value = clampImageViewerIndex(index)
    imageViewerZoom.value = 1
  }

  function nextImageViewerItem() {
    const size = imageViewerItems.value.length
    if (size <= 1) return
    imageViewerActiveIndex.value = (imageViewerActiveIndex.value + 1) % size
    imageViewerZoom.value = 1
  }

  function prevImageViewerItem() {
    const size = imageViewerItems.value.length
    if (size <= 1) return
    imageViewerActiveIndex.value = (imageViewerActiveIndex.value - 1 + size) % size
    imageViewerZoom.value = 1
  }

  function setImageViewerZoom(zoom: number) {
    const value = Number(zoom)
    if (!Number.isFinite(value)) return
    imageViewerZoom.value = Math.max(0.2, Math.min(5, value))
  }

  function zoomImageViewerIn(step = 0.2) {
    setImageViewerZoom(imageViewerZoom.value + Math.max(0.05, step))
  }

  function zoomImageViewerOut(step = 0.2) {
    setImageViewerZoom(imageViewerZoom.value - Math.max(0.05, step))
  }

  function resetImageViewerZoom() {
    imageViewerZoom.value = 1
  }

  function requestSessionAction(actionId: string) {
    const id = String(actionId || '').trim()
    if (!id) return
    sessionActionId.value = id
    sessionActionSeq.value += 1
  }

  function clearSessionActionRequest() {
    sessionActionId.value = null
  }

  function armAbortPrompt(sessionId: string, durationMs: number): number {
    const expiresAt = Date.now() + Math.max(250, durationMs)
    abortPromptSessionId.value = sessionId
    abortPromptExpiresAt.value = expiresAt
    return expiresAt
  }
  function clearAbortPrompt() {
    abortPromptSessionId.value = null
    abortPromptExpiresAt.value = null
  }

  return {
    isCompactLayout,
    isMobileDevice,
    isTouchPointer,
    isMobile,
    isMobilePointer,
    isSidebarOpen,
    sidebarWidth,
    effectiveSidebarWidth,
    isSessionSwitcherOpen,
    isWorkspaceDockOpen,
    gitHistorySearchExpanded,
    sidebarLocateSeq,
    sidebarLocateSessionId,
    workspaceDockPanel,
    workspaceDockFileRequest,
    workspaceDockFileRequestSeq,
    workspaceDockPlacement,
    workspaceDockWidth,
    workspaceDockHeight,
    workspaceSplitWindowId,
    workspaceSplitWindowIds,
    workspaceVisibleWindowIds,
    workspaceSplitWidth,
    workspaceWindowDragId,
    workspaceGroups,
    activeWorkspaceGroupId,
    activeWorkspaceGroup,
    workspaceWindows,
    activeWorkspaceWindowId,
    activeWorkspaceWindow,
    focusedWorkspaceWindowId,
    activeMainTab,
    isHelpDialogOpen,
    isMcpDialogOpen,
    isImageViewerOpen,
    imageViewerItems,
    imageViewerActiveItem,
    imageViewerActiveIndex,
    imageViewerZoom,
    sessionActionSeq,
    sessionActionId,
    sessionQueryEnabled,
    setIsCompactLayout,
    setIsMobileDevice,
    setIsTouchPointer,
    setIsMobile,
    setIsMobilePointer,
    toggleSidebar,
    setSessionSwitcherOpen,
    setWorkspaceDockOpen,
    toggleWorkspaceDock,
    setWorkspaceDockPanel,
    requestWorkspaceDockFile,
    setWorkspaceDockPlacement,
    beginWorkspaceWindowDrag,
    endWorkspaceWindowDrag,
    getWorkspaceGroupById,
    getWorkspaceGroupSplitPaneRatios,
    setWorkspaceGroupSplitPaneRatios,
    selectWorkspaceGroup,
    selectWorkspaceWindow,
    clearWorkspaceSelection,
    isWorkspaceGroupSelected,
    activateWorkspaceGroup,
    createWorkspaceGroup,
    closeWorkspaceGroup,
    setWorkspaceGroupCollapsed,
    toggleWorkspaceGroupCollapsed,
    restoreWorkspaceGroupLayout,
    ensureWorkspaceWindowInGroupSplit,
    removeWorkspaceWindowFromGroupSplit,
    moveWorkspaceWindowToGroup,
    ungroupWorkspaceWindow,
    getWorkspaceWindowById,
    findWorkspaceWindowByTabAndQuery,
    createWorkspaceWindow,
    openWorkspaceWindow,
    activateWorkspaceWindow,
    setFocusedWorkspaceWindow,
    setWorkspaceWindowMainTab,
    setWorkspaceWindowRouteQuery,
    setActiveWorkspaceWindowRouteQuery,
    syncActiveWorkspaceWindowFromRoute,
    closeWorkspaceWindow,
    closeOtherWorkspaceWindows,
    closeWorkspaceWindowsToLeft,
    closeWorkspaceWindowsToRight,
    closeAllWorkspaceWindows,
    splitWorkspaceWindowToRight,
    replaceWorkspaceWindowContent,
    duplicateWorkspaceWindow,
    getAdjacentWorkspaceWindowId,
    setWorkspaceSplitWindow,
    addWorkspaceSplitWindow,
    removeWorkspaceSplitWindow,
    clearWorkspaceSplitWindow,
    clearWorkspaceSplitWindows,
    toggleWorkspaceSplitWindow,
    isWorkspaceWindowInSplit,
    setWorkspaceWindowTitle,
    setActiveWorkspaceWindowTitle,
    resolveWorkspaceWindowIdFromRouteQuery,
    setWorkspaceWindowTitleFromRoute,
    openAndLocateSessionInSidebar,
    clearSidebarLocateRequest,
    setActiveMainTab,
    enableSessionQuery,
    disableSessionQuery,
    toggleHelpDialog,
    setMcpDialogOpen,
    openImageViewer,
    closeImageViewer,
    setImageViewerIndex,
    nextImageViewerItem,
    prevImageViewerItem,
    setImageViewerZoom,
    zoomImageViewerIn,
    zoomImageViewerOut,
    resetImageViewerZoom,
    requestSessionAction,
    clearSessionActionRequest,
    armAbortPrompt,
    clearAbortPrompt,
  }
})

import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { isMainTabId, type MainTabId } from '@/app/navigation/mainTabs'
import { DEFAULT_WINDOW_SCOPE_ID, normalizeWindowScopeId, resolveWindowScopeId } from '@/app/windowScope'
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
  tabIds: string[]
  activeWindowId: string
  createdAt: number
}

export type GlobalSelectionKind =
  | 'workspace-window'
  | 'workspace-tab'
  | 'chat-session'
  | 'chat-message'
  | 'chat-input'
  | 'chat-text'
  | 'files-root'
  | 'files-directory'
  | 'files-file'
  | 'files-editor'
  | 'files-selection'

export type GlobalSelectionMeta = Record<string, string | number | boolean | null>

export type GlobalSelectionTarget = {
  kind: GlobalSelectionKind
  id: string
  at: number
  meta?: GlobalSelectionMeta
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

function normalizePaneRatiosByIds(raw: unknown, rawIds: string[]): Record<string, number> {
  const ids = normalizeIdList(rawIds)
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

function arePaneRatiosEqualByIds(
  left: Record<string, number> | null | undefined,
  right: Record<string, number> | null | undefined,
  rawIds: string[],
): boolean {
  const ids = normalizeIdList(rawIds)
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
const STORAGE_WORKSPACE_GROUP_PANE_RATIOS = localStorageKeys.ui.workspaceGroupPaneRatios
const STORAGE_WORKSPACE_WINDOWS = localStorageKeys.ui.workspaceWindows
const STORAGE_ACTIVE_WORKSPACE_WINDOW_ID = localStorageKeys.ui.activeWorkspaceWindowId
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
      return Number.isFinite(n) ? Math.min(520, Math.max(280, n)) : 320
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
    tabIds?: string[]
    activeWindowId?: string
    createdAt?: number
  }): WorkspaceWindowGroup {
    const groupId = String(opts?.id || '').trim() || nextWorkspaceGroupId()
    const tabIds = normalizeIdList(opts?.tabIds)
    const preferredActive = String(opts?.activeWindowId || '').trim()
    const activeWindowId =
      preferredActive && tabIds.includes(preferredActive)
        ? preferredActive
        : tabIds[0] || String(preferredActive || '').trim()

    const createdAtRaw = Number(opts?.createdAt)
    const createdAt = Number.isFinite(createdAtRaw) && createdAtRaw > 0 ? Math.floor(createdAtRaw) : Date.now()

    return {
      id: groupId,
      tabIds,
      activeWindowId,
      createdAt,
    }
  }

  function normalizeWorkspaceWindowGroup(raw: unknown): WorkspaceWindowGroup | null {
    if (!raw || typeof raw !== 'object') return null
    const source = raw as Record<string, unknown>

    const id = String(source.id || '').trim()
    if (!id) return null

    const tabIds = normalizeIdList(source.tabIds)
    const activeWindowId = String(source.activeWindowId || '').trim()

    const group = createWorkspaceWindowGroup({
      id,
      tabIds,
      activeWindowId,
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
      return list
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

  const globalSelectionByWindow = ref<Record<string, GlobalSelectionTarget>>({})

  function normalizeGlobalSelectionMeta(
    input: GlobalSelectionMeta | null | undefined,
  ): GlobalSelectionMeta | undefined {
    if (!input || typeof input !== 'object') return undefined
    const out: GlobalSelectionMeta = {}
    for (const [rawKey, value] of Object.entries(input)) {
      const key = String(rawKey || '').trim()
      if (!key) continue
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
        out[key] = value
      }
    }
    return Object.keys(out).length > 0 ? out : undefined
  }

  function areGlobalSelectionMetaEqual(
    left: GlobalSelectionMeta | null | undefined,
    right: GlobalSelectionMeta | null | undefined,
  ): boolean {
    const a = left || {}
    const b = right || {}
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) return false
    for (const key of aKeys) {
      if (a[key] !== b[key]) return false
    }
    return true
  }

  function resolveGlobalSelectionScopeId(windowId?: string | null): string {
    return resolveWindowScopeId({
      fallback: windowId || activeWorkspaceWindowId.value,
      defaultScope: DEFAULT_WINDOW_SCOPE_ID,
    })
  }

  const activeGlobalSelection = computed<GlobalSelectionTarget | null>(() => {
    const scopeId = resolveGlobalSelectionScopeId()
    return globalSelectionByWindow.value[scopeId] || null
  })

  function getGlobalSelection(windowId?: string | null): GlobalSelectionTarget | null {
    const scopeId = resolveGlobalSelectionScopeId(windowId)
    return globalSelectionByWindow.value[scopeId] || null
  }

  function setGlobalSelection(
    kind: GlobalSelectionKind,
    id?: string | null,
    opts?: { windowId?: string | null; meta?: GlobalSelectionMeta | null },
  ) {
    const scopeId = resolveGlobalSelectionScopeId(opts?.windowId)
    const selectionId = String(id || '').trim() || kind
    const meta = normalizeGlobalSelectionMeta(opts?.meta)
    const previous = globalSelectionByWindow.value[scopeId]
    if (
      previous &&
      previous.kind === kind &&
      previous.id === selectionId &&
      areGlobalSelectionMetaEqual(previous.meta, meta)
    ) {
      return
    }

    globalSelectionByWindow.value = {
      ...globalSelectionByWindow.value,
      [scopeId]: {
        kind,
        id: selectionId,
        at: Date.now(),
        ...(meta ? { meta } : {}),
      },
    }
  }

  function clearGlobalSelection(windowId?: string | null) {
    const scopeId = resolveGlobalSelectionScopeId(windowId)
    if (!globalSelectionByWindow.value[scopeId]) return
    const next = { ...globalSelectionByWindow.value }
    delete next[scopeId]
    globalSelectionByWindow.value = next
  }

  const workspaceWindowDragId = ref('')
  const suppressedRouteWindowIds = new Set<string>()
  const suppressedRouteWindowIdsQueue: string[] = []
  const MAX_SUPPRESSED_ROUTE_WINDOW_IDS = 64

  function suppressRouteWindowRestore(windowId?: string | null) {
    const id = String(windowId || '').trim()
    if (!id) return

    if (!suppressedRouteWindowIds.has(id)) {
      suppressedRouteWindowIds.add(id)
    } else {
      const existingIdx = suppressedRouteWindowIdsQueue.indexOf(id)
      if (existingIdx >= 0) {
        suppressedRouteWindowIdsQueue.splice(existingIdx, 1)
      }
    }

    suppressedRouteWindowIdsQueue.push(id)
    while (suppressedRouteWindowIdsQueue.length > MAX_SUPPRESSED_ROUTE_WINDOW_IDS) {
      const removed = suppressedRouteWindowIdsQueue.shift()
      if (removed) {
        suppressedRouteWindowIds.delete(removed)
      }
    }
  }

  function isRouteWindowRestoreSuppressed(windowId?: string | null): boolean {
    const id = String(windowId || '').trim()
    if (!id) return false
    return suppressedRouteWindowIds.has(id)
  }

  function clearSuppressedRouteWindowRestore(windowId?: string | null) {
    const id = String(windowId || '').trim()
    if (!id) return
    if (!suppressedRouteWindowIds.delete(id)) return
    const idx = suppressedRouteWindowIdsQueue.indexOf(id)
    if (idx >= 0) {
      suppressedRouteWindowIdsQueue.splice(idx, 1)
    }
  }

  function getWorkspaceWindowById(windowId?: string | null): WorkspaceWindowTab | null {
    const id = String(windowId || '').trim()
    if (!id) return null
    return workspaceWindows.value.find((item) => item.id === id) || null
  }

  function ensureWorkspaceWindows() {
    if (!workspaceWindows.value.length) {
      activeWorkspaceWindowId.value = ''
      return
    }
    if (workspaceWindows.value.some((item) => item.id === activeWorkspaceWindowId.value)) return
    activeWorkspaceWindowId.value = workspaceWindows.value[0]?.id || ''
  }

  function setFocusedWorkspaceWindow(windowId?: string | null) {
    const id = String(windowId || '').trim()
    if (!id) return
    activateWorkspaceWindow(id)
  }

  function retainGlobalSelectionsForWindows(windowIds: string[]) {
    const keep = new Set((windowIds || []).map((id) => normalizeWindowScopeId(id, '')).filter(Boolean))
    keep.add(DEFAULT_WINDOW_SCOPE_ID)

    const next: Record<string, GlobalSelectionTarget> = {}
    for (const [scopeIdRaw, target] of Object.entries(globalSelectionByWindow.value)) {
      const scopeId = normalizeWindowScopeId(scopeIdRaw, '')
      if (!scopeId) continue
      if (!keep.has(scopeId)) continue
      next[scopeId] = target
    }
    globalSelectionByWindow.value = next
  }

  watch(
    workspaceWindows,
    (list) => {
      ensureWorkspaceWindows()
      if (workspaceWindowDragId.value && !list.some((item) => item.id === workspaceWindowDragId.value)) {
        workspaceWindowDragId.value = ''
      }
      retainGlobalSelectionsForWindows(list.map((item) => item.id))
      setLocalJson(STORAGE_WORKSPACE_WINDOWS, list)
    },
    { deep: true },
  )

  watch(activeWorkspaceWindowId, (v) => {
    setLocalString(STORAGE_ACTIVE_WORKSPACE_WINDOW_ID, String(v || ''))
  })

  watch(
    activeWorkspaceWindowId,
    (windowId) => {
      const id = String(windowId || '').trim()
      if (!id) return
      setGlobalSelection('workspace-window', id, {
        windowId: id,
        meta: { source: 'window-activation' },
      })
    },
    { immediate: true },
  )

  const activeMainTabFallback = ref<MainTab>(defaultMainTab)
  const activeMainTab = computed<MainTab>(() => activeWorkspaceWindow.value?.mainTab || activeMainTabFallback.value)
  watch(
    activeWorkspaceWindow,
    (windowTab) => {
      const nextTab = windowTab?.mainTab
      if (!nextTab) return
      activeMainTabFallback.value = nextTab
    },
    { immediate: true },
  )
  watch(activeMainTab, (v) => setLocalString(STORAGE_ACTIVE_TAB, v), { immediate: true })

  const workspaceSplitWidth = ref<number>(520)

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

  const workspaceGroupPaneRatiosById = ref<Record<string, number>>(
    (() => {
      const persisted = getLocalJson<unknown>(STORAGE_WORKSPACE_GROUP_PANE_RATIOS, {})
      return persisted && typeof persisted === 'object' ? (persisted as Record<string, number>) : {}
    })(),
  )

  const activeWorkspaceGroupId = ref<string>(
    (() => {
      const raw = getLocalString(STORAGE_ACTIVE_WORKSPACE_GROUP_ID).trim()
      if (raw && workspaceGroups.value.some((item) => item.id === raw)) return raw
      return workspaceGroups.value[0]?.id || ''
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
      if (left.id !== right.id || left.activeWindowId !== right.activeWindowId || left.createdAt !== right.createdAt) {
        return false
      }
      if (left.tabIds.length !== right.tabIds.length) return false
      for (let j = 0; j < left.tabIds.length; j += 1) {
        if (left.tabIds[j] !== right.tabIds[j]) return false
      }
    }
    return true
  }

  function sanitizeWorkspaceGroup(group: WorkspaceWindowGroup, assignedWindowIds: Set<string>): WorkspaceWindowGroup {
    const windowsById = new Map(workspaceWindows.value.map((item) => [item.id, item] as const))
    const tabIds: string[] = []
    const seenIdentity = new Set<string>()

    for (const rawId of group.tabIds || []) {
      const id = String(rawId || '').trim()
      if (!id || assignedWindowIds.has(id)) continue
      const windowTab = windowsById.get(id)
      if (!windowTab) continue

      const identity = buildWorkspaceWindowIdentity(
        windowTab.mainTab,
        windowTab.routeQuery,
        defaultMatchKeysForMainTab(windowTab.mainTab),
      )
      if (seenIdentity.has(identity)) continue

      seenIdentity.add(identity)
      assignedWindowIds.add(id)
      tabIds.push(id)
    }

    const preferredActive = String(group.activeWindowId || '').trim()
    const activeWindowId = preferredActive && tabIds.includes(preferredActive) ? preferredActive : tabIds[0] || ''

    return {
      id: String(group.id || '').trim() || nextWorkspaceGroupId(),
      tabIds,
      activeWindowId,
      createdAt: Number.isFinite(Number(group.createdAt)) ? Number(group.createdAt) : Date.now(),
    }
  }

  function getWorkspaceWindowGroupId(windowId?: string | null): string {
    const id = String(windowId || '').trim()
    if (!id) return ''
    for (const group of workspaceGroups.value) {
      if (group.tabIds.includes(id)) return group.id
    }
    return ''
  }

  function ensureWorkspaceGroups() {
    const assignedWindowIds = new Set<string>()
    let nextGroups = workspaceGroups.value
      .map((group) => sanitizeWorkspaceGroup(group, assignedWindowIds))
      .filter((group) => group.tabIds.length > 0)

    const unassigned = workspaceWindows.value.map((item) => item.id).filter((id) => !assignedWindowIds.has(id))

    if (!nextGroups.length && (unassigned.length || workspaceWindows.value.length > 0)) {
      const fallbackId = unassigned[0] || workspaceWindows.value[0]?.id || ''
      nextGroups = [
        createWorkspaceWindowGroup({
          tabIds: fallbackId ? [fallbackId] : [],
          activeWindowId: fallbackId,
        }),
      ]
      if (fallbackId) assignedWindowIds.add(fallbackId)
    }

    if (unassigned.length > 0 && nextGroups.length > 0) {
      const first = nextGroups[0]
      const mergedTabIds = normalizeIdList([...first.tabIds, ...unassigned])
      const mergedActiveWindowId =
        first.activeWindowId && mergedTabIds.includes(first.activeWindowId)
          ? first.activeWindowId
          : mergedTabIds[0] || ''
      nextGroups = [
        {
          ...first,
          tabIds: mergedTabIds,
          activeWindowId: mergedActiveWindowId,
        },
        ...nextGroups.slice(1),
      ]
    }

    if (!areWorkspaceGroupsEqual(nextGroups, workspaceGroups.value)) {
      workspaceGroups.value = nextGroups
    }

    if (workspaceGroups.value.some((item) => item.id === activeWorkspaceGroupId.value)) return
    activeWorkspaceGroupId.value = workspaceGroups.value[0]?.id || ''
  }

  function getWorkspaceGroupById(groupId?: string | null): WorkspaceWindowGroup | null {
    const id = String(groupId || '').trim()
    if (!id) return null
    return workspaceGroups.value.find((item) => item.id === id) || null
  }

  function getWorkspacePaneRatios(): number[] {
    const ids = workspaceGroups.value.map((group) => group.id)
    if (!ids.length) return []
    const normalized = normalizePaneRatiosByIds(workspaceGroupPaneRatiosById.value, ids)
    return ids.map((id) => Number(normalized[id] || 0)).filter((ratio) => ratio > 0)
  }

  function setWorkspacePaneRatios(rawRatios: number[]): boolean {
    const ids = workspaceGroups.value.map((group) => group.id)
    if (!ids.length) return false

    const source = Array.isArray(rawRatios) ? rawRatios : []
    const byId: Record<string, number> = {}
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i]
      const candidate = Number(source[i])
      if (Number.isFinite(candidate) && candidate > 0) {
        byId[id] = candidate
      }
    }

    const next = normalizePaneRatiosByIds(byId, ids)
    if (arePaneRatiosEqualByIds(workspaceGroupPaneRatiosById.value, next, ids)) return true
    workspaceGroupPaneRatiosById.value = next
    return true
  }

  function setWorkspaceGroupSplitPaneRatios(_groupId: string, rawRatios: number[]): boolean {
    return setWorkspacePaneRatios(rawRatios)
  }

  function getWorkspaceGroupSplitPaneRatios(_groupId: string): number[] {
    return getWorkspacePaneRatios()
  }

  function rebalanceWorkspacePaneRatiosEvenly() {
    const nextIds = workspaceGroups.value.map((group) => group.id)
    if (!nextIds.length) return

    const nextRatios = normalizePaneRatiosByIds({}, nextIds)
    if (arePaneRatiosEqualByIds(workspaceGroupPaneRatiosById.value, nextRatios, nextIds)) return
    workspaceGroupPaneRatiosById.value = nextRatios
  }

  function rebalanceWorkspacePaneRatiosOnGroupGrowth(previousGroupCount: number) {
    const nextIds = workspaceGroups.value.map((group) => group.id)
    if (!(nextIds.length > previousGroupCount)) return
    rebalanceWorkspacePaneRatiosEvenly()
  }

  function setWorkspaceGroupTabs(groupId: string, tabIds: string[], opts?: { activeWindowId?: string }) {
    const targetId = String(groupId || '').trim()
    if (!targetId) return false
    const idx = workspaceGroups.value.findIndex((item) => item.id === targetId)
    if (idx < 0) return false

    const normalizedTabIds = normalizeIdList(tabIds).filter((id) =>
      workspaceWindows.value.some((item) => item.id === id),
    )
    const preferredActive = String(opts?.activeWindowId || '').trim()
    const activeWindowId =
      preferredActive && normalizedTabIds.includes(preferredActive)
        ? preferredActive
        : workspaceGroups.value[idx].activeWindowId &&
            normalizedTabIds.includes(workspaceGroups.value[idx].activeWindowId)
          ? workspaceGroups.value[idx].activeWindowId
          : normalizedTabIds[0] || ''

    workspaceGroups.value = workspaceGroups.value.map((group, groupIdx) =>
      groupIdx === idx
        ? {
            ...group,
            tabIds: normalizedTabIds,
            activeWindowId,
          }
        : group,
    )
    return true
  }

  function syncWorkspaceSelectionState() {
    ensureWorkspaceWindows()
    ensureWorkspaceGroups()

    if (!workspaceWindows.value.length) {
      activeWorkspaceGroupId.value = ''
      activeWorkspaceWindowId.value = ''
      return
    }

    let group = getWorkspaceGroupById(activeWorkspaceGroupId.value)
    if (!group && activeWorkspaceWindowId.value) {
      const locatedGroupId = getWorkspaceWindowGroupId(activeWorkspaceWindowId.value)
      group = getWorkspaceGroupById(locatedGroupId)
    }
    if (!group) {
      group = workspaceGroups.value[0] || null
    }

    if (!group) {
      activeWorkspaceGroupId.value = ''
      activeWorkspaceWindowId.value = workspaceWindows.value[0]?.id || ''
      return
    }

    activeWorkspaceGroupId.value = group.id
    const activeWindowId =
      group.activeWindowId && group.tabIds.includes(group.activeWindowId) ? group.activeWindowId : group.tabIds[0] || ''

    if (activeWindowId !== group.activeWindowId) {
      setWorkspaceGroupTabs(group.id, group.tabIds, { activeWindowId })
    }

    activeWorkspaceWindowId.value = activeWindowId

    const groupIds = workspaceGroups.value.map((item) => item.id)
    const normalizedRatios = normalizePaneRatiosByIds(workspaceGroupPaneRatiosById.value, groupIds)
    if (!arePaneRatiosEqualByIds(workspaceGroupPaneRatiosById.value, normalizedRatios, groupIds)) {
      workspaceGroupPaneRatiosById.value = normalizedRatios
    }
  }

  const workspaceVisibleWindowIds = computed<string[]>(() => {
    const valid = new Set(workspaceWindows.value.map((item) => item.id))
    const out: string[] = []
    for (const group of workspaceGroups.value) {
      const activeId =
        group.activeWindowId && group.tabIds.includes(group.activeWindowId)
          ? group.activeWindowId
          : group.tabIds[0] || ''
      if (!activeId || !valid.has(activeId)) continue
      out.push(activeId)
    }
    return out
  })

  const workspaceSplitWindowIds = computed<string[]>(() => workspaceVisibleWindowIds.value)

  const workspaceSplitWindowId = computed<string>(() => workspaceVisibleWindowIds.value[0] || '')

  function selectWorkspaceGroup(groupId: string): boolean {
    const targetId = String(groupId || '').trim()
    if (!targetId) return false
    const group = getWorkspaceGroupById(targetId)
    if (!group) return false

    activeWorkspaceGroupId.value = targetId
    const nextActive =
      group.activeWindowId && group.tabIds.includes(group.activeWindowId) ? group.activeWindowId : group.tabIds[0] || ''
    if (nextActive && nextActive !== group.activeWindowId) {
      setWorkspaceGroupTabs(targetId, group.tabIds, { activeWindowId: nextActive })
    }
    activeWorkspaceWindowId.value = nextActive
    syncWorkspaceSelectionState()
    return true
  }

  function selectWorkspaceWindow(windowId: string): boolean {
    const targetId = String(windowId || '').trim()
    if (!targetId) return false
    if (!workspaceWindows.value.some((item) => item.id === targetId)) return false

    const groupId = getWorkspaceWindowGroupId(targetId)
    if (!groupId) return false

    const group = getWorkspaceGroupById(groupId)
    if (!group) return false

    setWorkspaceGroupTabs(groupId, group.tabIds, { activeWindowId: targetId })
    activeWorkspaceGroupId.value = groupId
    activeWorkspaceWindowId.value = targetId
    setGlobalSelection('workspace-tab', targetId, {
      windowId: targetId,
      meta: { source: 'workspace-tab-click' },
    })
    syncWorkspaceSelectionState()
    return true
  }

  function clearWorkspaceSelection() {
    activeWorkspaceGroupId.value = ''
    activeWorkspaceWindowId.value = ''
  }

  function restoreWorkspaceGroupLayout(groupId: string, opts?: { focusedWindowId?: string }) {
    const targetId = String(groupId || '').trim()
    if (!targetId) return
    if (!selectWorkspaceGroup(targetId)) return

    const requested = String(opts?.focusedWindowId || '').trim()
    if (!requested) return
    const group = getWorkspaceGroupById(targetId)
    if (!group || !group.tabIds.includes(requested)) return
    setWorkspaceGroupTabs(targetId, group.tabIds, { activeWindowId: requested })
    activeWorkspaceWindowId.value = requested
    syncWorkspaceSelectionState()
  }

  function activateWorkspaceGroup(groupId: string) {
    void selectWorkspaceGroup(groupId)
  }

  function createWorkspaceGroup(): string {
    const previousGroupCount = workspaceGroups.value.length

    const next = createWorkspaceWindowGroup({
      tabIds: activeWorkspaceWindowId.value ? [activeWorkspaceWindowId.value] : [],
      activeWindowId: activeWorkspaceWindowId.value,
    })
    const activeGroupIndex = workspaceGroups.value.findIndex((group) => group.id === activeWorkspaceGroupId.value)
    const insertAt = activeGroupIndex >= 0 ? activeGroupIndex + 1 : workspaceGroups.value.length
    workspaceGroups.value = [
      ...workspaceGroups.value.slice(0, insertAt),
      next,
      ...workspaceGroups.value.slice(insertAt),
    ]
    rebalanceWorkspacePaneRatiosOnGroupGrowth(previousGroupCount)

    activeWorkspaceGroupId.value = next.id
    activeWorkspaceWindowId.value = next.activeWindowId
    syncWorkspaceSelectionState()
    return next.id
  }

  function closeWorkspaceGroup(groupId: string): boolean {
    const targetId = String(groupId || '').trim()
    if (!targetId) return false
    const target = getWorkspaceGroupById(targetId)
    if (!target) return false

    const removeIds = new Set(target.tabIds)
    workspaceWindows.value = workspaceWindows.value.filter((item) => !removeIds.has(item.id))
    workspaceGroups.value = workspaceGroups.value.filter((item) => item.id !== targetId)

    if (activeWorkspaceGroupId.value === targetId) {
      activeWorkspaceGroupId.value = workspaceGroups.value[0]?.id || ''
    }
    syncWorkspaceSelectionState()
    return true
  }

  function setWorkspaceGroupCollapsed(groupId: string, collapsed: boolean): boolean {
    void groupId
    void collapsed
    return false
  }

  function toggleWorkspaceGroupCollapsed(groupId: string): boolean {
    void groupId
    return false
  }

  function ensureWorkspaceWindowInGroupSplit(groupId: string, windowId: string): boolean {
    const targetGroupId = String(groupId || '').trim()
    const targetWindowId = String(windowId || '').trim()
    if (!targetGroupId || !targetWindowId) return false
    const group = getWorkspaceGroupById(targetGroupId)
    if (!group) return false
    if (!workspaceWindows.value.some((item) => item.id === targetWindowId)) return false

    const nextTabIds = group.tabIds.includes(targetWindowId) ? group.tabIds : [...group.tabIds, targetWindowId]
    setWorkspaceGroupTabs(targetGroupId, nextTabIds, { activeWindowId: targetWindowId })
    if (activeWorkspaceGroupId.value === targetGroupId) {
      activeWorkspaceWindowId.value = targetWindowId
    }
    syncWorkspaceSelectionState()
    return true
  }

  function removeWorkspaceWindowFromGroupSplit(groupId: string, windowId: string): boolean {
    const targetGroupId = String(groupId || '').trim()
    const targetWindowId = String(windowId || '').trim()
    if (!targetGroupId || !targetWindowId) return false
    const group = getWorkspaceGroupById(targetGroupId)
    if (!group) return false

    if (!group.tabIds.includes(targetWindowId)) return false
    const nextTabIds = group.tabIds.filter((id) => id !== targetWindowId)
    setWorkspaceGroupTabs(targetGroupId, nextTabIds)
    if (activeWorkspaceGroupId.value === targetGroupId) {
      activeWorkspaceWindowId.value = getWorkspaceGroupById(targetGroupId)?.activeWindowId || ''
    }
    syncWorkspaceSelectionState()
    return true
  }

  function moveWorkspaceGroupToIndex(groupId: string, atIndex: number): boolean {
    const targetGroupId = String(groupId || '').trim()
    if (!targetGroupId) return false

    const sourceIndex = workspaceGroups.value.findIndex((group) => group.id === targetGroupId)
    if (sourceIndex < 0) return false

    const nextGroups = [...workspaceGroups.value]
    const [targetGroup] = nextGroups.splice(sourceIndex, 1)
    if (!targetGroup) return false

    let desiredIndex = Number.isFinite(atIndex) ? Math.floor(atIndex) : nextGroups.length
    if (sourceIndex < desiredIndex) {
      desiredIndex -= 1
    }
    desiredIndex = Math.max(0, Math.min(nextGroups.length, desiredIndex))

    if (desiredIndex === sourceIndex) return true

    nextGroups.splice(desiredIndex, 0, targetGroup)
    if (areWorkspaceGroupsEqual(nextGroups, workspaceGroups.value)) return true

    workspaceGroups.value = nextGroups
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

    if (!workspaceGroups.value.some((item) => item.id === destinationGroupId)) return false

    workspaceGroups.value = workspaceGroups.value.map((group) => {
      if (group.id === destinationGroupId) {
        const tabIds = group.tabIds.includes(sourceWindowId) ? group.tabIds : [...group.tabIds, sourceWindowId]
        const activeWindowId = sourceWindowId
        return {
          ...group,
          tabIds,
          activeWindowId,
        }
      }

      if (!group.tabIds.includes(sourceWindowId)) return group
      const tabIds = group.tabIds.filter((id) => id !== sourceWindowId)
      const activeWindowId = group.activeWindowId === sourceWindowId ? tabIds[0] || '' : group.activeWindowId
      return {
        ...group,
        tabIds,
        activeWindowId,
      }
    })

    workspaceGroups.value = workspaceGroups.value.filter((group) => group.tabIds.length > 0)

    if (opts?.activateTargetGroup || activeWorkspaceGroupId.value === destinationGroupId) {
      activeWorkspaceGroupId.value = destinationGroupId
      activeWorkspaceWindowId.value = sourceWindowId
    }

    syncWorkspaceSelectionState()
    return true
  }

  function ungroupWorkspaceWindow(windowId: string): boolean {
    const sourceWindowId = String(windowId || '').trim()
    if (!sourceWindowId) return false
    if (!workspaceWindows.value.some((item) => item.id === sourceWindowId)) return false

    const sourceGroupId = getWorkspaceWindowGroupId(sourceWindowId)
    if (!sourceGroupId) return false
    const sourceGroupIndex = workspaceGroups.value.findIndex((group) => group.id === sourceGroupId)
    if (sourceGroupIndex < 0) return false

    const nextGroup = createWorkspaceWindowGroup({ tabIds: [sourceWindowId], activeWindowId: sourceWindowId })
    workspaceGroups.value = workspaceGroups.value
      .map((group) => {
        if (group.id !== sourceGroupId) return group
        const tabIds = group.tabIds.filter((id) => id !== sourceWindowId)
        const activeWindowId = group.activeWindowId === sourceWindowId ? tabIds[0] || '' : group.activeWindowId
        return {
          ...group,
          tabIds,
          activeWindowId,
        }
      })
      .flatMap((group, idx) => {
        if (idx !== sourceGroupIndex) return [group]
        const kept = group.tabIds.length > 0 ? [group] : []
        return [...kept, nextGroup]
      })

    activeWorkspaceGroupId.value = nextGroup.id
    activeWorkspaceWindowId.value = sourceWindowId
    syncWorkspaceSelectionState()
    return true
  }

  function isWorkspaceGroupSelected(): boolean {
    return Boolean(getWorkspaceGroupById(activeWorkspaceGroupId.value))
  }

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

  watch(
    workspaceGroupPaneRatiosById,
    (value) => {
      setLocalJson(STORAGE_WORKSPACE_GROUP_PANE_RATIOS, value)
    },
    { deep: true },
  )

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
        sidebarWidth.value = Math.min(520, Math.max(280, Math.floor(window.innerWidth * 0.24)))
      }
    }
  }

  function setSidebarOpen(open: boolean, opts?: { preserveWidth?: boolean }) {
    const wasOpen = isSidebarOpen.value
    isSidebarOpen.value = open
    if (!open || opts?.preserveWidth || wasOpen) return
    if (typeof window !== 'undefined' && !hasManuallyResizedLeftSidebar.value) {
      sidebarWidth.value = Math.min(520, Math.max(280, Math.floor(window.innerWidth * 0.24)))
    }
  }

  function setSessionSwitcherOpen(open: boolean) {
    isSessionSwitcherOpen.value = open
  }

  function setWorkspaceDockOpen(open: boolean) {
    if (!open) {
      isWorkspaceDockOpen.value = false
      return
    }
    workspaceDockPlacement.value = 'right'
    isWorkspaceDockOpen.value = false
  }

  function toggleWorkspaceDock(defaultPanel: WorkspaceDockPanel = 'git') {
    workspaceDockPanel.value = defaultPanel
    workspaceDockPlacement.value = 'right'
    isWorkspaceDockOpen.value = false
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
    const selectedGroup =
      getWorkspaceGroupById(activeWorkspaceGroupId.value) ||
      workspaceGroups.value[0] ||
      getWorkspaceGroupById(getWorkspaceWindowGroupId(activeWorkspaceWindowId.value))
    const query = normalizeRouteQueryRecord(opts?.query)
    const matchKeys = normalizeMatchKeys(opts?.matchKeys)
    const effectiveKeys = matchKeys.length > 0 ? matchKeys : defaultMatchKeysForMainTab(tab)
    const scopeWindowIds = selectedGroup ? selectedGroup.tabIds : workspaceWindows.value.map((item) => item.id)

    const existing = findWorkspaceWindowByTabAndQuery(tab, query, {
      keys: effectiveKeys,
      windowIds: scopeWindowIds,
    })
    if (existing) {
      const targetId = existing.id
      clearSuppressedRouteWindowRestore(targetId)
      setWorkspaceWindowMainTab(targetId, tab)
      setWorkspaceWindowRouteQuery(targetId, query)
      if (typeof opts?.title !== 'undefined') {
        setWorkspaceWindowTitle(targetId, opts.title)
      }

      if (selectedGroup) {
        setWorkspaceGroupTabs(selectedGroup.id, selectedGroup.tabIds, { activeWindowId: targetId })
        activeWorkspaceGroupId.value = selectedGroup.id
        activeWorkspaceWindowId.value = targetId
      } else {
        const nextGroup = createWorkspaceWindowGroup({ tabIds: [targetId], activeWindowId: targetId })
        workspaceGroups.value = [...workspaceGroups.value, nextGroup]
        activeWorkspaceGroupId.value = nextGroup.id
        activeWorkspaceWindowId.value = targetId
      }

      syncWorkspaceSelectionState()
      return targetId
    }

    const next = createWorkspaceWindowTab(tab, query, opts?.title)
    clearSuppressedRouteWindowRestore(next.id)
    workspaceWindows.value = [...workspaceWindows.value, next]

    if (selectedGroup) {
      const nextTabIds = normalizeIdList([...selectedGroup.tabIds, next.id])
      setWorkspaceGroupTabs(selectedGroup.id, nextTabIds, { activeWindowId: next.id })
      activeWorkspaceGroupId.value = selectedGroup.id
      activeWorkspaceWindowId.value = next.id
      syncWorkspaceSelectionState()
      return next.id
    }

    const nextGroup = createWorkspaceWindowGroup({ tabIds: [next.id], activeWindowId: next.id })
    workspaceGroups.value = [...workspaceGroups.value, nextGroup]
    activeWorkspaceGroupId.value = nextGroup.id
    activeWorkspaceWindowId.value = next.id
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
      const group = getWorkspaceGroupById(groupId)
      if (group) {
        setWorkspaceGroupTabs(groupId, group.tabIds, { activeWindowId: targetId })
      }
      activeWorkspaceWindowId.value = targetId
    } else {
      const nextGroup = createWorkspaceWindowGroup({ tabIds: [targetId], activeWindowId: targetId })
      workspaceGroups.value = [...workspaceGroups.value, nextGroup]
      activeWorkspaceGroupId.value = nextGroup.id
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

    // Desktop shell routes drive sidebar state only, so route-scoped title updates
    // must target explicit windowId. Keep compact/mobile fallback behavior.
    if (isCompactLayout.value) {
      return getResolvedWorkspaceWindowId()
    }

    return ''
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
    if (!targetId) return

    setWorkspaceWindowRouteQuery(targetId, rawQuery)
  }

  function syncActiveWorkspaceWindowFromRoute(tab: MainTab, rawQuery: unknown) {
    const routeWindowId = readWindowIdFromRouteQuery(rawQuery)

    // Desktop shell routes drive sidebar state only.
    // Keep split-pane window content stable unless explicit window activation happens.
    if (!isCompactLayout.value) {
      if (routeWindowId && workspaceWindows.value.some((item) => item.id === routeWindowId)) {
        clearSuppressedRouteWindowRestore(routeWindowId)
        activateWorkspaceWindow(routeWindowId)
        return
      }

      if (!activeWorkspaceWindow.value) {
        activeMainTabFallback.value = tab
      }
      return
    }

    if (routeWindowId) {
      if (!workspaceWindows.value.some((item) => item.id === routeWindowId)) {
        if (isRouteWindowRestoreSuppressed(routeWindowId)) {
          return
        }
        const seeded: WorkspaceWindowTab = {
          id: routeWindowId,
          mainTab: tab,
          routeQuery: normalizeRouteQueryRecord(rawQuery),
          createdAt: Date.now(),
        }
        workspaceWindows.value = [...workspaceWindows.value, seeded]
      }

      clearSuppressedRouteWindowRestore(routeWindowId)
      activateWorkspaceWindow(routeWindowId)
      setWorkspaceWindowMainTab(routeWindowId, tab)
      setWorkspaceWindowRouteQuery(routeWindowId, rawQuery)
      return
    }

    const prevMainTab = activeMainTab.value
    setActiveMainTab(tab)

    const normalizedQuery = normalizeRouteQueryRecord(rawQuery)
    if (Object.keys(normalizedQuery).length > 0) {
      setActiveWorkspaceWindowRouteQuery(normalizedQuery)
      return
    }

    // Keep per-window route context when URL is clean (no query params).
    // Only clear route query when user explicitly switches to another main tab.
    if (prevMainTab !== tab) {
      setActiveWorkspaceWindowRouteQuery({})
    }
  }

  function closeWorkspaceWindow(windowId: string) {
    const idx = findWorkspaceWindowIndex(windowId)
    if (idx < 0) return
    suppressRouteWindowRestore(windowId)

    if (workspaceWindows.value.length <= 1) {
      workspaceWindows.value = []
      workspaceGroups.value = []
      activeWorkspaceGroupId.value = ''
      activeWorkspaceWindowId.value = ''
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

    for (const item of workspaceWindows.value) {
      if (item.id === target.id) continue
      suppressRouteWindowRestore(item.id)
    }

    workspaceWindows.value = [target]
    workspaceGroups.value = []
    activeWorkspaceGroupId.value = ''
    activeWorkspaceWindowId.value = target.id
    syncWorkspaceSelectionState()
  }

  function closeWorkspaceWindowsToLeft(windowId?: string | null) {
    const targetId = getResolvedWorkspaceWindowId(windowId)
    if (!targetId) return
    const idx = findWorkspaceWindowIndex(targetId)
    if (idx <= 0) return
    for (const item of workspaceWindows.value.slice(0, idx)) {
      suppressRouteWindowRestore(item.id)
    }
    workspaceWindows.value = workspaceWindows.value.slice(idx)
    activeWorkspaceWindowId.value = targetId
    syncWorkspaceSelectionState()
  }

  function closeWorkspaceWindowsToRight(windowId?: string | null) {
    const targetId = getResolvedWorkspaceWindowId(windowId)
    if (!targetId) return
    const idx = findWorkspaceWindowIndex(targetId)
    if (idx < 0 || idx >= workspaceWindows.value.length - 1) return
    for (const item of workspaceWindows.value.slice(idx + 1)) {
      suppressRouteWindowRestore(item.id)
    }
    workspaceWindows.value = workspaceWindows.value.slice(0, idx + 1)
    activeWorkspaceWindowId.value = targetId
    syncWorkspaceSelectionState()
  }

  function closeAllWorkspaceWindows(_tab: MainTab = defaultMainTab) {
    for (const item of workspaceWindows.value) {
      suppressRouteWindowRestore(item.id)
    }
    workspaceWindows.value = []
    workspaceGroups.value = []
    activeWorkspaceGroupId.value = ''
    activeWorkspaceWindowId.value = ''
    syncWorkspaceSelectionState()
  }

  function splitWorkspaceWindowToRight(windowId: string): boolean {
    const previousGroupCount = workspaceGroups.value.length

    const sourceId = String(windowId || '').trim()
    if (!sourceId) return false
    const source = getWorkspaceWindowById(sourceId)
    if (!source) return false

    const duplicatedId = openWorkspaceWindow(source.mainTab, {
      activate: false,
      query: source.routeQuery,
      title: source.title,
      matchKeys: defaultMatchKeysForMainTab(source.mainTab),
    })

    const sourceGroupId = getWorkspaceWindowGroupId(sourceId)
    const sourceGroupIndex = workspaceGroups.value.findIndex((group) => group.id === sourceGroupId)
    const nextGroup = createWorkspaceWindowGroup({ tabIds: [duplicatedId], activeWindowId: duplicatedId })

    if (sourceGroupIndex >= 0) {
      workspaceGroups.value = [
        ...workspaceGroups.value.slice(0, sourceGroupIndex + 1),
        nextGroup,
        ...workspaceGroups.value.slice(sourceGroupIndex + 1),
      ]
    } else {
      workspaceGroups.value = [...workspaceGroups.value, nextGroup]
    }
    rebalanceWorkspacePaneRatiosOnGroupGrowth(previousGroupCount)

    activeWorkspaceGroupId.value = nextGroup.id
    activeWorkspaceWindowId.value = duplicatedId
    syncWorkspaceSelectionState()
    return true
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
    const id = String(windowId || '').trim()
    if (!id) return
    void selectWorkspaceWindow(id)
  }

  function addWorkspaceSplitWindow(windowId: string | null | undefined) {
    const id = String(windowId || '').trim()
    if (!id) return
    void selectWorkspaceWindow(id)
  }

  function insertWorkspaceWindowIntoGroupSplit(
    groupId: string,
    windowId: string | null | undefined,
    atIndex: number,
  ): boolean {
    const targetGroupId = String(groupId || '').trim()
    const targetWindowId = String(windowId || '').trim()
    if (!targetGroupId || !targetWindowId) return false

    const targetGroup = getWorkspaceGroupById(targetGroupId)
    if (!targetGroup) return false

    const sourceGroupId = getWorkspaceWindowGroupId(targetWindowId)
    const sourceWindow = getWorkspaceWindowById(targetWindowId)
    if (!sourceWindow) return false

    const sourceGroupIndexBefore = sourceGroupId
      ? workspaceGroups.value.findIndex((item) => item.id === sourceGroupId)
      : -1
    let hasRemovedSourceGroup = false

    if (sourceGroupId) {
      const sourceGroup = getWorkspaceGroupById(sourceGroupId)
      if (!sourceGroup) return false

      if (sourceGroup.tabIds.length > 1) {
        setWorkspaceGroupTabs(
          sourceGroup.id,
          sourceGroup.tabIds.filter((id) => id !== targetWindowId),
        )
      } else {
        workspaceGroups.value = workspaceGroups.value.filter((item) => item.id !== sourceGroup.id)
        hasRemovedSourceGroup = true
      }
    }

    const nextGroup = createWorkspaceWindowGroup({ tabIds: [targetWindowId], activeWindowId: targetWindowId })
    const targetIndex = workspaceGroups.value.findIndex((item) => item.id === targetGroup.id)
    if (targetIndex < 0) return false

    let desiredIndex = Number.isFinite(atIndex) ? Math.floor(atIndex) : targetIndex + 1
    if (hasRemovedSourceGroup && sourceGroupIndexBefore >= 0 && sourceGroupIndexBefore < desiredIndex) {
      desiredIndex -= 1
    }
    const boundedIndex = Math.max(0, Math.min(workspaceGroups.value.length, desiredIndex))
    workspaceGroups.value = [
      ...workspaceGroups.value.slice(0, boundedIndex),
      nextGroup,
      ...workspaceGroups.value.slice(boundedIndex),
    ]
    rebalanceWorkspacePaneRatiosEvenly()

    activeWorkspaceGroupId.value = nextGroup.id
    activeWorkspaceWindowId.value = targetWindowId
    syncWorkspaceSelectionState()
    return true
  }

  function removeWorkspaceSplitWindow(windowId: string | null | undefined) {
    const id = String(windowId || '').trim()
    if (!id) return
    closeWorkspaceWindow(id)
  }

  function clearWorkspaceSplitWindow() {
    clearWorkspaceSplitWindows()
  }

  function clearWorkspaceSplitWindows() {
    if (workspaceGroups.value.length <= 1) return
    const selectedId = String(activeWorkspaceGroupId.value || '').trim()
    workspaceGroups.value = workspaceGroups.value.filter((group) => group.id === selectedId)
    syncWorkspaceSelectionState()
  }

  function toggleWorkspaceSplitWindow(windowId: string | null | undefined) {
    const id = String(windowId || '').trim()
    if (!id) {
      clearWorkspaceSplitWindows()
      return
    }
    const activeId = String(activeWorkspaceWindowId.value || '').trim()
    if (activeId && activeId === id && workspaceGroups.value.length > 1) {
      removeWorkspaceSplitWindow(id)
    } else {
      addWorkspaceSplitWindow(id)
    }
  }

  function isWorkspaceWindowInSplit(windowId?: string | null): boolean {
    const id = String(windowId || '').trim()
    if (!id) return false
    if (workspaceGroups.value.length <= 1) return false
    const selectedGroup = getWorkspaceGroupById(activeWorkspaceGroupId.value)
    if (!selectedGroup) return false
    return selectedGroup.activeWindowId === id || selectedGroup.tabIds.includes(id)
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
    isWorkspaceDockOpen.value = false
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
    activeMainTabFallback.value = tab

    const targetId = getResolvedWorkspaceWindowId()
    if (!targetId) return

    const idx = findWorkspaceWindowIndex(targetId)
    if (idx < 0) return

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
    globalSelectionByWindow,
    activeGlobalSelection,
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
    setSidebarOpen,
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
    setGlobalSelection,
    clearGlobalSelection,
    getGlobalSelection,
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
    moveWorkspaceGroupToIndex,
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
    insertWorkspaceWindowIntoGroupSplit,
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

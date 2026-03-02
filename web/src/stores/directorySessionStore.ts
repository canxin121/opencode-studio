import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { i18n } from '@/i18n'

import * as chatApi from '@/stores/chat/api'
import { apiJson } from '@/lib/api'
import { normalizeDirectories } from '@/features/sessions/model/projects'
import type { DirectoryEntry } from '@/features/sessions/model/types'
import { normalizeDirForCompare } from '@/features/sessions/model/labels'
import type { SseEvent } from '@/lib/sse'
import { defaultChatSidebarUiPrefs, patchChatSidebarUiPrefs, type ChatSidebarUiPrefs } from '@/data/chatSidebarUiPrefs'

import { normalizeRuntime, runtimeIsActive, type SessionRuntimeState } from './directorySessionRuntime'
import type { JsonObject as UnknownRecord, JsonValue } from '@/types/json'

type ChatSidebarStateWire = {
  preferences?: JsonValue
  seq?: number
  directoriesPage?: JsonValue
  sessionPagesByDirectoryId?: JsonValue
  runtimeBySessionId?: JsonValue
  recentPage?: JsonValue
  runningPage?: JsonValue
  focus?: JsonValue
  view?: JsonValue
}

const SIDEBAR_STATE_ENDPOINT = '/api/chat-sidebar/state'
const UI_PREFS_REMOTE_SAVE_DEBOUNCE_MS = 300

type SidebarSessionSummary = UnknownRecord & {
  id: string
}

type SidebarSessionRow = {
  id: string
  session: SidebarSessionSummary | null
  directory: DirectoryEntry | null
  renderKey: string
  depth: number
  parentId: string | null
  rootId: string
  isParent: boolean
  isExpanded: boolean
}

type DirectorySidebarView = {
  sessionCount: number
  rootPage: number
  rootPageCount: number
  hasActiveOrBlocked: boolean
  pinnedRows: SidebarSessionRow[]
  recentRows: SidebarSessionRow[]
  recentParentById: Record<string, string | null>
  recentRootIds: string[]
}

type SidebarFooterView = {
  total: number
  page: number
  pageCount: number
  rows: SidebarSessionRow[]
}

type SidebarFocusedSession = {
  sessionId: string
  directoryId: string
  directoryPath: string
}

type SidebarStateQuery = {
  limitPerDirectory?: number
  directoriesPage?: number
  directoryQuery?: string
  focusSessionId?: string
  pinnedPage?: number
  recentPage?: number
  runningPage?: number
}

type PersistedSidebarStateQuery = Omit<SidebarStateQuery, 'focusSessionId'>

type RevalidateRuntimeOpts = {
  silent?: boolean
}

type NormalizedSidebarView = {
  directorySidebarById: Record<string, DirectorySidebarView>
  pinnedFooterView: SidebarFooterView
  recentFooterView: SidebarFooterView
  runningFooterView: SidebarFooterView
}

function asRecord(value: JsonValue): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value
}

function hasOwn(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
}

function toSessionSummarySnapshot(value: JsonValue): SidebarSessionSummary | null {
  const record = asRecord(value)
  const id = typeof record?.id === 'string' ? record.id.trim() : ''
  if (!record || !id) return null
  return { ...record, id }
}

function toDirectoryEntry(value: JsonValue | null | undefined): DirectoryEntry | null {
  const record = asRecord((value as JsonValue) || undefined)
  if (!record) return null
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const path = typeof record.path === 'string' ? record.path.trim() : ''
  if (!id || !path) return null
  const label = typeof record.label === 'string' && record.label.trim() ? record.label.trim() : undefined
  return { id, path, ...(label ? { label } : {}) }
}

function readEventType(evt: SseEvent): string {
  return typeof evt.type === 'string' ? evt.type.trim() : ''
}

function normalizeUiPrefs(input: Partial<ChatSidebarUiPrefs> | null | undefined): ChatSidebarUiPrefs {
  return patchChatSidebarUiPrefs(defaultChatSidebarUiPrefs(), (input || {}) as Partial<ChatSidebarUiPrefs>)
}

function sameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false
  }
  return true
}

function samePageMap(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false
    if (left[key] !== right[key]) return false
  }
  return true
}

function uiPrefsBodyEquals(left: ChatSidebarUiPrefs, right: ChatSidebarUiPrefs): boolean {
  return (
    sameStringArray(left.collapsedDirectoryIds, right.collapsedDirectoryIds) &&
    sameStringArray(left.expandedParentSessionIds, right.expandedParentSessionIds) &&
    sameStringArray(left.pinnedSessionIds, right.pinnedSessionIds) &&
    left.directoriesPage === right.directoriesPage &&
    samePageMap(left.sessionRootPageByDirectoryId, right.sessionRootPageByDirectoryId) &&
    left.pinnedSessionsOpen === right.pinnedSessionsOpen &&
    left.pinnedSessionsPage === right.pinnedSessionsPage &&
    left.recentSessionsOpen === right.recentSessionsOpen &&
    left.recentSessionsPage === right.recentSessionsPage &&
    left.runningSessionsOpen === right.runningSessionsOpen &&
    left.runningSessionsPage === right.runningSessionsPage
  )
}

function normalizePath(path: string): string {
  return normalizeDirForCompare(path)
}

function directoryEntryByPath(path: string, directoriesById: Record<string, DirectoryEntry>): DirectoryEntry | null {
  const normalized = normalizePath(path)
  if (!normalized) return null
  for (const entry of Object.values(directoriesById)) {
    const id = String(entry?.id || '').trim()
    if (!id) continue
    if (normalizePath(String(entry?.path || '')) === normalized) {
      return entry
    }
  }
  return null
}

function normalizeSidebarSessionRow(raw: JsonValue): SidebarSessionRow | null {
  const record = asRecord(raw)
  if (!record) return null

  const id = typeof record.id === 'string' ? record.id.trim() : ''
  if (!id) return null

  const session = toSessionSummarySnapshot(record.session as JsonValue)
  const wireDirectory = toDirectoryEntry(record.directory as JsonValue)
  const directory = wireDirectory || null

  const depthRaw = Number(record.depth)
  const depth = Number.isFinite(depthRaw) ? Math.max(0, Math.floor(depthRaw)) : 0
  const renderKey = typeof record.renderKey === 'string' && record.renderKey.trim() ? record.renderKey.trim() : id
  const parentId = typeof record.parentId === 'string' && record.parentId.trim() ? record.parentId.trim() : null
  const rootId = typeof record.rootId === 'string' && record.rootId.trim() ? record.rootId.trim() : id

  return {
    id,
    session,
    directory,
    renderKey,
    depth,
    parentId,
    rootId,
    isParent: record.isParent === true,
    isExpanded: record.isExpanded === true,
  }
}

function normalizeSidebarFooterView(raw: JsonValue | null | undefined): SidebarFooterView {
  const record = asRecord((raw as JsonValue) || undefined)
  const rowsRaw = Array.isArray(record?.rows) ? record.rows : []
  const rows: SidebarSessionRow[] = []
  for (const item of rowsRaw) {
    const row = normalizeSidebarSessionRow(item)
    if (row) rows.push(row)
  }

  const totalRaw = Number(record?.total)
  const pageRaw = Number(record?.page)
  const pageCountRaw = Number(record?.pageCount)
  const total = Number.isFinite(totalRaw) ? Math.max(0, Math.floor(totalRaw)) : rows.length
  const pageCount = Number.isFinite(pageCountRaw) ? Math.max(1, Math.floor(pageCountRaw)) : 1
  const page = Number.isFinite(pageRaw) ? Math.max(0, Math.min(pageCount - 1, Math.floor(pageRaw))) : 0

  return {
    total,
    page,
    pageCount,
    rows,
  }
}

function normalizeDirectorySidebarSection(raw: JsonValue, directoryId: string): DirectorySidebarView | null {
  const section = asRecord(raw)
  if (!section) return null

  const did = String(directoryId || '').trim()
  if (!did) return null

  const pinnedRowsRaw = Array.isArray(section.pinnedRows) ? section.pinnedRows : []
  const recentRowsRaw = Array.isArray(section.recentRows) ? section.recentRows : []

  const pinnedRows: SidebarSessionRow[] = []
  for (const item of pinnedRowsRaw) {
    const row = normalizeSidebarSessionRow(item)
    if (row) pinnedRows.push(row)
  }

  const recentRows: SidebarSessionRow[] = []
  for (const item of recentRowsRaw) {
    const row = normalizeSidebarSessionRow(item)
    if (row) recentRows.push(row)
  }

  const sessionCountRaw = Number(section.sessionCount)
  const rootPageRaw = Number(section.rootPage)
  const rootPageCountRaw = Number(section.rootPageCount)

  const sessionCount = Number.isFinite(sessionCountRaw) ? Math.max(0, Math.floor(sessionCountRaw)) : recentRows.length
  const rootPageCount = Number.isFinite(rootPageCountRaw) ? Math.max(1, Math.floor(rootPageCountRaw)) : 1
  const rootPage = Number.isFinite(rootPageRaw) ? Math.max(0, Math.min(rootPageCount - 1, Math.floor(rootPageRaw))) : 0

  const recentParentByIdRaw = asRecord(section.recentParentById as JsonValue) || {}
  const recentParentById: Record<string, string | null> = {}
  for (const [sessionIdRaw, parentRaw] of Object.entries(recentParentByIdRaw)) {
    const sessionId = String(sessionIdRaw || '').trim()
    if (!sessionId) continue
    if (typeof parentRaw === 'string' && parentRaw.trim()) {
      recentParentById[sessionId] = parentRaw.trim()
      continue
    }
    recentParentById[sessionId] = null
  }

  const recentRootIds = Array.isArray(section.recentRootIds)
    ? section.recentRootIds.map((value) => String(value || '').trim()).filter(Boolean)
    : []

  return {
    sessionCount,
    rootPage,
    rootPageCount,
    hasActiveOrBlocked: section.hasActiveOrBlocked === true,
    pinnedRows,
    recentRows,
    recentParentById,
    recentRootIds,
  }
}

function normalizeSidebarView(raw: JsonValue | null | undefined): NormalizedSidebarView {
  const view = asRecord((raw as JsonValue) || undefined)
  const directoryRowsByIdRaw = asRecord(view?.directoryRowsById as JsonValue) || {}

  const nextDirectorySidebarById: Record<string, DirectorySidebarView> = {}
  for (const [directoryIdRaw, sectionRaw] of Object.entries(directoryRowsByIdRaw)) {
    const directoryId = String(directoryIdRaw || '').trim()
    if (!directoryId) continue
    const section = normalizeDirectorySidebarSection(sectionRaw, directoryId)
    if (!section) continue
    nextDirectorySidebarById[directoryId] = section
  }

  return {
    directorySidebarById: nextDirectorySidebarById,
    pinnedFooterView: normalizeSidebarFooterView(view?.pinnedFooter as JsonValue),
    recentFooterView: normalizeSidebarFooterView(view?.recentFooter as JsonValue),
    runningFooterView: normalizeSidebarFooterView(view?.runningFooter as JsonValue),
  }
}

function applyPersistentStateQueryOverrides(
  base: PersistedSidebarStateQuery,
  opts: SidebarStateQuery | undefined,
): PersistedSidebarStateQuery {
  if (!opts) return base
  const next = { ...base }

  if (hasOwn(opts, 'limitPerDirectory')) {
    const value = Number(opts.limitPerDirectory)
    if (Number.isFinite(value) && value > 0) {
      next.limitPerDirectory = Math.max(1, Math.floor(value))
    } else {
      delete next.limitPerDirectory
    }
  }

  if (hasOwn(opts, 'directoriesPage')) {
    const value = Number(opts.directoriesPage)
    if (Number.isFinite(value)) {
      next.directoriesPage = Math.max(0, Math.floor(value))
    } else {
      delete next.directoriesPage
    }
  }

  if (hasOwn(opts, 'directoryQuery')) {
    const query = typeof opts.directoryQuery === 'string' ? opts.directoryQuery.trim() : ''
    if (query) {
      next.directoryQuery = query
    } else {
      delete next.directoryQuery
    }
  }

  if (hasOwn(opts, 'pinnedPage')) {
    const value = Number(opts.pinnedPage)
    if (Number.isFinite(value)) {
      next.pinnedPage = Math.max(0, Math.floor(value))
    } else {
      delete next.pinnedPage
    }
  }

  if (hasOwn(opts, 'recentPage')) {
    const value = Number(opts.recentPage)
    if (Number.isFinite(value)) {
      next.recentPage = Math.max(0, Math.floor(value))
    } else {
      delete next.recentPage
    }
  }

  if (hasOwn(opts, 'runningPage')) {
    const value = Number(opts.runningPage)
    if (Number.isFinite(value)) {
      next.runningPage = Math.max(0, Math.floor(value))
    } else {
      delete next.runningPage
    }
  }

  return next
}

function buildSidebarStateUrl(persistedQuery: PersistedSidebarStateQuery, focusSessionId?: string): string {
  const params = new URLSearchParams()

  if (typeof persistedQuery.limitPerDirectory === 'number') {
    params.set('directorySessionsPageSize', String(Math.max(1, Math.floor(persistedQuery.limitPerDirectory))))
  }
  if (typeof persistedQuery.directoriesPage === 'number') {
    params.set('directoriesPage', String(Math.max(0, Math.floor(persistedQuery.directoriesPage))))
  }
  if (typeof persistedQuery.directoryQuery === 'string' && persistedQuery.directoryQuery.trim()) {
    params.set('directoryQuery', persistedQuery.directoryQuery.trim())
  }
  if (typeof persistedQuery.pinnedPage === 'number') {
    params.set('pinnedPage', String(Math.max(0, Math.floor(persistedQuery.pinnedPage))))
  }
  if (typeof persistedQuery.recentPage === 'number') {
    params.set('recentPage', String(Math.max(0, Math.floor(persistedQuery.recentPage))))
  }
  if (typeof persistedQuery.runningPage === 'number') {
    params.set('runningPage', String(Math.max(0, Math.floor(persistedQuery.runningPage))))
  }
  if (typeof focusSessionId === 'string' && focusSessionId.trim()) {
    params.set('focusSessionId', focusSessionId.trim())
  }

  return params.size > 0 ? `${SIDEBAR_STATE_ENDPOINT}?${params.toString()}` : SIDEBAR_STATE_ENDPOINT
}

export const useDirectorySessionStore = defineStore('directorySession', () => {
  const directoriesById = ref<Record<string, DirectoryEntry>>({})
  const directoryOrder = ref<string[]>([])
  const runtimeBySessionId = ref<Record<string, SessionRuntimeState>>({})

  const directorySidebarById = ref<Record<string, DirectorySidebarView>>({})
  const pinnedFooterView = ref<SidebarFooterView>({ total: 0, page: 0, pageCount: 1, rows: [] })
  const recentFooterView = ref<SidebarFooterView>({ total: 0, page: 0, pageCount: 1, rows: [] })
  const runningFooterView = ref<SidebarFooterView>({ total: 0, page: 0, pageCount: 1, rows: [] })
  const sidebarStateFocus = ref<SidebarFocusedSession | null>(null)
  const directoriesPageIndex = ref(0)
  const directoryPageRows = ref<DirectoryEntry[]>([])
  const directoryPageTotal = ref(0)
  const uiPrefs = ref<ChatSidebarUiPrefs>(defaultChatSidebarUiPrefs())

  const loading = ref(false)
  const error = ref<string | null>(null)

  let persistedStateQuery: PersistedSidebarStateQuery = {}

  let uiPrefsRemotePersistTimer: number | null = null
  let uiPrefsRemotePersistInFlight = false
  let uiPrefsRemotePersistQueued = false
  let sidebarStateSyncTimer: number | null = null
  let sidebarStateSyncInFlight = false
  let sidebarStateSyncQueued = false

  const visibleDirectories = computed<DirectoryEntry[]>(() => {
    return directoryOrder.value
      .map((id) => directoriesById.value[id])
      .filter((entry): entry is DirectoryEntry => Boolean(entry))
  })

  function setDirectoryEntries(entries: DirectoryEntry[]) {
    const nextById: Record<string, DirectoryEntry> = {}
    const order: string[] = []

    for (const entry of entries) {
      const id = String(entry?.id || '').trim()
      const path = String(entry?.path || '').trim()
      if (!id || !path) continue

      const label = typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : undefined
      nextById[id] = { id, path, ...(label ? { label } : {}) }
      order.push(id)
    }

    directoriesById.value = nextById
    directoryOrder.value = order
  }

  function applyAuthoritativeUiPrefs(incomingRaw: Partial<ChatSidebarUiPrefs> | null | undefined) {
    uiPrefs.value = normalizeUiPrefs(incomingRaw)
  }

  function scheduleUiPrefsRemotePersist() {
    if (uiPrefsRemotePersistTimer !== null) return
    uiPrefsRemotePersistTimer = window.setTimeout(() => {
      uiPrefsRemotePersistTimer = null
      void persistUiPrefsToApi()
    }, UI_PREFS_REMOTE_SAVE_DEBOUNCE_MS)
  }

  async function persistUiPrefsToApi() {
    if (uiPrefsRemotePersistInFlight) {
      uiPrefsRemotePersistQueued = true
      return
    }

    uiPrefsRemotePersistInFlight = true
    const payload = normalizeUiPrefs(uiPrefs.value)
    const stateUrl = buildSidebarStateUrl(persistedStateQuery)
    try {
      const state = await apiJson<ChatSidebarStateWire>(stateUrl, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'if-match': String(Math.max(0, Math.floor(payload.version || 0))),
        },
        body: JSON.stringify(payload),
      })
      applySidebarStatePayload(state as JsonValue)
    } catch {
      // Backend remains the single source of truth.
      // Next successful state sync will reconcile local UI state.
    } finally {
      uiPrefsRemotePersistInFlight = false
      if (uiPrefsRemotePersistQueued) {
        uiPrefsRemotePersistQueued = false
        scheduleUiPrefsRemotePersist()
      }
    }
  }

  function patchUiPrefs(patch: Partial<ChatSidebarUiPrefs>) {
    const nextBody = normalizeUiPrefs(patchChatSidebarUiPrefs(uiPrefs.value, patch))
    if (uiPrefsBodyEquals(nextBody, uiPrefs.value)) return

    uiPrefs.value = normalizeUiPrefs({
      ...nextBody,
      updatedAt: Date.now(),
    })
    scheduleUiPrefsRemotePersist()
  }

  function parseRuntimeMap(raw: JsonValue): Record<string, SessionRuntimeState> {
    const runtimePayload = asRecord(raw) || {}
    const next: Record<string, SessionRuntimeState> = {}
    for (const [sessionIdRaw, runtimeRaw] of Object.entries(runtimePayload)) {
      const sessionId = String(sessionIdRaw || '').trim()
      if (!sessionId) continue
      next[sessionId] = normalizeRuntime((asRecord(runtimeRaw) as Partial<SessionRuntimeState>) || undefined)
    }
    return next
  }

  function applySidebarStatePayload(stateRaw: JsonValue) {
    const stateRecord = asRecord(stateRaw) || {}
    if (!hasOwn(stateRecord, 'preferences')) {
      throw new Error('chat sidebar state payload is missing preferences')
    }
    applyAuthoritativeUiPrefs((stateRecord.preferences as Partial<ChatSidebarUiPrefs>) || undefined)

    const directoriesPage = asRecord(stateRecord.directoriesPage as JsonValue)
    const entries = normalizeDirectories((directoriesPage?.items as JsonValue) || [])
    setDirectoryEntries(entries)

    directoryPageRows.value = entries
    directoryPageTotal.value =
      typeof directoriesPage?.total === 'number' && Number.isFinite(directoriesPage.total)
        ? Math.max(0, Math.floor(directoriesPage.total))
        : entries.length

    const offsetRaw = Number(directoriesPage?.offset)
    const limitRaw = Number(directoriesPage?.limit)
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.max(1, Math.floor(limitRaw)) : 1
    directoriesPageIndex.value = Math.max(0, Math.floor(offset / limit))

    const normalizedView = normalizeSidebarView(stateRecord.view as JsonValue)

    runtimeBySessionId.value = parseRuntimeMap(stateRecord.runtimeBySessionId as JsonValue)
    directorySidebarById.value = normalizedView.directorySidebarById
    pinnedFooterView.value = normalizedView.pinnedFooterView
    recentFooterView.value = normalizedView.recentFooterView
    runningFooterView.value = normalizedView.runningFooterView

    const focusRecord = asRecord(stateRecord.focus as JsonValue)
    const focusSid = typeof focusRecord?.sessionId === 'string' ? focusRecord.sessionId.trim() : ''
    const focusDid = typeof focusRecord?.directoryId === 'string' ? focusRecord.directoryId.trim() : ''
    const focusPath = typeof focusRecord?.directoryPath === 'string' ? focusRecord.directoryPath.trim() : ''
    sidebarStateFocus.value =
      focusSid && focusDid && focusPath
        ? {
            sessionId: focusSid,
            directoryId: focusDid,
            directoryPath: focusPath,
          }
        : null
  }

  async function revalidateFromStateApi(opts?: SidebarStateQuery): Promise<void> {
    persistedStateQuery = applyPersistentStateQueryOverrides(persistedStateQuery, opts)
    const focusSessionId = typeof opts?.focusSessionId === 'string' ? opts.focusSessionId.trim() : ''
    const stateUrl = buildSidebarStateUrl(persistedStateQuery, focusSessionId)
    const state = await apiJson<ChatSidebarStateWire>(stateUrl)
    applySidebarStatePayload(state as JsonValue)
  }

  function scheduleSidebarStateSync(delayMs = 0) {
    if (sidebarStateSyncTimer !== null) {
      window.clearTimeout(sidebarStateSyncTimer)
      sidebarStateSyncTimer = null
    }

    sidebarStateSyncTimer = window.setTimeout(
      () => {
        sidebarStateSyncTimer = null
        void syncSidebarStateFromServer()
      },
      Math.max(0, Math.floor(delayMs)),
    )
  }

  async function syncSidebarStateFromServer() {
    if (sidebarStateSyncInFlight) {
      sidebarStateSyncQueued = true
      return
    }

    sidebarStateSyncInFlight = true
    try {
      await revalidateFromStateApi()
    } catch {
      // Keep existing sidebar cache on transient background sync failures.
    } finally {
      sidebarStateSyncInFlight = false
      if (sidebarStateSyncQueued) {
        sidebarStateSyncQueued = false
        scheduleSidebarStateSync(120)
      }
    }
  }

  async function revalidateFromApi(opts?: SidebarStateQuery, runtimeOpts?: RevalidateRuntimeOpts): Promise<boolean> {
    if (!runtimeOpts?.silent) {
      loading.value = true
    }
    error.value = null
    try {
      await revalidateFromStateApi(opts)
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      if (!runtimeOpts?.silent) {
        loading.value = false
      }
    }
  }

  function applyChatSidebarStateEvent(evt: SseEvent) {
    const type = readEventType(evt)
    if (type !== 'chat-sidebar.state') return

    // Backend owns sidebar derivation. Treat SSE as an invalidation signal and
    // re-fetch authoritative state from /api/chat-sidebar/state.
    scheduleSidebarStateSync(120)
  }

  function applyGlobalEvent(evt: SseEvent) {
    const type = readEventType(evt)
    if (!type) return
    if (type === 'chat-sidebar.state') {
      applyChatSidebarStateEvent(evt)
    }
  }

  function setSessionRootPage(directoryId: string, page: number, _pageSize: number): number {
    void _pageSize
    const did = String(directoryId || '').trim()
    if (!did) return 0

    const section = directorySidebarById.value[did]
    const maxPage = Math.max(0, Math.floor(Number(section?.rootPageCount || 1)) - 1)
    const next = Math.max(0, Math.min(maxPage, Math.floor(Number(page || 0))))
    patchUiPrefs({
      sessionRootPageByDirectoryId: {
        ...uiPrefs.value.sessionRootPageByDirectoryId,
        [did]: next,
      },
    })
    return next
  }

  async function resolveDirectoryForSession(
    sessionId: string,
    hint?: { directoryId?: string; directoryPath?: string; locateResult?: JsonValue; skipRemote?: boolean },
  ): Promise<{ directoryId: string; directoryPath: string; locatedDir: string } | null> {
    const sid = String(sessionId || '').trim()
    if (!sid) return null

    const hintId = String(hint?.directoryId || '').trim()
    const hintPath = String(hint?.directoryPath || '').trim()
    if (hintId && hintPath) {
      return { directoryId: hintId, directoryPath: hintPath, locatedDir: hintPath }
    }

    const focus = sidebarStateFocus.value
    if (focus && focus.sessionId === sid) {
      return {
        directoryId: focus.directoryId,
        directoryPath: focus.directoryPath,
        locatedDir: focus.directoryPath,
      }
    }

    if (hint?.skipRemote) return null

    const locateResult = hint?.locateResult ?? (await chatApi.locateSession(sid).catch(() => null))
    const loc = asRecord(locateResult)
    const rawPid = loc?.projectId ?? loc?.project_id
    const rawPath = loc?.projectPath ?? loc?.project_path

    const pid = typeof rawPid === 'string' ? rawPid.trim() : ''
    const ppath = typeof rawPath === 'string' ? rawPath.trim() : ''
    const locatedDir = typeof loc?.directory === 'string' ? loc.directory.trim() : ''

    const locatePath = locatedDir || ppath
    const matchedByPath = locatePath ? directoryEntryByPath(locatePath, directoriesById.value) : null
    if (matchedByPath?.id && matchedByPath.path) {
      return {
        directoryId: matchedByPath.id,
        directoryPath: matchedByPath.path,
        locatedDir: locatePath || matchedByPath.path,
      }
    }

    if (pid) {
      const matchedById = directoriesById.value[pid]
      if (matchedById?.path) {
        return {
          directoryId: matchedById.id,
          directoryPath: matchedById.path,
          locatedDir: locatePath || matchedById.path,
        }
      }
      if (ppath) {
        return {
          directoryId: pid,
          directoryPath: ppath,
          locatedDir: locatePath || ppath,
        }
      }
    }

    if (hintId) {
      const hintedById = directoriesById.value[hintId]
      if (hintedById?.path) {
        return {
          directoryId: hintedById.id,
          directoryPath: hintedById.path,
          locatedDir: locatePath || hintedById.path,
        }
      }
    }

    if (hintPath) {
      const hintedByPath = directoryEntryByPath(hintPath, directoriesById.value)
      if (hintedByPath?.id && hintedByPath.path) {
        return {
          directoryId: hintedByPath.id,
          directoryPath: hintedByPath.path,
          locatedDir: locatePath || hintedByPath.path,
        }
      }
    }

    return null
  }

  function statusLabelForSessionId(sessionId: string): { label: string; dotClass: string } {
    const sid = String(sessionId || '').trim()
    const runtime = runtimeBySessionId.value[sid]
    if (!runtime) return { label: String(i18n.global.t('chat.sidebar.sessionRow.status.idle')), dotClass: '' }

    if (runtime.displayState === 'needsPermission') {
      return {
        label: String(i18n.global.t('chat.sidebar.sessionRow.status.needsPermission')),
        dotClass: 'bg-amber-500',
      }
    }
    if (runtime.displayState === 'needsReply') {
      return {
        label: String(i18n.global.t('chat.sidebar.sessionRow.status.needsReply')),
        dotClass: 'bg-sky-500',
      }
    }
    if (runtime.displayState === 'retrying') {
      return {
        label: String(i18n.global.t('chat.sidebar.sessionRow.status.retrying')),
        dotClass: 'bg-primary animate-pulse',
      }
    }
    if (runtime.displayState === 'running') {
      return {
        label: String(i18n.global.t('chat.sidebar.sessionRow.status.running')),
        dotClass: 'bg-primary animate-pulse',
      }
    }
    if (runtime.displayState === 'coolingDown') {
      return {
        label: String(i18n.global.t('chat.sidebar.sessionRow.status.coolingDown')),
        dotClass: 'bg-primary/70',
      }
    }

    return { label: String(i18n.global.t('chat.sidebar.sessionRow.status.idle')), dotClass: '' }
  }

  function isSessionRuntimeActive(sessionId: string, opts?: { includeCooldown?: boolean }): boolean {
    const sid = String(sessionId || '').trim()
    if (!sid) return false
    return runtimeIsActive(runtimeBySessionId.value[sid], opts)
  }

  async function bootstrapWithStaleWhileRevalidate() {
    await revalidateFromApi()
  }

  async function resetAllPersistedState() {
    if (sidebarStateSyncTimer !== null) {
      window.clearTimeout(sidebarStateSyncTimer)
      sidebarStateSyncTimer = null
    }
    sidebarStateSyncInFlight = false
    sidebarStateSyncQueued = false

    if (uiPrefsRemotePersistTimer !== null) {
      window.clearTimeout(uiPrefsRemotePersistTimer)
      uiPrefsRemotePersistTimer = null
    }
    uiPrefsRemotePersistInFlight = false
    uiPrefsRemotePersistQueued = false

    persistedStateQuery = {}

    directoriesById.value = {}
    directoryOrder.value = []
    runtimeBySessionId.value = {}

    directorySidebarById.value = {}
    pinnedFooterView.value = { total: 0, page: 0, pageCount: 1, rows: [] }
    recentFooterView.value = { total: 0, page: 0, pageCount: 1, rows: [] }
    runningFooterView.value = { total: 0, page: 0, pageCount: 1, rows: [] }
    sidebarStateFocus.value = null
    directoriesPageIndex.value = 0
    directoryPageRows.value = []
    directoryPageTotal.value = 0
    uiPrefs.value = defaultChatSidebarUiPrefs()
    loading.value = false
    error.value = null
  }

  return {
    directoriesById,
    runtimeBySessionId,
    directorySidebarById,
    pinnedFooterView,
    recentFooterView,
    runningFooterView,
    sidebarStateFocus,
    directoriesPageIndex,
    directoryPageRows,
    directoryPageTotal,
    uiPrefs,
    loading,
    error,
    visibleDirectories,
    setSessionRootPage,
    patchUiPrefs,
    resolveDirectoryForSession,
    statusLabelForSessionId,
    isSessionRuntimeActive,
    applyGlobalEvent,
    revalidateFromApi,
    bootstrapWithStaleWhileRevalidate,
    resetAllPersistedState,
  }
})

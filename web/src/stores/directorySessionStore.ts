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
  patchSeq?: JsonValue
  directoriesPage?: JsonValue
  sessionPagesByDirectoryId?: JsonValue
  runtimeBySessionId?: JsonValue
  recentPage?: JsonValue
  runningPage?: JsonValue
  focus?: JsonValue
  view?: JsonValue
}

type ChatSidebarPreferencesWire = {
  preferences?: JsonValue
  seq?: number
  patchSeq?: JsonValue
}

type DirectorySessionsByIdWire = {
  sidebarView?: JsonValue
}

type ChatSidebarFooterWire = {
  kind?: JsonValue
  seq?: JsonValue
  patchSeq?: JsonValue
  view?: JsonValue
}

type ChatSidebarDirectoriesPageWire = {
  preferences?: JsonValue
  seq?: JsonValue
  patchSeq?: JsonValue
  directoriesPage?: JsonValue
  view?: JsonValue
}

type ChatSidebarPatchesWire = {
  since?: JsonValue
  oldestSeq?: JsonValue
  latestSeq?: JsonValue
  needResync?: JsonValue
  patches?: JsonValue
}

type SidebarFooterKind = 'pinned' | 'recent' | 'running'

const SIDEBAR_STATE_ENDPOINT = '/api/chat-sidebar/snapshot'
const SIDEBAR_DIRECTORIES_PAGE_ENDPOINT = '/api/chat-sidebar/directories/page'
const SIDEBAR_PATCHES_ENDPOINT = '/api/chat-sidebar/patch-log'
const SIDEBAR_PREFERENCES_ENDPOINT = '/api/chat-sidebar/preferences'
const SIDEBAR_COMMAND_ENDPOINT = '/api/chat-sidebar/commands'
const SIDEBAR_DIRECTORIES_PAGE_SIZE_DEFAULT = 15
const SIDEBAR_DIRECTORY_SESSIONS_PAGE_SIZE_DEFAULT = 10
const SIDEBAR_FOOTER_PAGE_SIZE_DEFAULT = 10
const SIDEBAR_PATCH_PULL_LIMIT_DEFAULT = 80

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

type SidebarCommandRuntimeOpts = {
  silent?: boolean
  syncPatch?: boolean
}

type SidebarInFlightRequest = {
  key: string
  promise: Promise<boolean>
  controller: AbortController | null
}

type SidebarInFlightVoidRequest = {
  key: string
  promise: Promise<void>
  controller: AbortController | null
}

type SidebarCommandRequest =
  | { type: 'setDirectoriesPage'; page: number }
  | { type: 'setDirectoryCollapsed'; directoryId: string; collapsed: boolean }
  | { type: 'setDirectoryRootPage'; directoryId: string; page: number }
  | { type: 'setSessionPinned'; sessionId: string; pinned: boolean }
  | { type: 'setSessionExpanded'; sessionId: string; expanded: boolean }
  | { type: 'setFooterOpen'; kind: SidebarFooterKind; open: boolean }
  | { type: 'setFooterPage'; kind: SidebarFooterKind; page: number }

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

function parseNonNegativeInt(raw: JsonValue, fallback = 0): number {
  const num = Number(raw)
  if (!Number.isFinite(num)) return Math.max(0, Math.floor(fallback))
  return Math.max(0, Math.floor(num))
}

function readPatchSeq(record: UnknownRecord | null | undefined): JsonValue {
  if (!record) return undefined
  return (record.patchSeq ?? record.patch_seq) as JsonValue
}

function createAbortController(): AbortController | null {
  if (typeof AbortController === 'undefined') return null
  return new AbortController()
}

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException) return err.name === 'AbortError'
  if (!err || typeof err !== 'object') return false
  return (err as { name?: unknown }).name === 'AbortError'
}

function normalizeFooterKind(raw: JsonValue): SidebarFooterKind | null {
  const kind = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (kind === 'pinned' || kind === 'recent' || kind === 'running') return kind
  return null
}

function normalizeUiPrefs(input: Partial<ChatSidebarUiPrefs> | null | undefined): ChatSidebarUiPrefs {
  return patchChatSidebarUiPrefs(defaultChatSidebarUiPrefs(), (input || {}) as Partial<ChatSidebarUiPrefs>)
}

function isStaleAuthoritativePrefs(
  incomingRaw: Partial<ChatSidebarUiPrefs> | null | undefined,
  localRaw: Partial<ChatSidebarUiPrefs> | null | undefined,
): boolean {
  const incoming = normalizeUiPrefs(incomingRaw)
  const local = normalizeUiPrefs(localRaw)
  if (incoming.version !== local.version) return false
  return incoming.updatedAt < local.updatedAt
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
  const pageCountRaw = Number(record?.pageCount ?? record?.page_count)
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

  const sessionCountRaw = Number(section.sessionCount ?? section.session_count)
  const rootPageRaw = Number(section.rootPage ?? section.root_page)
  const rootPageCountRaw = Number(section.rootPageCount ?? section.root_page_count)

  const sessionCount = Number.isFinite(sessionCountRaw) ? Math.max(0, Math.floor(sessionCountRaw)) : recentRows.length
  const rootPageCount = Number.isFinite(rootPageCountRaw) ? Math.max(1, Math.floor(rootPageCountRaw)) : 1
  const rootPage = Number.isFinite(rootPageRaw) ? Math.max(0, Math.min(rootPageCount - 1, Math.floor(rootPageRaw))) : 0

  const recentParentByIdRaw = asRecord((section.recentParentById ?? section.recent_parent_by_id) as JsonValue) || {}
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

  const recentRootIdsRaw = Array.isArray(section.recentRootIds)
    ? section.recentRootIds
    : Array.isArray(section.recent_root_ids)
      ? section.recent_root_ids
      : []
  const recentRootIds = recentRootIdsRaw.map((value) => String(value || '').trim()).filter(Boolean)

  const hasActiveOrBlocked = section.hasActiveOrBlocked === true || section.has_active_or_blocked === true

  return {
    sessionCount,
    rootPage,
    rootPageCount,
    hasActiveOrBlocked,
    pinnedRows,
    recentRows,
    recentParentById,
    recentRootIds,
  }
}

function normalizeDirectoryRowsById(raw: JsonValue | null | undefined): Record<string, DirectorySidebarView> {
  const directoryRowsByIdRaw = asRecord((raw as JsonValue) || undefined) || {}

  const nextDirectorySidebarById: Record<string, DirectorySidebarView> = {}
  for (const [directoryIdRaw, sectionRaw] of Object.entries(directoryRowsByIdRaw)) {
    const directoryId = String(directoryIdRaw || '').trim()
    if (!directoryId) continue
    const section = normalizeDirectorySidebarSection(sectionRaw, directoryId)
    if (!section) continue
    nextDirectorySidebarById[directoryId] = section
  }
  return nextDirectorySidebarById
}

function normalizeSidebarView(raw: JsonValue | null | undefined): NormalizedSidebarView {
  const view = asRecord((raw as JsonValue) || undefined)
  const directoryRowsById = (view?.directoryRowsById ?? view?.directory_rows_by_id) as JsonValue
  const pinnedFooter = (view?.pinnedFooter ?? view?.pinned_footer) as JsonValue
  const recentFooter = (view?.recentFooter ?? view?.recent_footer) as JsonValue
  const runningFooter = (view?.runningFooter ?? view?.running_footer) as JsonValue

  return {
    directorySidebarById: normalizeDirectoryRowsById(directoryRowsById),
    pinnedFooterView: normalizeSidebarFooterView(pinnedFooter),
    recentFooterView: normalizeSidebarFooterView(recentFooter),
    runningFooterView: normalizeSidebarFooterView(runningFooter),
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

function buildSidebarDirectoriesPageUrl(page: number, pageSize: number, query?: string): string {
  const params = new URLSearchParams()
  params.set('page', String(Math.max(0, Math.floor(Number(page || 0) || 0))))
  params.set('pageSize', String(Math.max(1, Math.floor(Number(pageSize || 0) || 1))))
  const queryNorm = typeof query === 'string' ? query.trim() : ''
  if (queryNorm) {
    params.set('query', queryNorm)
  }
  return `${SIDEBAR_DIRECTORIES_PAGE_ENDPOINT}?${params.toString()}`
}

function buildSidebarPatchesUrl(since: number, limit: number): string {
  const params = new URLSearchParams()
  params.set('since', String(Math.max(0, Math.floor(Number(since || 0) || 0))))
  params.set('limit', String(Math.max(1, Math.floor(Number(limit || 0) || 1))))
  return `${SIDEBAR_PATCHES_ENDPOINT}?${params.toString()}`
}

function buildDirectorySessionsUrl(directoryId: string, page: number, pageSize: number): string {
  const did = String(directoryId || '').trim()
  if (!did) return ''

  const resolvedPageSize = Math.max(1, Math.floor(Number(pageSize || 0) || 1))
  const resolvedPage = Math.max(0, Math.floor(Number(page || 0) || 0))
  const offset = resolvedPage * resolvedPageSize

  const params = new URLSearchParams()
  params.set('scope', 'directory')
  params.set('roots', 'true')
  params.set('includeChildren', 'true')
  params.set('includeTotal', 'true')
  params.set('offset', String(offset))
  params.set('limit', String(resolvedPageSize))

  return `/api/directories/${encodeURIComponent(did)}/sessions?${params.toString()}`
}

function buildSidebarFooterUrl(kind: SidebarFooterKind, page: number, pageSize: number): string {
  const params = new URLSearchParams()
  params.set('page', String(Math.max(0, Math.floor(Number(page || 0) || 0))))
  params.set('pageSize', String(Math.max(1, Math.floor(Number(pageSize || 0) || 1))))
  return `/api/chat-sidebar/sections/${kind}/page?${params.toString()}`
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
  const appliedPatchSeq = ref(0)
  const directoriesPageIndex = ref(0)
  const directoryPageRows = ref<DirectoryEntry[]>([])
  const directoryPageTotal = ref(0)
  const uiPrefs = ref<ChatSidebarUiPrefs>(defaultChatSidebarUiPrefs())

  const loading = ref(false)
  const error = ref<string | null>(null)

  let persistedStateQuery: PersistedSidebarStateQuery = {}

  let sidebarStateSyncTimer: number | null = null
  let sidebarStateSyncInFlight = false
  let sidebarStateSyncQueued = false
  let sidebarPatchSyncTimer: number | null = null
  let sidebarPatchSyncInFlight = false
  let sidebarPatchSyncQueued = false
  let sidebarStateRequestInFlight: SidebarInFlightVoidRequest | null = null
  let directoriesPageInFlight: SidebarInFlightRequest | null = null
  const directorySessionPageInFlightById = new Map<string, SidebarInFlightRequest>()
  const footerPageInFlightByKind = new Map<SidebarFooterKind, SidebarInFlightRequest>()

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

  function applyAuthoritativeUiPrefs(incomingRaw: Partial<ChatSidebarUiPrefs> | null | undefined): boolean {
    if (isStaleAuthoritativePrefs(incomingRaw, uiPrefs.value)) {
      return false
    }
    uiPrefs.value = normalizeUiPrefs(incomingRaw)
    return true
  }

  function advancePatchCursor(raw: JsonValue | undefined) {
    const seq = parseNonNegativeInt(raw as JsonValue, appliedPatchSeq.value)
    if (seq > appliedPatchSeq.value) {
      appliedPatchSeq.value = seq
    }
  }

  async function executeSidebarCommand(
    command: SidebarCommandRequest,
    opts?: SidebarCommandRuntimeOpts,
  ): Promise<boolean> {
    if (!opts?.silent) {
      loading.value = true
      error.value = null
    }

    try {
      const payload = await apiJson<ChatSidebarPreferencesWire>(SIDEBAR_COMMAND_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(command),
      })
      const payloadRecord = asRecord(payload as JsonValue) || {}
      advancePatchCursor(readPatchSeq(payloadRecord))
      if (hasOwn(payloadRecord, 'preferences')) {
        applyAuthoritativeUiPrefs((payloadRecord.preferences as Partial<ChatSidebarUiPrefs>) || undefined)
      }

      if (opts?.syncPatch === false) {
        scheduleSidebarPatchSync(120)
      } else {
        await syncSidebarByPatchLog()
      }

      return true
    } catch (err) {
      if (!opts?.silent) {
        error.value = err instanceof Error ? err.message : String(err)
      }
      return false
    } finally {
      if (!opts?.silent) {
        loading.value = false
      }
    }
  }

  async function commandSetDirectoriesPage(page: number, opts?: { silent?: boolean }): Promise<boolean> {
    const target = Math.max(0, Math.floor(Number(page || 0)))
    const ok = await executeSidebarCommand({ type: 'setDirectoriesPage', page: target }, { ...opts, syncPatch: false })
    if (!ok) return false

    const queryNorm =
      typeof persistedStateQuery.directoryQuery === 'string' ? persistedStateQuery.directoryQuery.trim() : ''
    return revalidateDirectoriesPageFromApi({
      page: target,
      pageSize: SIDEBAR_DIRECTORIES_PAGE_SIZE_DEFAULT,
      query: queryNorm,
      silent: opts?.silent,
    })
  }

  async function commandSetDirectoryCollapsed(
    directoryId: string,
    collapsed: boolean,
    opts?: { silent?: boolean },
  ): Promise<boolean> {
    const did = String(directoryId || '').trim()
    if (!did) return false
    const ok = await executeSidebarCommand(
      { type: 'setDirectoryCollapsed', directoryId: did, collapsed },
      { ...opts, syncPatch: false },
    )
    if (!ok) return false

    if (collapsed) return true
    return revalidateDirectorySessionPageFromApi(did, { silent: opts?.silent })
  }

  async function commandSetDirectoryRootPage(
    directoryId: string,
    page: number,
    opts?: { silent?: boolean },
  ): Promise<boolean> {
    const did = String(directoryId || '').trim()
    if (!did) return false
    const target = Math.max(0, Math.floor(Number(page || 0)))
    const ok = await executeSidebarCommand(
      { type: 'setDirectoryRootPage', directoryId: did, page: target },
      { ...opts, syncPatch: false },
    )
    if (!ok) return false

    return revalidateDirectorySessionPageFromApi(did, {
      page: target,
      pageSize: SIDEBAR_DIRECTORY_SESSIONS_PAGE_SIZE_DEFAULT,
      silent: opts?.silent,
    })
  }

  async function commandSetSessionPinned(
    sessionId: string,
    pinned: boolean,
    opts?: { silent?: boolean },
  ): Promise<boolean> {
    const sid = String(sessionId || '').trim()
    if (!sid) return false
    return executeSidebarCommand({ type: 'setSessionPinned', sessionId: sid, pinned }, opts)
  }

  async function commandSetSessionExpanded(
    sessionId: string,
    expanded: boolean,
    opts?: { silent?: boolean },
  ): Promise<boolean> {
    const sid = String(sessionId || '').trim()
    if (!sid) return false
    return executeSidebarCommand({ type: 'setSessionExpanded', sessionId: sid, expanded }, opts)
  }

  async function commandSetFooterOpen(
    kind: SidebarFooterKind,
    open: boolean,
    opts?: { silent?: boolean },
  ): Promise<boolean> {
    return executeSidebarCommand({ type: 'setFooterOpen', kind, open }, opts)
  }

  async function commandSetFooterPage(
    kind: SidebarFooterKind,
    page: number,
    opts?: { silent?: boolean },
  ): Promise<boolean> {
    const target = Math.max(0, Math.floor(Number(page || 0)))
    return executeSidebarCommand({ type: 'setFooterPage', kind, page: target }, opts)
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

  function applyDirectoriesPagePayload(directoriesPageRaw: JsonValue): DirectoryEntry[] {
    const directoriesPage = asRecord(directoriesPageRaw)
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

    return entries
  }

  function applySidebarStatePayload(stateRaw: JsonValue) {
    const stateRecord = asRecord(stateRaw) || {}
    if (!hasOwn(stateRecord, 'preferences')) {
      throw new Error('chat sidebar state payload is missing preferences')
    }
    advancePatchCursor(readPatchSeq(stateRecord))
    applyAuthoritativeUiPrefs((stateRecord.preferences as Partial<ChatSidebarUiPrefs>) || undefined)

    applyDirectoriesPagePayload((stateRecord.directoriesPage ?? stateRecord.directories_page) as JsonValue)

    const normalizedView = normalizeSidebarView(stateRecord.view as JsonValue)

    runtimeBySessionId.value = parseRuntimeMap(
      (stateRecord.runtimeBySessionId ?? stateRecord.runtime_by_session_id) as JsonValue,
    )
    directorySidebarById.value = normalizedView.directorySidebarById
    pinnedFooterView.value = normalizedView.pinnedFooterView
    recentFooterView.value = normalizedView.recentFooterView
    runningFooterView.value = normalizedView.runningFooterView

    const focusRecord = asRecord(stateRecord.focus as JsonValue)
    const focusSid =
      typeof focusRecord?.sessionId === 'string'
        ? focusRecord.sessionId.trim()
        : typeof focusRecord?.session_id === 'string'
          ? focusRecord.session_id.trim()
          : ''
    const focusDid =
      typeof focusRecord?.directoryId === 'string'
        ? focusRecord.directoryId.trim()
        : typeof focusRecord?.directory_id === 'string'
          ? focusRecord.directory_id.trim()
          : ''
    const focusPath =
      typeof focusRecord?.directoryPath === 'string'
        ? focusRecord.directoryPath.trim()
        : typeof focusRecord?.directory_path === 'string'
          ? focusRecord.directory_path.trim()
          : ''
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

    const existingRequest = sidebarStateRequestInFlight
    if (existingRequest?.key === stateUrl) {
      return existingRequest.promise
    }
    if (existingRequest?.controller) {
      existingRequest.controller.abort()
    }
    const controller = createAbortController()

    let requestPromise!: Promise<void>
    requestPromise = (async () => {
      try {
        const state = await apiJson<ChatSidebarStateWire>(
          stateUrl,
          controller ? { signal: controller.signal } : undefined,
        )
        applySidebarStatePayload(state as JsonValue)
      } catch (err) {
        if (isAbortError(err)) return
        throw err
      } finally {
        if (sidebarStateRequestInFlight?.promise === requestPromise) {
          sidebarStateRequestInFlight = null
        }
      }
    })()

    sidebarStateRequestInFlight = {
      key: stateUrl,
      promise: requestPromise,
      controller,
    }
    return requestPromise
  }

  async function revalidatePreferencesFromApi(opts?: { silent?: boolean }): Promise<boolean> {
    if (!opts?.silent) {
      loading.value = true
      error.value = null
    }

    try {
      const payload = await apiJson<ChatSidebarPreferencesWire>(SIDEBAR_PREFERENCES_ENDPOINT)
      const payloadRecord = asRecord(payload as JsonValue) || {}
      advancePatchCursor(readPatchSeq(payloadRecord))
      if (hasOwn(payloadRecord, 'preferences')) {
        applyAuthoritativeUiPrefs(payloadRecord.preferences as Partial<ChatSidebarUiPrefs>)
      }
      return true
    } catch (err) {
      if (!opts?.silent) {
        error.value = err instanceof Error ? err.message : String(err)
      }
      return false
    } finally {
      if (!opts?.silent) {
        loading.value = false
      }
    }
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

  function scheduleSidebarPatchSync(delayMs = 0) {
    if (sidebarPatchSyncTimer !== null) {
      window.clearTimeout(sidebarPatchSyncTimer)
      sidebarPatchSyncTimer = null
    }

    sidebarPatchSyncTimer = window.setTimeout(
      () => {
        sidebarPatchSyncTimer = null
        void syncSidebarByPatchLog()
      },
      Math.max(0, Math.floor(delayMs)),
    )
  }

  async function applySidebarPatchOps(opsRaw: JsonValue): Promise<boolean> {
    const opsList = Array.isArray(opsRaw) ? opsRaw : []
    if (opsList.length === 0) return true

    let invalidateState = false
    let invalidateDirectoriesPage = false
    let invalidatePreferences = false
    const directoryIds = new Set<string>()
    const footerKinds = new Set<SidebarFooterKind>()
    const appliedDirectoryViews = new Map<string, DirectorySidebarView>()
    const directoryIdsWithInlineView = new Set<string>()

    for (const opRaw of opsList) {
      const op = asRecord(opRaw)
      if (!op) continue
      const type = typeof op?.type === 'string' ? op.type.trim() : ''
      if (!type) continue

      if (type === 'invalidateState') {
        invalidateState = true
        continue
      }
      if (type === 'invalidateDirectoriesPage') {
        invalidateDirectoriesPage = true
        continue
      }
      if (type === 'invalidatePreferences') {
        invalidatePreferences = true
        continue
      }
      if (type === 'invalidateDirectory') {
        const didRaw =
          typeof op.directoryId === 'string'
            ? op.directoryId
            : typeof op.directory_id === 'string'
              ? op.directory_id
              : ''
        const did = didRaw.trim()
        if (did) directoryIds.add(did)
        continue
      }
      if (type === 'invalidateFooter') {
        const kind = normalizeFooterKind(op.kind as JsonValue)
        if (kind) footerKinds.add(kind)
        continue
      }
      if (type === 'applyDirectoryView') {
        const didRaw =
          typeof op.directoryId === 'string'
            ? op.directoryId
            : typeof op.directory_id === 'string'
              ? op.directory_id
              : ''
        const did = didRaw.trim()
        if (!did) continue
        const viewRaw = (op.view ?? op.sidebarView ?? op.sidebar_view) as JsonValue
        const section = normalizeDirectorySidebarSection(viewRaw, did)
        if (!section) continue
        appliedDirectoryViews.set(did, section)
        directoryIdsWithInlineView.add(did)
        continue
      }

      // Unknown op -> safest fallback.
      invalidateState = true
    }

    if (invalidateState) {
      await revalidateFromStateApi()
      return true
    }

    for (const directoryId of directoryIdsWithInlineView) {
      directoryIds.delete(directoryId)
    }

    if (appliedDirectoryViews.size > 0) {
      const nextDirectoryRowsById = { ...directorySidebarById.value }
      const nextSessionRootPageByDirectoryId = { ...uiPrefs.value.sessionRootPageByDirectoryId }
      let hasPrefsChange = false

      for (const [directoryId, section] of appliedDirectoryViews.entries()) {
        nextDirectoryRowsById[directoryId] = section
        const previousRootPage = Math.max(
          0,
          Math.floor(Number(uiPrefs.value.sessionRootPageByDirectoryId[directoryId] || 0)),
        )
        if (previousRootPage !== section.rootPage) {
          nextSessionRootPageByDirectoryId[directoryId] = section.rootPage
          hasPrefsChange = true
        }
      }

      directorySidebarById.value = nextDirectoryRowsById
      if (hasPrefsChange) {
        uiPrefs.value = normalizeUiPrefs({
          ...uiPrefs.value,
          sessionRootPageByDirectoryId: nextSessionRootPageByDirectoryId,
        })
      }
    }

    let preferencesOk = true
    if (invalidatePreferences) {
      preferencesOk = await revalidatePreferencesFromApi({ silent: true })
    }

    let directoriesPageOk = true
    if (invalidateDirectoriesPage) {
      const queryNorm =
        typeof persistedStateQuery.directoryQuery === 'string' ? persistedStateQuery.directoryQuery.trim() : ''
      directoriesPageOk = await revalidateDirectoriesPageFromApi({
        page: directoriesPageIndex.value,
        pageSize: SIDEBAR_DIRECTORIES_PAGE_SIZE_DEFAULT,
        query: queryNorm,
        silent: true,
      })
    }

    if (invalidateDirectoriesPage) {
      for (const entry of directoryPageRows.value) {
        const did = String(entry?.id || '').trim()
        if (!did) continue
        directoryIds.delete(did)
      }
    }

    const tasks: Array<Promise<boolean>> = []
    for (const directoryId of directoryIds) {
      tasks.push(revalidateDirectorySessionPageFromApi(directoryId, { silent: true }))
    }
    for (const kind of footerKinds) {
      tasks.push(revalidateFooterFromApi(kind, { pageSize: SIDEBAR_FOOTER_PAGE_SIZE_DEFAULT, silent: true }))
    }

    if (tasks.length === 0) return preferencesOk && directoriesPageOk
    const results = await Promise.all(tasks)
    return preferencesOk && directoriesPageOk && results.every((ok) => ok)
  }

  async function pullAndApplySidebarPatches(
    limit = SIDEBAR_PATCH_PULL_LIMIT_DEFAULT,
  ): Promise<{ ok: boolean; latestSeq: number }> {
    const response = await apiJson<ChatSidebarPatchesWire>(
      buildSidebarPatchesUrl(appliedPatchSeq.value, Math.max(1, Math.floor(limit))),
    )
    const payload = asRecord(response as JsonValue) || {}

    const needResync = Boolean(payload.needResync ?? payload.need_resync)
    const latestSeq = parseNonNegativeInt((payload.latestSeq ?? payload.latest_seq) as JsonValue, appliedPatchSeq.value)
    if (needResync) {
      await revalidateFromStateApi()
      return { ok: true, latestSeq }
    }

    const patches = Array.isArray(payload.patches) ? payload.patches : []
    const mergedOps: JsonValue[] = []
    let highestPatchSeq = appliedPatchSeq.value

    for (const patchRaw of patches) {
      const patch = asRecord(patchRaw)
      const patchSeq = parseNonNegativeInt(patch?.seq as JsonValue, appliedPatchSeq.value)
      if (patchSeq > highestPatchSeq) highestPatchSeq = patchSeq
      const ops = Array.isArray(patch?.ops) ? patch?.ops : []
      if (ops.length > 0) mergedOps.push(...ops)
    }

    if (mergedOps.length > 0) {
      const ok = await applySidebarPatchOps(mergedOps)
      if (!ok) return { ok: false, latestSeq }
    }

    if (highestPatchSeq > appliedPatchSeq.value) {
      appliedPatchSeq.value = highestPatchSeq
    }

    if (latestSeq > appliedPatchSeq.value && patches.length === 0) {
      appliedPatchSeq.value = latestSeq
    }

    return { ok: true, latestSeq }
  }

  async function syncSidebarByPatchLog() {
    if (sidebarPatchSyncInFlight) {
      sidebarPatchSyncQueued = true
      return
    }

    sidebarPatchSyncInFlight = true
    try {
      let guard = 0
      while (guard < 4) {
        guard += 1
        const result = await pullAndApplySidebarPatches()
        if (!result.ok) {
          await revalidateFromStateApi()
          break
        }
        if (result.latestSeq <= appliedPatchSeq.value) {
          break
        }
      }
    } catch {
      // Fallback to authoritative full state if patch sync fails.
      try {
        await revalidateFromStateApi()
      } catch {
        // ignore
      }
    } finally {
      sidebarPatchSyncInFlight = false
      if (sidebarPatchSyncQueued) {
        sidebarPatchSyncQueued = false
        scheduleSidebarPatchSync(80)
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

  async function revalidateDirectoriesPageFromApi(opts?: {
    page?: number
    pageSize?: number
    query?: string
    silent?: boolean
  }): Promise<boolean> {
    const pageSize = Math.max(1, Math.floor(Number(opts?.pageSize || 0) || 15))
    const fallbackPage =
      Number.isFinite(Number(directoriesPageIndex.value)) && Number(directoriesPageIndex.value) >= 0
        ? Math.max(0, Math.floor(Number(directoriesPageIndex.value)))
        : Math.max(0, Math.floor(Number(uiPrefs.value.directoriesPage || 0)))
    const page =
      typeof opts?.page === 'number' && Number.isFinite(opts.page) ? Math.max(0, Math.floor(opts.page)) : fallbackPage
    const queryNorm = typeof opts?.query === 'string' ? opts.query.trim() : ''

    persistedStateQuery = applyPersistentStateQueryOverrides(persistedStateQuery, {
      directoriesPage: page,
      directoryQuery: queryNorm,
    })

    const requestKey = `${page}|${pageSize}|${queryNorm}`
    const existingRequest = directoriesPageInFlight
    if (existingRequest?.key === requestKey) {
      return existingRequest.promise
    }
    if (existingRequest?.controller) {
      existingRequest.controller.abort()
    }
    const controller = createAbortController()

    if (!opts?.silent) {
      loading.value = true
      error.value = null
    }

    let requestPromise!: Promise<boolean>
    requestPromise = (async () => {
      try {
        const payload = await apiJson<ChatSidebarDirectoriesPageWire>(
          buildSidebarDirectoriesPageUrl(page, pageSize, queryNorm),
          controller ? { signal: controller.signal } : undefined,
        )
        const payloadRecord = asRecord(payload as JsonValue) || {}
        if (!hasOwn(payloadRecord, 'directoriesPage') && !hasOwn(payloadRecord, 'directories_page')) {
          throw new Error('chat sidebar directories page payload is missing directoriesPage')
        }

        advancePatchCursor(readPatchSeq(payloadRecord))
        applyAuthoritativeUiPrefs((payloadRecord.preferences as Partial<ChatSidebarUiPrefs>) || undefined)
        const entries = applyDirectoriesPagePayload(
          (payloadRecord.directoriesPage ?? payloadRecord.directories_page) as JsonValue,
        )

        const viewRecord = asRecord(payloadRecord.view as JsonValue)
        const nextVisibleDirectoryRowsById = normalizeDirectoryRowsById(
          (viewRecord?.directoryRowsById ?? viewRecord?.directory_rows_by_id) as JsonValue,
        )
        const nextDirectoryRowsById = { ...directorySidebarById.value }
        for (const entry of entries) {
          const did = String(entry?.id || '').trim()
          if (!did) continue
          const section = nextVisibleDirectoryRowsById[did]
          if (section) {
            nextDirectoryRowsById[did] = section
          } else {
            delete nextDirectoryRowsById[did]
          }
        }
        directorySidebarById.value = nextDirectoryRowsById

        const resolvedPage = Math.max(0, Math.floor(Number(directoriesPageIndex.value || 0)))
        if (uiPrefs.value.directoriesPage !== resolvedPage) {
          uiPrefs.value = normalizeUiPrefs({
            ...uiPrefs.value,
            directoriesPage: resolvedPage,
          })
        }
        persistedStateQuery = applyPersistentStateQueryOverrides(persistedStateQuery, {
          directoriesPage: resolvedPage,
          directoryQuery: queryNorm,
        })

        return true
      } catch (err) {
        if (isAbortError(err)) return true
        if (!opts?.silent) {
          error.value = err instanceof Error ? err.message : String(err)
        }
        return false
      } finally {
        if (directoriesPageInFlight?.promise === requestPromise) {
          directoriesPageInFlight = null
        }
        if (!opts?.silent) {
          loading.value = false
        }
      }
    })()

    directoriesPageInFlight = {
      key: requestKey,
      promise: requestPromise,
      controller,
    }
    return requestPromise
  }

  function applyChatSidebarStateEvent(evt: SseEvent) {
    const type = readEventType(evt)
    if (type !== 'chat-sidebar.state') return

    // Legacy invalidation event; prefer incremental patch pull first.
    scheduleSidebarPatchSync(80)
  }

  function applyChatSidebarPatchEvent(evt: SseEvent) {
    const type = readEventType(evt)
    if (type !== 'chat-sidebar.patch') return
    scheduleSidebarPatchSync(30)
  }

  function applyGlobalEvent(evt: SseEvent) {
    const type = readEventType(evt)
    if (!type) return
    if (type === 'chat-sidebar.patch') {
      applyChatSidebarPatchEvent(evt)
      return
    }
    if (type === 'chat-sidebar.state') {
      applyChatSidebarStateEvent(evt)
    }
  }

  function setSessionRootPage(directoryId: string, page: number, pageSizeRaw: number): number {
    const pageSize = Math.max(1, Math.floor(Number(pageSizeRaw || 0) || 1))
    const did = String(directoryId || '').trim()
    if (!did) return 0

    const section = directorySidebarById.value[did]
    const fallbackMaxPage = Math.max(0, Math.ceil(Math.max(0, Number(section?.sessionCount || 0)) / pageSize) - 1)
    const maxPage = Math.max(0, Math.floor(Number(section?.rootPageCount || fallbackMaxPage + 1)) - 1)
    return Math.max(0, Math.min(maxPage, Math.floor(Number(page || 0))))
  }

  async function revalidateDirectorySessionPageFromApi(
    directoryId: string,
    opts?: { page?: number; pageSize?: number; silent?: boolean },
  ): Promise<boolean> {
    const did = String(directoryId || '').trim()
    if (!did) return false

    const pageSize = Math.max(1, Math.floor(Number(opts?.pageSize || 0) || 10))
    const section = directorySidebarById.value[did]
    const maxPage = Math.max(0, Math.floor(Number(section?.rootPageCount || 1)) - 1)
    const fallbackPage =
      section && Number.isFinite(Number(section.rootPage))
        ? Math.max(0, Math.floor(Number(section.rootPage)))
        : Math.max(0, Math.floor(Number(uiPrefs.value.sessionRootPageByDirectoryId[did] || 0)))
    const requestedPage =
      typeof opts?.page === 'number' && Number.isFinite(opts.page) ? Math.max(0, Math.floor(opts.page)) : fallbackPage
    const page = Math.max(0, Math.min(maxPage, requestedPage))

    const url = buildDirectorySessionsUrl(did, page, pageSize)
    if (!url) return false

    const requestKey = `${did}|${page}|${pageSize}`
    const existingRequest = directorySessionPageInFlightById.get(did)
    if (existingRequest?.key === requestKey) {
      return existingRequest.promise
    }
    if (existingRequest?.controller) {
      existingRequest.controller.abort()
    }
    const controller = createAbortController()

    if (!opts?.silent) {
      loading.value = true
      error.value = null
    }

    let requestPromise!: Promise<boolean>
    requestPromise = (async () => {
      try {
        const payload = await apiJson<DirectorySessionsByIdWire>(
          url,
          controller ? { signal: controller.signal } : undefined,
        )
        const payloadRecord = asRecord(payload as JsonValue)
        const sectionRaw = payloadRecord?.sidebarView as JsonValue
        const normalizedSection = normalizeDirectorySidebarSection(sectionRaw, did)
        if (!normalizedSection) {
          throw new Error(`directory sidebar section payload is missing sidebarView for ${did}`)
        }

        directorySidebarById.value = {
          ...directorySidebarById.value,
          [did]: normalizedSection,
        }

        const currentPage = Math.max(0, Math.floor(Number(uiPrefs.value.sessionRootPageByDirectoryId[did] || 0)))
        if (currentPage !== normalizedSection.rootPage) {
          uiPrefs.value = normalizeUiPrefs({
            ...uiPrefs.value,
            sessionRootPageByDirectoryId: {
              ...uiPrefs.value.sessionRootPageByDirectoryId,
              [did]: normalizedSection.rootPage,
            },
          })
        }

        return true
      } catch (err) {
        if (isAbortError(err)) return true
        if (!opts?.silent) {
          error.value = err instanceof Error ? err.message : String(err)
        }
        return false
      } finally {
        const current = directorySessionPageInFlightById.get(did)
        if (current?.promise === requestPromise) {
          directorySessionPageInFlightById.delete(did)
        }
        if (!opts?.silent) {
          loading.value = false
        }
      }
    })()

    directorySessionPageInFlightById.set(did, {
      key: requestKey,
      promise: requestPromise,
      controller,
    })

    return requestPromise
  }

  async function revalidateFooterFromApi(
    kind: SidebarFooterKind,
    opts?: { page?: number; pageSize?: number; silent?: boolean },
  ): Promise<boolean> {
    const pageSize = Math.max(1, Math.floor(Number(opts?.pageSize || 0) || 10))
    const currentView =
      kind === 'pinned' ? pinnedFooterView.value : kind === 'recent' ? recentFooterView.value : runningFooterView.value
    const maxPage = Math.max(0, Math.floor(Number(currentView?.pageCount || 1)) - 1)
    const fallbackPage =
      currentView && Number.isFinite(Number(currentView.page))
        ? Math.max(0, Math.floor(Number(currentView.page)))
        : Math.max(
            0,
            Math.floor(
              Number(
                kind === 'pinned'
                  ? uiPrefs.value.pinnedSessionsPage
                  : kind === 'recent'
                    ? uiPrefs.value.recentSessionsPage
                    : uiPrefs.value.runningSessionsPage,
              ) || 0,
            ),
          )
    const requestedPage =
      typeof opts?.page === 'number' && Number.isFinite(opts.page) ? Math.max(0, Math.floor(opts.page)) : fallbackPage
    const page = Math.max(0, Math.min(maxPage, requestedPage))

    const requestKey = `${kind}|${page}|${pageSize}`
    const existingRequest = footerPageInFlightByKind.get(kind)
    if (existingRequest?.key === requestKey) {
      return existingRequest.promise
    }
    if (existingRequest?.controller) {
      existingRequest.controller.abort()
    }
    const controller = createAbortController()

    if (!opts?.silent) {
      loading.value = true
      error.value = null
    }

    let requestPromise!: Promise<boolean>
    requestPromise = (async () => {
      try {
        const payload = await apiJson<ChatSidebarFooterWire>(
          buildSidebarFooterUrl(kind, page, pageSize),
          controller ? { signal: controller.signal } : undefined,
        )
        const payloadRecord = asRecord(payload as JsonValue) || {}
        advancePatchCursor(readPatchSeq(payloadRecord))
        const responseKind = typeof payloadRecord.kind === 'string' ? payloadRecord.kind.trim().toLowerCase() : ''
        if (responseKind && responseKind !== kind) {
          throw new Error(`chat sidebar footer kind mismatch: expected ${kind}, got ${responseKind}`)
        }

        const view = normalizeSidebarFooterView((payloadRecord.view ?? payloadRecord.footer_view) as JsonValue)
        if (kind === 'pinned') {
          pinnedFooterView.value = view
        } else if (kind === 'recent') {
          recentFooterView.value = view
        } else {
          runningFooterView.value = view
        }

        const nextPrefs =
          kind === 'pinned'
            ? normalizeUiPrefs({
                ...uiPrefs.value,
                pinnedSessionsPage: view.page,
              })
            : kind === 'recent'
              ? normalizeUiPrefs({
                  ...uiPrefs.value,
                  recentSessionsPage: view.page,
                })
              : normalizeUiPrefs({
                  ...uiPrefs.value,
                  runningSessionsPage: view.page,
                })
        uiPrefs.value = nextPrefs

        return true
      } catch (err) {
        if (isAbortError(err)) return true
        if (!opts?.silent) {
          error.value = err instanceof Error ? err.message : String(err)
        }
        return false
      } finally {
        const current = footerPageInFlightByKind.get(kind)
        if (current?.promise === requestPromise) {
          footerPageInFlightByKind.delete(kind)
        }
        if (!opts?.silent) {
          loading.value = false
        }
      }
    })()

    footerPageInFlightByKind.set(kind, {
      key: requestKey,
      promise: requestPromise,
      controller,
    })

    return requestPromise
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

    if (sidebarPatchSyncTimer !== null) {
      window.clearTimeout(sidebarPatchSyncTimer)
      sidebarPatchSyncTimer = null
    }
    sidebarPatchSyncInFlight = false
    sidebarPatchSyncQueued = false

    if (sidebarStateRequestInFlight?.controller) {
      sidebarStateRequestInFlight.controller.abort()
    }
    sidebarStateRequestInFlight = null

    if (directoriesPageInFlight?.controller) {
      directoriesPageInFlight.controller.abort()
    }
    directoriesPageInFlight = null

    for (const inFlight of directorySessionPageInFlightById.values()) {
      if (inFlight.controller) inFlight.controller.abort()
    }
    directorySessionPageInFlightById.clear()

    for (const inFlight of footerPageInFlightByKind.values()) {
      if (inFlight.controller) inFlight.controller.abort()
    }
    footerPageInFlightByKind.clear()

    persistedStateQuery = {}

    directoriesById.value = {}
    directoryOrder.value = []
    runtimeBySessionId.value = {}

    directorySidebarById.value = {}
    pinnedFooterView.value = { total: 0, page: 0, pageCount: 1, rows: [] }
    recentFooterView.value = { total: 0, page: 0, pageCount: 1, rows: [] }
    runningFooterView.value = { total: 0, page: 0, pageCount: 1, rows: [] }
    sidebarStateFocus.value = null
    appliedPatchSeq.value = 0
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
    revalidateDirectoriesPageFromApi,
    revalidateDirectorySessionPageFromApi,
    revalidateFooterFromApi,
    commandSetDirectoriesPage,
    commandSetDirectoryCollapsed,
    commandSetDirectoryRootPage,
    commandSetSessionPinned,
    commandSetSessionExpanded,
    commandSetFooterOpen,
    commandSetFooterPage,
    resolveDirectoryForSession,
    statusLabelForSessionId,
    isSessionRuntimeActive,
    applyGlobalEvent,
    revalidateFromApi,
    bootstrapWithStaleWhileRevalidate,
    resetAllPersistedState,
  }
})

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { i18n } from '@/i18n'

import * as chatApi from '@/stores/chat/api'
import { apiJson } from '@/lib/api'
import { normalizeDirectories } from '@/features/sessions/model/projects'
import type { DirectoryEntry } from '@/features/sessions/model/types'
import { normalizeDirForCompare } from '@/features/sessions/model/labels'
import type { Session } from '@/types/chat'
import type { SseEvent } from '@/lib/sse'
import { defaultChatSidebarUiPrefs, patchChatSidebarUiPrefs, type ChatSidebarUiPrefs } from '@/data/chatSidebarUiPrefs'
import { useChatStore } from './chat'

import {
  normalizeRuntime,
  runtimeIsActive,
  runtimeStateEquivalent,
  type SessionRuntimeState,
} from './directorySessionRuntime'
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

type ChatSidebarCommandsResponseWire = {
  preferences?: JsonValue
  seq?: JsonValue
  delta?: JsonValue
}

type SidebarFooterKind = 'pinned' | 'recent' | 'running'

const SIDEBAR_STATE_ENDPOINT = '/api/chat-sidebar/state'
const SIDEBAR_COMMAND_ENDPOINT = '/api/chat-sidebar/commands'
const SIDEBAR_FOOTER_ENDPOINT = '/api/chat-sidebar/footer'
const SIDEBAR_DIRECTORIES_ENDPOINT = '/api/directories'
const SIDEBAR_DIRECTORIES_PAGE_SIZE = 15
const SIDEBAR_FOOTER_PAGE_SIZE = 10
const SIDEBAR_DIRECTORY_SESSIONS_PAGE_SIZE = 10
const SIDEBAR_RECOVERY_THROTTLE_MS = 1500
const SIDEBAR_STATE_REQUEST_STALE_MS = 12000
const SIDEBAR_SESSION_HYDRATION_RETRY_MS = 10000
const SIDEBAR_RECOVERY_EVENT_TYPES = new Set([
  'session.created',
  'session.updated',
  'session.deleted',
  'session.status',
  'session.idle',
  'session.error',
  'permission.asked',
  'permission.replied',
  'question.asked',
  'question.replied',
  'question.rejected',
  'opencode-studio:session-activity',
])

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
  hasRunningSessions: boolean
  hasBlockedSessions: boolean
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
}

type SidebarInFlightVoidRequest = {
  key: string
  promise: Promise<void>
  controller: AbortController | null
  startedAt: number
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

function createAbortController(): AbortController | null {
  if (typeof AbortController === 'undefined') return null
  return new AbortController()
}

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException) return err.name === 'AbortError'
  if (!err || typeof err !== 'object') return false
  return (err as { name?: unknown }).name === 'AbortError'
}

function inFlightRequestIsStale(request: SidebarInFlightVoidRequest): boolean {
  return Date.now() - request.startedAt > SIDEBAR_STATE_REQUEST_STALE_MS
}

function readNonNegativeInt(raw: JsonValue | undefined): number | null {
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  const value = Math.floor(n)
  if (value < 0) return null
  return value
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

function jsonValueEquivalent(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== typeof right) return false
  if (left === null || right === null) return left === right

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false
    if (left.length !== right.length) return false
    for (let i = 0; i < left.length; i += 1) {
      if (!jsonValueEquivalent(left[i], right[i])) return false
    }
    return true
  }

  if (typeof left === 'object' && typeof right === 'object') {
    const leftRecord = left as UnknownRecord
    const rightRecord = right as UnknownRecord
    const leftKeys = Object.keys(leftRecord)
    const rightKeys = Object.keys(rightRecord)
    if (leftKeys.length !== rightKeys.length) return false
    for (const key of leftKeys) {
      if (!hasOwn(rightRecord, key)) return false
      if (!jsonValueEquivalent(leftRecord[key], rightRecord[key])) return false
    }
    return true
  }

  return false
}

function directoryEntryEquivalent(
  left: DirectoryEntry | null | undefined,
  right: DirectoryEntry | null | undefined,
): boolean {
  if (!left && !right) return true
  if (!left || !right) return false
  return left.id === right.id && left.path === right.path && left.label === right.label
}

function sessionRowEquivalent(
  left: SidebarSessionRow | null | undefined,
  right: SidebarSessionRow | null | undefined,
): boolean {
  if (!left && !right) return true
  if (!left || !right) return false
  return (
    left.id === right.id &&
    left.renderKey === right.renderKey &&
    left.depth === right.depth &&
    left.parentId === right.parentId &&
    left.rootId === right.rootId &&
    left.isParent === right.isParent &&
    left.isExpanded === right.isExpanded &&
    directoryEntryEquivalent(left.directory, right.directory) &&
    jsonValueEquivalent(left.session as JsonValue | undefined, right.session as JsonValue | undefined)
  )
}

function sessionRowsEquivalent(left: SidebarSessionRow[], right: SidebarSessionRow[]): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    if (!sessionRowEquivalent(left[i], right[i])) return false
  }
  return true
}

function stringArraysEquivalent(left: string[], right: string[]): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false
  }
  return true
}

function nullableStringRecordEquivalent(
  left: Record<string, string | null>,
  right: Record<string, string | null>,
): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  for (const key of leftKeys) {
    if (!hasOwn(right, key)) return false
    if (left[key] !== right[key]) return false
  }
  return true
}

function footerViewEquivalent(left: SidebarFooterView, right: SidebarFooterView): boolean {
  return (
    left.total === right.total &&
    left.page === right.page &&
    left.pageCount === right.pageCount &&
    sessionRowsEquivalent(left.rows, right.rows)
  )
}

function directorySidebarViewEquivalent(left: DirectorySidebarView, right: DirectorySidebarView): boolean {
  return (
    left.sessionCount === right.sessionCount &&
    left.rootPage === right.rootPage &&
    left.rootPageCount === right.rootPageCount &&
    left.hasActiveOrBlocked === right.hasActiveOrBlocked &&
    left.hasRunningSessions === right.hasRunningSessions &&
    left.hasBlockedSessions === right.hasBlockedSessions &&
    sessionRowsEquivalent(left.pinnedRows, right.pinnedRows) &&
    sessionRowsEquivalent(left.recentRows, right.recentRows) &&
    nullableStringRecordEquivalent(left.recentParentById, right.recentParentById) &&
    stringArraysEquivalent(left.recentRootIds, right.recentRootIds)
  )
}

function directorySidebarByIdEquivalent(
  left: Record<string, DirectorySidebarView>,
  right: Record<string, DirectorySidebarView>,
): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  for (const key of leftKeys) {
    if (!hasOwn(right, key)) return false
    if (!directorySidebarViewEquivalent(left[key], right[key])) return false
  }
  return true
}

function runtimeMapEquivalent(
  left: Record<string, SessionRuntimeState>,
  right: Record<string, SessionRuntimeState>,
): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  for (const key of leftKeys) {
    if (!hasOwn(right, key)) return false
    if (!runtimeStateEquivalent(left[key], right[key])) return false
    if (left[key].updatedAt !== right[key].updatedAt) return false
  }
  return true
}

function sidebarFocusEquivalent(left: SidebarFocusedSession | null, right: SidebarFocusedSession | null): boolean {
  if (!left && !right) return true
  if (!left || !right) return false
  return (
    left.sessionId === right.sessionId &&
    left.directoryId === right.directoryId &&
    left.directoryPath === right.directoryPath
  )
}

function directoryEntriesEquivalent(left: DirectoryEntry[], right: DirectoryEntry[]): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    if (!directoryEntryEquivalent(left[i], right[i])) return false
  }
  return true
}

function directoryEntriesByIdEquivalent(
  left: Record<string, DirectoryEntry>,
  right: Record<string, DirectoryEntry>,
): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  for (const key of leftKeys) {
    if (!hasOwn(right, key)) return false
    if (!directoryEntryEquivalent(left[key], right[key])) return false
  }
  return true
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
  const parentRaw = record.parentId ?? record.parentID ?? record.parent_id
  const parentId = typeof parentRaw === 'string' && parentRaw.trim() ? parentRaw.trim() : null
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

  const hasRunningSessions = section.hasRunningSessions === true || section.has_running_sessions === true
  const hasBlockedSessions = section.hasBlockedSessions === true || section.has_blocked_sessions === true
  const hasActiveOrBlocked =
    section.hasActiveOrBlocked === true ||
    section.has_active_or_blocked === true ||
    hasRunningSessions ||
    hasBlockedSessions

  return {
    sessionCount,
    rootPage,
    rootPageCount,
    hasActiveOrBlocked,
    hasRunningSessions,
    hasBlockedSessions,
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

function sessionSnapshotHasIdentity(session: SidebarSessionSummary | null | undefined): boolean {
  const title = typeof session?.title === 'string' ? session.title.trim() : ''
  const slug = typeof session?.slug === 'string' ? session.slug.trim() : ''
  return Boolean(title || slug)
}

function sessionSnapshotDirectory(session: SidebarSessionSummary | null | undefined): string {
  const directory = typeof session?.directory === 'string' ? session.directory.trim() : ''
  if (directory) return directory
  const cwd = typeof session?.cwd === 'string' ? session.cwd.trim() : ''
  return cwd
}

function readLocatedSessionId(record: UnknownRecord | null | undefined): string {
  return typeof record?.id === 'string' ? record.id.trim() : ''
}

function mergeSidebarSessionSummary(
  current: SidebarSessionSummary | null | undefined,
  incoming: Partial<Session> | SidebarSessionSummary | null | undefined,
  fallbackId: string,
): SidebarSessionSummary | null {
  const sid = String(fallbackId || '').trim()
  if (!sid) return null
  const currentRecord = current ? { ...current } : null
  const incomingRecord = incoming && typeof incoming === 'object' ? ({ ...incoming } as SidebarSessionSummary) : null

  if (!currentRecord && !incomingRecord) return null

  const merged = {
    ...(currentRecord || {}),
    ...(incomingRecord || {}),
    id: sid,
  } as SidebarSessionSummary

  const title =
    (typeof incomingRecord?.title === 'string' ? incomingRecord.title.trim() : '') ||
    (typeof currentRecord?.title === 'string' ? currentRecord.title.trim() : '')
  const slug =
    (typeof incomingRecord?.slug === 'string' ? incomingRecord.slug.trim() : '') ||
    (typeof currentRecord?.slug === 'string' ? currentRecord.slug.trim() : '')
  const directory = sessionSnapshotDirectory(incomingRecord) || sessionSnapshotDirectory(currentRecord)

  if (title) merged.title = title
  else delete merged.title
  if (slug) merged.slug = slug
  else delete merged.slug
  if (directory) {
    merged.directory = directory
  } else {
    delete merged.directory
  }
  const cwd = typeof merged.cwd === 'string' ? merged.cwd.trim() : ''
  if (cwd) merged.cwd = cwd
  else delete merged.cwd
  return merged
}

function mergeSidebarRowSnapshot(
  row: SidebarSessionRow,
  opts?: { session?: Partial<Session> | SidebarSessionSummary | null; directory?: DirectoryEntry | null },
): SidebarSessionRow {
  const session = mergeSidebarSessionSummary(row.session, opts?.session, row.id)
  const directory = opts?.directory || row.directory

  return {
    ...row,
    session,
    directory: directory || row.directory || null,
  }
}

function sidebarSessionNeedsHydration(row: SidebarSessionRow): boolean {
  if (!row.session) return true
  if (!sessionSnapshotHasIdentity(row.session)) return true
  if (!row.directory && !sessionSnapshotDirectory(row.session)) return true
  return false
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
  const chat = useChatStore()
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

  function syncPersistedPagingQueryFromPrefs(prefsRaw: Partial<ChatSidebarUiPrefs> | null | undefined) {
    const prefs = normalizeUiPrefs(prefsRaw)
    persistedStateQuery = {
      ...persistedStateQuery,
      directoriesPage: Math.max(0, Math.floor(Number(prefs.directoriesPage || 0))),
      pinnedPage: Math.max(0, Math.floor(Number(prefs.pinnedSessionsPage || 0))),
      recentPage: Math.max(0, Math.floor(Number(prefs.recentSessionsPage || 0))),
      runningPage: Math.max(0, Math.floor(Number(prefs.runningSessionsPage || 0))),
    }
  }

  let sidebarStateSyncTimer: number | null = null
  let sidebarStateSyncInFlight = false
  let sidebarStateSyncQueued = false
  let sidebarRecoverySyncTimer: number | null = null
  let lastSidebarRecoverySyncAt = 0
  let sidebarStateRequestInFlight: SidebarInFlightVoidRequest | null = null
  let lastAppliedDeltaSeq = 0
  const sidebarSessionHydrationInFlight = new Map<
    string,
    Promise<{ session: Session; directory: DirectoryEntry | null } | null>
  >()
  const sidebarSessionHydrationAttemptAt = new Map<string, number>()
  let sidebarSessionHydrationRunning: Promise<void> | null = null
  let sidebarSessionHydrationQueued = false

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

    if (!directoryEntriesByIdEquivalent(directoriesById.value, nextById)) {
      directoriesById.value = nextById
    }
    if (!stringArraysEquivalent(directoryOrder.value, order)) {
      directoryOrder.value = order
    }
  }

  function collectLoadedSidebarRows(): SidebarSessionRow[] {
    const rows: SidebarSessionRow[] = []
    for (const section of Object.values(directorySidebarById.value)) {
      rows.push(...section.pinnedRows, ...section.recentRows)
    }
    rows.push(...pinnedFooterView.value.rows, ...recentFooterView.value.rows, ...runningFooterView.value.rows)
    return rows
  }

  function knownSidebarRowBySessionId(): Record<string, SidebarSessionRow> {
    const known: Record<string, SidebarSessionRow> = {}
    for (const row of collectLoadedSidebarRows()) {
      const sid = String(row.id || '').trim()
      if (!sid) continue
      const previous = known[sid]
      if (!previous) {
        known[sid] = row
        continue
      }
      const merged = mergeSidebarRowSnapshot(previous, {
        session: row.session,
        directory: row.directory || previous.directory,
      })
      known[sid] = merged
    }
    return known
  }

  function knownDirectoryForSession(row: SidebarSessionRow): DirectoryEntry | null {
    if (row.directory?.id && row.directory.path) return row.directory
    const sessionPath = sessionSnapshotDirectory(row.session)
    if (!sessionPath) return null
    return directoryEntryByPath(sessionPath, directoriesById.value)
  }

  function enrichSidebarRowWithKnownData(
    row: SidebarSessionRow,
    knownRows: Record<string, SidebarSessionRow>,
  ): SidebarSessionRow {
    const sid = String(row.id || '').trim()
    if (!sid) return row
    const cachedSession = chat.getSessionById(sid)
    const knownRow = knownRows[sid]

    // Prefer sidebar/server snapshots over chat cache when both exist.
    // Cache can be temporarily stale/missing directory during cross-window SSE races.
    const preferredSession = mergeSidebarSessionSummary(
      cachedSession || null,
      row.session || knownRow?.session || null,
      sid,
    )

    const directory =
      row.directory ||
      knownRow?.directory ||
      knownDirectoryForSession(row) ||
      (knownRow ? knownDirectoryForSession(knownRow) : null)

    return mergeSidebarRowSnapshot(row, {
      session: preferredSession,
      directory,
    })
  }

  function enrichDirectorySidebarView(
    section: DirectorySidebarView,
    knownRows: Record<string, SidebarSessionRow>,
  ): DirectorySidebarView {
    return {
      ...section,
      pinnedRows: section.pinnedRows.map((row) => enrichSidebarRowWithKnownData(row, knownRows)),
      recentRows: section.recentRows.map((row) => enrichSidebarRowWithKnownData(row, knownRows)),
    }
  }

  function enrichFooterView(view: SidebarFooterView, knownRows: Record<string, SidebarSessionRow>): SidebarFooterView {
    return {
      ...view,
      rows: view.rows.map((row) => enrichSidebarRowWithKnownData(row, knownRows)),
    }
  }

  function applyHydratedSidebarSessions(
    entries: Map<string, { session: Session; directory: DirectoryEntry | null }>,
  ): boolean {
    if (entries.size === 0) return false
    let changed = false

    const nextDirectorySidebarById: Record<string, DirectorySidebarView> = {}
    for (const [directoryId, section] of Object.entries(directorySidebarById.value)) {
      const nextSection: DirectorySidebarView = {
        ...section,
        pinnedRows: section.pinnedRows.map((row) => {
          const hydrated = entries.get(row.id)
          if (!hydrated) return row
          const nextRow = mergeSidebarRowSnapshot(row, hydrated)
          if (!sessionRowEquivalent(row, nextRow)) changed = true
          return nextRow
        }),
        recentRows: section.recentRows.map((row) => {
          const hydrated = entries.get(row.id)
          if (!hydrated) return row
          const nextRow = mergeSidebarRowSnapshot(row, hydrated)
          if (!sessionRowEquivalent(row, nextRow)) changed = true
          return nextRow
        }),
      }
      nextDirectorySidebarById[directoryId] = nextSection
    }

    const mergeFooterRows = (rows: SidebarSessionRow[]): SidebarSessionRow[] =>
      rows.map((row) => {
        const hydrated = entries.get(row.id)
        if (!hydrated) return row
        const nextRow = mergeSidebarRowSnapshot(row, hydrated)
        if (!sessionRowEquivalent(row, nextRow)) changed = true
        return nextRow
      })

    const nextPinnedFooterView = { ...pinnedFooterView.value, rows: mergeFooterRows(pinnedFooterView.value.rows) }
    const nextRecentFooterView = { ...recentFooterView.value, rows: mergeFooterRows(recentFooterView.value.rows) }
    const nextRunningFooterView = { ...runningFooterView.value, rows: mergeFooterRows(runningFooterView.value.rows) }

    if (changed) {
      directorySidebarById.value = nextDirectorySidebarById
      pinnedFooterView.value = nextPinnedFooterView
      recentFooterView.value = nextRecentFooterView
      runningFooterView.value = nextRunningFooterView
    }

    return changed
  }

  async function hydrateSessionViaLocate(
    sessionId: string,
    hint?: { directoryId?: string; directoryPath?: string },
  ): Promise<{ session: Session; directory: DirectoryEntry | null } | null> {
    const sid = String(sessionId || '').trim()
    if (!sid) return null
    const located = asRecord(await chatApi.locateSession(sid).catch(() => null))
    const rawSession = asRecord((located?.session ?? null) as JsonValue)
    const locatedSessionId = readLocatedSessionId(rawSession)
    if (!rawSession || !locatedSessionId || locatedSessionId !== sid) return null
    const directory =
      resolveDirectoryEntryForSessionSnapshot(rawSession, {
        directoryId: typeof located?.projectId === 'string' ? located.projectId : hint?.directoryId,
        directoryPath:
          typeof located?.directory === 'string'
            ? located.directory
            : typeof located?.projectPath === 'string'
              ? located.projectPath
              : hint?.directoryPath,
      }) || null
    return {
      session: rawSession as Session,
      directory,
    }
  }

  function resolveDirectoryEntryForSessionSnapshot(
    session: Partial<Session> | SidebarSessionSummary | null | undefined,
    hint?: { directoryId?: string; directoryPath?: string },
  ): DirectoryEntry | null {
    const sessionDirectory = sessionSnapshotDirectory(session as SidebarSessionSummary | null)
    const hintId = String(hint?.directoryId || '').trim()
    const hintPath = String(hint?.directoryPath || '').trim()
    if (hintId) {
      const byId = directoriesById.value[hintId]
      if (byId?.path) return byId
    }
    if (sessionDirectory) {
      const byPath = directoryEntryByPath(sessionDirectory, directoriesById.value)
      if (byPath?.id && byPath.path) return byPath
    }
    if (hintPath) {
      const byPath = directoryEntryByPath(hintPath, directoriesById.value)
      if (byPath?.id && byPath.path) return byPath
      if (hintId) return { id: hintId, path: hintPath }
    }
    return null
  }

  async function hydrateIncompleteSidebarSessions(): Promise<void> {
    const knownRows = knownSidebarRowBySessionId()
    const candidateIds = new Set<string>()
    const groupedByDirectory = new Map<string, Set<string>>()
    const hintsBySessionId = new Map<string, { directoryId?: string; directoryPath?: string }>()
    const now = Date.now()

    for (const row of Object.values(knownRows)) {
      if (!sidebarSessionNeedsHydration(row)) continue
      const sid = String(row.id || '').trim()
      if (!sid) continue
      if (sidebarSessionHydrationInFlight.has(sid)) continue
      const lastAttempt = sidebarSessionHydrationAttemptAt.get(sid) || 0
      if (now - lastAttempt < SIDEBAR_SESSION_HYDRATION_RETRY_MS) continue
      candidateIds.add(sid)

      const directory = knownDirectoryForSession(row)
      const directoryPath = directory?.path || sessionSnapshotDirectory(row.session)
      if (directory?.id || directoryPath) {
        hintsBySessionId.set(sid, {
          directoryId: directory?.id || undefined,
          directoryPath: directoryPath || undefined,
        })
      }
      if (directoryPath) {
        const key = directoryPath.trim()
        const bucket = groupedByDirectory.get(key) || new Set<string>()
        bucket.add(sid)
        groupedByDirectory.set(key, bucket)
      }
      sidebarSessionHydrationAttemptAt.set(sid, now)
    }

    if (candidateIds.size === 0) return

    const hydrated = new Map<string, { session: Session; directory: DirectoryEntry | null }>()
    const unresolved = new Set<string>(candidateIds)

    const directoryTasks = [...groupedByDirectory.entries()].map(async ([directoryPath, sessionIds]) => {
      const ids = [...sessionIds]
      if (ids.length === 0) return
      const page = await chatApi.listSessions(directoryPath, {
        ids,
        scope: 'directory',
        includeTotal: false,
      })
      for (const session of page.sessions || []) {
        const sid = typeof session?.id === 'string' ? session.id.trim() : ''
        if (!sid || !candidateIds.has(sid)) continue
        unresolved.delete(sid)
        hydrated.set(sid, {
          session,
          directory: resolveDirectoryEntryForSessionSnapshot(session, {
            directoryPath,
            directoryId: hintsBySessionId.get(sid)?.directoryId,
          }),
        })
      }
    })

    await Promise.allSettled(directoryTasks)

    const locateTargets = [...unresolved]
    const locateTasks = locateTargets.map((sid) => {
      let task = sidebarSessionHydrationInFlight.get(sid)
      if (!task) {
        task = hydrateSessionViaLocate(sid, hintsBySessionId.get(sid)).finally(() => {
          sidebarSessionHydrationInFlight.delete(sid)
        })
        sidebarSessionHydrationInFlight.set(sid, task)
      }
      return task.then((result) => {
        if (!result?.session) return
        unresolved.delete(sid)
        hydrated.set(sid, {
          session: result.session,
          directory:
            result.directory || resolveDirectoryEntryForSessionSnapshot(result.session, hintsBySessionId.get(sid)),
        })
      })
    })

    await Promise.allSettled(locateTasks)

    if (hydrated.size === 0) {
      for (const sid of unresolved) {
        sidebarSessionHydrationAttemptAt.set(
          sid,
          Date.now() - SIDEBAR_SESSION_HYDRATION_RETRY_MS + SIDEBAR_RECOVERY_THROTTLE_MS,
        )
      }
      scheduleSidebarRecoverySync('sidebar-session-hydration-missed', 220)
      return
    }

    chat.cacheSessions(
      [...hydrated.values()].map((entry) => entry.session),
      { insertIfMissing: false },
    )
    applyHydratedSidebarSessions(hydrated)
    if (unresolved.size > 0) {
      for (const sid of unresolved) {
        sidebarSessionHydrationAttemptAt.set(
          sid,
          Date.now() - SIDEBAR_SESSION_HYDRATION_RETRY_MS + SIDEBAR_RECOVERY_THROTTLE_MS,
        )
      }
      scheduleSidebarRecoverySync('sidebar-session-hydration-partial', 220)
    }
  }

  function scheduleSidebarSessionHydration() {
    if (sidebarSessionHydrationRunning) {
      sidebarSessionHydrationQueued = true
      return
    }

    sidebarSessionHydrationRunning = (async () => {
      try {
        await hydrateIncompleteSidebarSessions()
      } finally {
        sidebarSessionHydrationRunning = null
        if (sidebarSessionHydrationQueued) {
          sidebarSessionHydrationQueued = false
          scheduleSidebarSessionHydration()
        }
      }
    })()
  }

  function applyAuthoritativeUiPrefs(incomingRaw: Partial<ChatSidebarUiPrefs> | null | undefined): boolean {
    if (isStaleAuthoritativePrefs(incomingRaw, uiPrefs.value)) {
      return false
    }
    const next = normalizeUiPrefs(incomingRaw)
    syncPersistedPagingQueryFromPrefs(next)
    if (jsonValueEquivalent(uiPrefs.value as JsonValue, next as JsonValue)) {
      return false
    }
    uiPrefs.value = next
    return true
  }

  function applyUiPrefsPatch(patchRaw: JsonValue): boolean {
    const patchRecord = asRecord(patchRaw)
    if (!patchRecord) return false

    const incomingVersion = readNonNegativeInt(patchRecord.version as JsonValue)
    const incomingUpdatedAt = readNonNegativeInt(patchRecord.updatedAt as JsonValue)
    const currentVersion = Math.max(0, Math.floor(Number(uiPrefs.value.version || 0)))
    const currentUpdatedAt = Math.max(0, Math.floor(Number(uiPrefs.value.updatedAt || 0)))
    if (incomingVersion !== null && incomingVersion < currentVersion) return false
    if (incomingVersion !== null && incomingVersion === currentVersion) {
      if (incomingUpdatedAt !== null && incomingUpdatedAt < currentUpdatedAt) return false
    }

    const nextPatch: Partial<ChatSidebarUiPrefs> = {}

    if (incomingVersion !== null) {
      nextPatch.version = incomingVersion
    }
    if (incomingUpdatedAt !== null) {
      nextPatch.updatedAt = incomingUpdatedAt
    }

    if (hasOwn(patchRecord, 'collapsedDirectoryIds')) {
      nextPatch.collapsedDirectoryIds = Array.isArray(patchRecord.collapsedDirectoryIds)
        ? patchRecord.collapsedDirectoryIds.map((value) => String(value || '').trim()).filter(Boolean)
        : []
    }
    if (hasOwn(patchRecord, 'expandedParentSessionIds')) {
      nextPatch.expandedParentSessionIds = Array.isArray(patchRecord.expandedParentSessionIds)
        ? patchRecord.expandedParentSessionIds.map((value) => String(value || '').trim()).filter(Boolean)
        : []
    }
    if (hasOwn(patchRecord, 'pinnedSessionIds')) {
      nextPatch.pinnedSessionIds = Array.isArray(patchRecord.pinnedSessionIds)
        ? patchRecord.pinnedSessionIds.map((value) => String(value || '').trim()).filter(Boolean)
        : []
    }

    const directoriesPage = readNonNegativeInt(patchRecord.directoriesPage as JsonValue)
    if (directoriesPage !== null) {
      nextPatch.directoriesPage = directoriesPage
    }

    const pagePatch = asRecord((patchRecord.sessionRootPageByDirectoryIdPatch ?? null) as JsonValue)
    if (pagePatch) {
      const nextMap = { ...uiPrefs.value.sessionRootPageByDirectoryId }
      let changed = false
      for (const [directoryIdRaw, pageRaw] of Object.entries(pagePatch)) {
        const directoryId = String(directoryIdRaw || '').trim()
        if (!directoryId) continue
        const page = readNonNegativeInt(pageRaw)
        if (page === null) continue
        if (nextMap[directoryId] !== page) {
          nextMap[directoryId] = page
          changed = true
        }
      }
      if (changed) {
        nextPatch.sessionRootPageByDirectoryId = nextMap
      }
    }

    if (hasOwn(patchRecord, 'pinnedSessionsOpen')) {
      nextPatch.pinnedSessionsOpen = patchRecord.pinnedSessionsOpen === true
    }
    const pinnedSessionsPage = readNonNegativeInt(patchRecord.pinnedSessionsPage as JsonValue)
    if (pinnedSessionsPage !== null) {
      nextPatch.pinnedSessionsPage = pinnedSessionsPage
    }

    if (hasOwn(patchRecord, 'recentSessionsOpen')) {
      nextPatch.recentSessionsOpen = patchRecord.recentSessionsOpen === true
    }
    const recentSessionsPage = readNonNegativeInt(patchRecord.recentSessionsPage as JsonValue)
    if (recentSessionsPage !== null) {
      nextPatch.recentSessionsPage = recentSessionsPage
    }

    if (hasOwn(patchRecord, 'runningSessionsOpen')) {
      nextPatch.runningSessionsOpen = patchRecord.runningSessionsOpen === true
    }
    const runningSessionsPage = readNonNegativeInt(patchRecord.runningSessionsPage as JsonValue)
    if (runningSessionsPage !== null) {
      nextPatch.runningSessionsPage = runningSessionsPage
    }

    const next = normalizeUiPrefs(patchChatSidebarUiPrefs(uiPrefs.value, nextPatch))
    syncPersistedPagingQueryFromPrefs(next)
    if (jsonValueEquivalent(uiPrefs.value as JsonValue, next as JsonValue)) {
      return false
    }
    uiPrefs.value = next
    return true
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
      const payload = await apiJson<ChatSidebarCommandsResponseWire>(SIDEBAR_COMMAND_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ commands: [command], compact: true }),
      })
      const payloadRecord = asRecord(payload as JsonValue) || {}
      if (hasOwn(payloadRecord, 'preferences')) {
        applyAuthoritativeUiPrefs((payloadRecord.preferences as Partial<ChatSidebarUiPrefs>) || undefined)
      }

      const deltaRecord = asRecord(payloadRecord.delta as JsonValue)
      const deltaOps = (deltaRecord?.ops as JsonValue) || []
      const deltaSeq = readNonNegativeInt((deltaRecord?.seq ?? null) as JsonValue)
      await applySidebarDeltaOps(deltaOps, deltaSeq)

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
    persistedStateQuery = {
      ...persistedStateQuery,
      directoriesPage: target,
    }
    return executeSidebarCommand({ type: 'setDirectoriesPage', page: target }, opts)
  }

  async function commandSetDirectoryCollapsed(
    directoryId: string,
    collapsed: boolean,
    opts?: { silent?: boolean },
  ): Promise<boolean> {
    const did = String(directoryId || '').trim()
    if (!did) return false
    const ok = await executeSidebarCommand({ type: 'setDirectoryCollapsed', directoryId: did, collapsed }, opts)
    return ok
  }

  async function commandSetDirectoryRootPage(
    directoryId: string,
    page: number,
    opts?: { silent?: boolean },
  ): Promise<boolean> {
    const did = String(directoryId || '').trim()
    if (!did) return false
    const target = Math.max(0, Math.floor(Number(page || 0)))
    return executeSidebarCommand({ type: 'setDirectoryRootPage', directoryId: did, page: target }, opts)
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
    persistedStateQuery = {
      ...persistedStateQuery,
      ...(kind === 'pinned'
        ? { pinnedPage: target }
        : kind === 'recent'
          ? { recentPage: target }
          : { runningPage: target }),
    }
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

    if (!directoryEntriesEquivalent(directoryPageRows.value, entries)) {
      directoryPageRows.value = entries
    }
    const nextDirectoryPageTotal =
      typeof directoriesPage?.total === 'number' && Number.isFinite(directoriesPage.total)
        ? Math.max(0, Math.floor(directoriesPage.total))
        : entries.length
    if (directoryPageTotal.value !== nextDirectoryPageTotal) {
      directoryPageTotal.value = nextDirectoryPageTotal
    }

    const offsetRaw = Number(directoriesPage?.offset)
    const limitRaw = Number(directoriesPage?.limit)
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.max(1, Math.floor(limitRaw)) : 1
    const nextPageIndex = Math.max(0, Math.floor(offset / limit))
    if (directoriesPageIndex.value !== nextPageIndex) {
      directoriesPageIndex.value = nextPageIndex
    }

    return entries
  }

  function applySidebarStatePayload(stateRaw: JsonValue) {
    const stateRecord = asRecord(stateRaw) || {}
    if (!hasOwn(stateRecord, 'preferences')) {
      throw new Error('chat sidebar state payload is missing preferences')
    }
    applyAuthoritativeUiPrefs((stateRecord.preferences as Partial<ChatSidebarUiPrefs>) || undefined)

    applyDirectoriesPagePayload((stateRecord.directoriesPage ?? stateRecord.directories_page) as JsonValue)

    const knownRows = knownSidebarRowBySessionId()
    const normalizedViewRaw = normalizeSidebarView(stateRecord.view as JsonValue)
    const normalizedView: NormalizedSidebarView = {
      directorySidebarById: Object.fromEntries(
        Object.entries(normalizedViewRaw.directorySidebarById).map(([directoryId, section]) => [
          directoryId,
          enrichDirectorySidebarView(section, knownRows),
        ]),
      ),
      pinnedFooterView: enrichFooterView(normalizedViewRaw.pinnedFooterView, knownRows),
      recentFooterView: enrichFooterView(normalizedViewRaw.recentFooterView, knownRows),
      runningFooterView: enrichFooterView(normalizedViewRaw.runningFooterView, knownRows),
    }

    const nextRuntimeBySessionId = parseRuntimeMap(
      (stateRecord.runtimeBySessionId ?? stateRecord.runtime_by_session_id) as JsonValue,
    )
    if (!runtimeMapEquivalent(runtimeBySessionId.value, nextRuntimeBySessionId)) {
      runtimeBySessionId.value = nextRuntimeBySessionId
    }
    if (!directorySidebarByIdEquivalent(directorySidebarById.value, normalizedView.directorySidebarById)) {
      directorySidebarById.value = normalizedView.directorySidebarById
    }
    if (!footerViewEquivalent(pinnedFooterView.value, normalizedView.pinnedFooterView)) {
      pinnedFooterView.value = normalizedView.pinnedFooterView
    }
    if (!footerViewEquivalent(recentFooterView.value, normalizedView.recentFooterView)) {
      recentFooterView.value = normalizedView.recentFooterView
    }
    if (!footerViewEquivalent(runningFooterView.value, normalizedView.runningFooterView)) {
      runningFooterView.value = normalizedView.runningFooterView
    }

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
    const nextFocus =
      focusSid && focusDid && focusPath
        ? {
            sessionId: focusSid,
            directoryId: focusDid,
            directoryPath: focusPath,
          }
        : null
    if (!sidebarFocusEquivalent(sidebarStateFocus.value, nextFocus)) {
      sidebarStateFocus.value = nextFocus
    }

    scheduleSidebarSessionHydration()
  }

  async function revalidateFromStateApi(opts?: SidebarStateQuery): Promise<void> {
    persistedStateQuery = applyPersistentStateQueryOverrides(persistedStateQuery, opts)
    const focusSessionId = typeof opts?.focusSessionId === 'string' ? opts.focusSessionId.trim() : ''
    const stateUrl = buildSidebarStateUrl(persistedStateQuery, focusSessionId)

    const existingRequest = sidebarStateRequestInFlight
    if (existingRequest?.key === stateUrl && !inFlightRequestIsStale(existingRequest)) {
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
      startedAt: Date.now(),
    }
    return requestPromise
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

  function scheduleSidebarRecoverySync(reason: string, delayMs = 120, opts?: { force?: boolean }) {
    if (opts?.force) {
      if (sidebarRecoverySyncTimer !== null) {
        window.clearTimeout(sidebarRecoverySyncTimer)
        sidebarRecoverySyncTimer = null
      }
      lastSidebarRecoverySyncAt = Date.now()
      scheduleSidebarStateSync(Math.max(0, Math.floor(delayMs)))
      void reason
      return
    }

    const now = Date.now()
    const elapsed = now - lastSidebarRecoverySyncAt
    const throttleDelay = elapsed >= SIDEBAR_RECOVERY_THROTTLE_MS ? 0 : SIDEBAR_RECOVERY_THROTTLE_MS - elapsed
    const waitMs = Math.max(0, Math.floor(Math.max(delayMs, throttleDelay)))

    if (sidebarRecoverySyncTimer !== null) {
      window.clearTimeout(sidebarRecoverySyncTimer)
      sidebarRecoverySyncTimer = null
    }

    sidebarRecoverySyncTimer = window.setTimeout(() => {
      sidebarRecoverySyncTimer = null
      lastSidebarRecoverySyncAt = Date.now()
      scheduleSidebarStateSync(0)
      void reason
    }, waitMs)
  }

  async function applySidebarDeltaOps(opsRaw: JsonValue, deltaSeq?: number | null): Promise<boolean> {
    const opsList = Array.isArray(opsRaw) ? opsRaw : []
    if (opsList.length === 0) {
      if (typeof deltaSeq === 'number' && Number.isFinite(deltaSeq) && deltaSeq > lastAppliedDeltaSeq) {
        lastAppliedDeltaSeq = Math.floor(deltaSeq)
      }
      return true
    }

    let invalidateState = false
    let invalidateDirectoriesPage = false
    let invalidatePreferences = false
    const directoryIds = new Set<string>()
    const footerKinds = new Set<SidebarFooterKind>()
    const appliedDirectoryViews = new Map<string, DirectorySidebarView>()
    const directoryIdsWithInlineView = new Set<string>()
    const appliedFooterViews = new Map<SidebarFooterKind, SidebarFooterView>()
    const footerKindsWithInlineView = new Set<SidebarFooterKind>()
    const knownRows = knownSidebarRowBySessionId()

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
      if (type === 'applyPreferences') {
        applyUiPrefsPatch((op.patch ?? null) as JsonValue)
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
        const sectionBase = normalizeDirectorySidebarSection(viewRaw, did)
        const section = sectionBase ? enrichDirectorySidebarView(sectionBase, knownRows) : null
        if (!section) continue
        appliedDirectoryViews.set(did, section)
        directoryIdsWithInlineView.add(did)
        continue
      }
      if (type === 'applyFooterView') {
        const kind = normalizeFooterKind(op.kind as JsonValue)
        if (!kind) continue
        const view = enrichFooterView(normalizeSidebarFooterView((op.view ?? null) as JsonValue), knownRows)
        appliedFooterViews.set(kind, view)
        footerKindsWithInlineView.add(kind)
        continue
      }

      // Unknown op -> safest fallback.
      invalidateState = true
    }

    if (invalidateState) {
      await revalidateFromStateApi()
      if (typeof deltaSeq === 'number' && Number.isFinite(deltaSeq) && deltaSeq > lastAppliedDeltaSeq) {
        lastAppliedDeltaSeq = Math.floor(deltaSeq)
      }
      return true
    }

    for (const directoryId of directoryIdsWithInlineView) {
      directoryIds.delete(directoryId)
    }
    for (const kind of footerKindsWithInlineView) {
      footerKinds.delete(kind)
    }

    if (appliedDirectoryViews.size > 0) {
      const nextDirectoryRowsById = { ...directorySidebarById.value }
      const nextSessionRootPageByDirectoryId = { ...uiPrefs.value.sessionRootPageByDirectoryId }
      let hasDirectoryViewChange = false
      let hasPrefsChange = false

      for (const [directoryId, section] of appliedDirectoryViews.entries()) {
        const previousSection = directorySidebarById.value[directoryId]
        if (!previousSection || !directorySidebarViewEquivalent(previousSection, section)) {
          nextDirectoryRowsById[directoryId] = section
          hasDirectoryViewChange = true
        }
        const previousRootPage = Math.max(
          0,
          Math.floor(Number(uiPrefs.value.sessionRootPageByDirectoryId[directoryId] || 0)),
        )
        if (previousRootPage !== section.rootPage) {
          nextSessionRootPageByDirectoryId[directoryId] = section.rootPage
          hasPrefsChange = true
        }
      }

      if (hasDirectoryViewChange) {
        directorySidebarById.value = nextDirectoryRowsById
      }
      if (hasPrefsChange) {
        uiPrefs.value = normalizeUiPrefs({
          ...uiPrefs.value,
          sessionRootPageByDirectoryId: nextSessionRootPageByDirectoryId,
        })
      }
    }

    if (appliedFooterViews.size > 0) {
      const pinnedView = appliedFooterViews.get('pinned')
      const recentView = appliedFooterViews.get('recent')
      const runningView = appliedFooterViews.get('running')

      if (pinnedView && !footerViewEquivalent(pinnedFooterView.value, pinnedView)) {
        pinnedFooterView.value = pinnedView
      }
      if (recentView && !footerViewEquivalent(recentFooterView.value, recentView)) {
        recentFooterView.value = recentView
      }
      if (runningView && !footerViewEquivalent(runningFooterView.value, runningView)) {
        runningFooterView.value = runningView
      }
    }

    if (invalidateDirectoriesPage) {
      await revalidateFromStateApi({ directoriesPage: uiPrefs.value.directoriesPage })
      if (typeof deltaSeq === 'number' && Number.isFinite(deltaSeq) && deltaSeq > lastAppliedDeltaSeq) {
        lastAppliedDeltaSeq = Math.floor(deltaSeq)
      }
      return true
    }

    const targetedFetchCount = directoryIds.size + footerKinds.size + (invalidatePreferences ? 1 : 0)

    if (invalidatePreferences || targetedFetchCount > 8) {
      await revalidateFromStateApi()
      if (typeof deltaSeq === 'number' && Number.isFinite(deltaSeq) && deltaSeq > lastAppliedDeltaSeq) {
        lastAppliedDeltaSeq = Math.floor(deltaSeq)
      }
      return true
    }

    let needFullFallback = false

    if (!needFullFallback && directoryIds.size > 0) {
      const directoryTasks = [...directoryIds].map((directoryId) =>
        revalidateDirectorySessionPageFromApi(directoryId, {
          page: uiPrefs.value.sessionRootPageByDirectoryId[directoryId],
          pageSize: persistedStateQuery.limitPerDirectory,
          silent: true,
        }),
      )
      const results = await Promise.allSettled(directoryTasks)
      if (results.some((result) => result.status !== 'fulfilled' || result.value !== true)) {
        needFullFallback = true
      }
    }

    if (!needFullFallback && footerKinds.size > 0) {
      const footerTasks = [...footerKinds].map((kind) =>
        revalidateFooterFromApi(kind, {
          page:
            kind === 'pinned'
              ? uiPrefs.value.pinnedSessionsPage
              : kind === 'recent'
                ? uiPrefs.value.recentSessionsPage
                : uiPrefs.value.runningSessionsPage,
          pageSize: SIDEBAR_FOOTER_PAGE_SIZE,
          silent: true,
        }),
      )
      const results = await Promise.allSettled(footerTasks)
      if (results.some((result) => result.status !== 'fulfilled' || result.value !== true)) {
        needFullFallback = true
      }
    }

    if (needFullFallback) {
      await revalidateFromStateApi()
    }

    if (typeof deltaSeq === 'number' && Number.isFinite(deltaSeq) && deltaSeq > lastAppliedDeltaSeq) {
      lastAppliedDeltaSeq = Math.floor(deltaSeq)
    }

    scheduleSidebarSessionHydration()

    return true
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
    if (!opts?.silent) {
      loading.value = true
    }
    error.value = null
    try {
      const pageRaw =
        typeof opts?.page === 'number' && Number.isFinite(opts.page) ? opts.page : uiPrefs.value.directoriesPage
      const page = Math.max(0, Math.floor(Number(pageRaw || 0)))
      const pageSizeRaw =
        typeof opts?.pageSize === 'number' && Number.isFinite(opts.pageSize)
          ? opts.pageSize
          : SIDEBAR_DIRECTORIES_PAGE_SIZE
      const pageSize = Math.max(1, Math.floor(Number(pageSizeRaw || SIDEBAR_DIRECTORIES_PAGE_SIZE)))
      const query =
        typeof opts?.query === 'string'
          ? opts.query.trim()
          : typeof persistedStateQuery.directoryQuery === 'string'
            ? persistedStateQuery.directoryQuery.trim()
            : ''

      const params = new URLSearchParams()
      params.set('offset', String(page * pageSize))
      params.set('limit', String(pageSize))
      if (query) {
        params.set('query', query)
      }
      const payload = await apiJson<JsonValue>(`${SIDEBAR_DIRECTORIES_ENDPOINT}?${params.toString()}`)
      applyDirectoriesPagePayload(payload)
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      if (!opts?.silent) {
        loading.value = false
      }
    }
  }

  function applyChatSidebarDeltaEvent(evt: SseEvent) {
    const type = readEventType(evt)
    if (type !== 'chat-sidebar.delta') return
    const evtRecord = asRecord(evt as JsonValue) || {}
    const properties = asRecord(evtRecord.properties as JsonValue) || {}
    const deltaSeq = readNonNegativeInt((properties.seq ?? evtRecord.seq ?? null) as JsonValue)
    if (deltaSeq !== null && deltaSeq <= lastAppliedDeltaSeq) {
      return
    }
    const delta = asRecord((properties.delta ?? evtRecord.delta) as JsonValue)
    const ops = (delta?.ops as JsonValue) || []
    void applySidebarDeltaOps(ops, deltaSeq).catch(() => {
      scheduleSidebarRecoverySync('delta-apply-failed', 100)
    })
  }

  function applyGlobalEvent(evt: SseEvent) {
    const type = readEventType(evt)
    if (!type) return
    const normalizedType = type.toLowerCase()

    if (normalizedType === 'chat-sidebar.delta') {
      applyChatSidebarDeltaEvent(evt)
      return
    }

    if (
      normalizedType === 'chat-sidebar.patch' ||
      normalizedType === 'chat-sidebar.state' ||
      normalizedType === 'opencode-studio:replay-gap'
    ) {
      scheduleSidebarRecoverySync(normalizedType, 140)
      return
    }

    if (SIDEBAR_RECOVERY_EVENT_TYPES.has(normalizedType)) {
      scheduleSidebarRecoverySync(`event:${normalizedType}`, 90)
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
    if (!opts?.silent) {
      loading.value = true
    }
    error.value = null
    try {
      const pageSizeRaw =
        typeof opts?.pageSize === 'number' && Number.isFinite(opts.pageSize)
          ? opts.pageSize
          : (persistedStateQuery.limitPerDirectory ?? SIDEBAR_DIRECTORY_SESSIONS_PAGE_SIZE)
      const pageSize = Math.max(1, Math.floor(Number(pageSizeRaw || SIDEBAR_DIRECTORY_SESSIONS_PAGE_SIZE)))
      const requestedPageRaw =
        typeof opts?.page === 'number' && Number.isFinite(opts.page)
          ? opts.page
          : (uiPrefs.value.sessionRootPageByDirectoryId[did] ?? 0)
      const page = setSessionRootPage(did, requestedPageRaw, pageSize)

      const params = new URLSearchParams()
      params.set('scope', 'directory')
      params.set('roots', 'true')
      params.set('includeChildren', 'true')
      params.set('includeTotal', 'true')
      params.set('offset', String(page * pageSize))
      params.set('limit', String(pageSize))
      const payload = await apiJson<JsonValue>(
        `${SIDEBAR_DIRECTORIES_ENDPOINT}/${encodeURIComponent(did)}/sessions?${params.toString()}`,
      )
      const payloadRecord = asRecord(payload) || {}
      const sectionRaw = (payloadRecord.sidebarView ?? payloadRecord.sidebar_view) as JsonValue
      const sectionBase = normalizeDirectorySidebarSection(sectionRaw, did)
      const section = sectionBase ? enrichDirectorySidebarView(sectionBase, knownSidebarRowBySessionId()) : null
      if (!section) return false

      const previousSection = directorySidebarById.value[did]
      if (!previousSection || !directorySidebarViewEquivalent(previousSection, section)) {
        directorySidebarById.value = {
          ...directorySidebarById.value,
          [did]: section,
        }
      }

      const previousRootPage = Math.max(0, Math.floor(Number(uiPrefs.value.sessionRootPageByDirectoryId[did] || 0)))
      if (previousRootPage !== section.rootPage) {
        const nextMap = {
          ...uiPrefs.value.sessionRootPageByDirectoryId,
          [did]: section.rootPage,
        }
        uiPrefs.value = normalizeUiPrefs(
          patchChatSidebarUiPrefs(uiPrefs.value, {
            sessionRootPageByDirectoryId: nextMap,
          }),
        )
      }

      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      if (!opts?.silent) {
        loading.value = false
      }
      scheduleSidebarSessionHydration()
    }
  }

  async function revalidateFooterFromApi(
    kind: SidebarFooterKind,
    opts?: { page?: number; pageSize?: number; silent?: boolean },
  ): Promise<boolean> {
    if (!opts?.silent) {
      loading.value = true
    }
    error.value = null
    try {
      const targetKind: SidebarFooterKind = kind
      const pageRaw =
        typeof opts?.page === 'number' && Number.isFinite(opts.page)
          ? opts.page
          : targetKind === 'pinned'
            ? uiPrefs.value.pinnedSessionsPage
            : targetKind === 'recent'
              ? uiPrefs.value.recentSessionsPage
              : uiPrefs.value.runningSessionsPage
      const page = Math.max(0, Math.floor(Number(pageRaw || 0)))
      const pageSizeRaw =
        typeof opts?.pageSize === 'number' && Number.isFinite(opts.pageSize) ? opts.pageSize : SIDEBAR_FOOTER_PAGE_SIZE
      const pageSize = Math.max(1, Math.floor(Number(pageSizeRaw || SIDEBAR_FOOTER_PAGE_SIZE)))

      const params = new URLSearchParams()
      params.set('kind', targetKind)
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))
      const payload = await apiJson<JsonValue>(`${SIDEBAR_FOOTER_ENDPOINT}?${params.toString()}`)
      const payloadRecord = asRecord(payload) || {}
      const view = enrichFooterView(
        normalizeSidebarFooterView((payloadRecord.view ?? null) as JsonValue),
        knownSidebarRowBySessionId(),
      )

      if (targetKind === 'pinned') {
        if (!footerViewEquivalent(pinnedFooterView.value, view)) {
          pinnedFooterView.value = view
        }
      } else if (targetKind === 'recent') {
        if (!footerViewEquivalent(recentFooterView.value, view)) {
          recentFooterView.value = view
        }
      } else {
        if (!footerViewEquivalent(runningFooterView.value, view)) {
          runningFooterView.value = view
        }
      }

      const patch: Partial<ChatSidebarUiPrefs> = {}
      if (targetKind === 'pinned') {
        patch.pinnedSessionsPage = view.page
      } else if (targetKind === 'recent') {
        patch.recentSessionsPage = view.page
      } else {
        patch.runningSessionsPage = view.page
      }
      uiPrefs.value = normalizeUiPrefs(patchChatSidebarUiPrefs(uiPrefs.value, patch))

      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      if (!opts?.silent) {
        loading.value = false
      }
      scheduleSidebarSessionHydration()
    }
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
    const locatedSession = asRecord((loc?.session ?? null) as JsonValue)
    const locatedSessionId = readLocatedSessionId(locatedSession)
    const canUseRemoteLocate = !locatedSession || !locatedSessionId || locatedSessionId === sid
    const rawPid = loc?.projectId ?? loc?.project_id
    const rawPath = loc?.projectPath ?? loc?.project_path

    const pid = canUseRemoteLocate && typeof rawPid === 'string' ? rawPid.trim() : ''
    const ppath = canUseRemoteLocate && typeof rawPath === 'string' ? rawPath.trim() : ''
    const locatedDir = canUseRemoteLocate && typeof loc?.directory === 'string' ? loc.directory.trim() : ''

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

    if (sidebarRecoverySyncTimer !== null) {
      window.clearTimeout(sidebarRecoverySyncTimer)
      sidebarRecoverySyncTimer = null
    }
    lastSidebarRecoverySyncAt = 0

    if (sidebarStateRequestInFlight?.controller) {
      sidebarStateRequestInFlight.controller.abort()
    }
    sidebarStateRequestInFlight = null
    lastAppliedDeltaSeq = 0
    sidebarSessionHydrationInFlight.clear()
    sidebarSessionHydrationAttemptAt.clear()
    sidebarSessionHydrationRunning = null
    sidebarSessionHydrationQueued = false

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
    scheduleSidebarRecoverySync,
    revalidateFromApi,
    bootstrapWithStaleWhileRevalidate,
    resetAllPersistedState,
  }
})

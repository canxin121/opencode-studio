import { normalizeRuntime, type SessionRuntimeState } from '../directorySessionRuntime'
import { parseSessionPayloadConsistency, type SessionPayloadConsistency } from '../sessionConsistency'
import type { SessionRuntimeSnapshot, SessionSummarySnapshot } from '../../data/directorySessionSnapshotDb'
import type { JsonObject, JsonValue } from '../../types/json'

export type { SessionPayloadConsistency } from '../sessionConsistency'

export type DirectorySessionPageState = {
  page: number
  totalRoots: number
  sessions: SessionSummarySnapshot[]
  consistency?: SessionPayloadConsistency
  treeHint?: DirectorySessionTreeHint
}

export type DirectorySessionTreeHint = {
  rootSessionIds: string[]
  childrenByParentSessionId: Record<string, string[]>
}

export type DirectorySessionsBootstrapWire = {
  directoryEntries?: JsonValue
  sessionSummariesByDirectoryId?: JsonValue
  runtimeBySessionId?: JsonValue
  seq?: number
}

export type ChatSidebarStateWire = {
  preferences?: JsonValue
  seq?: number
  directoriesPage?: JsonValue
  sessionPagesByDirectoryId?: JsonValue
  runtimeBySessionId?: JsonValue
  recentPage?: JsonValue
  runningPage?: JsonValue
}

export type PagedIndexWire<T> = {
  items?: T[]
  total?: number
  offset?: number
  limit?: number
  hasMore?: boolean
  nextOffset?: number
}

export type RecentIndexWireItem = {
  sessionId?: string
  directoryId?: string
  directoryPath?: string
  updatedAt?: number
}

export type RunningIndexWireItem = {
  sessionId?: string
  directoryId?: string | null
  directoryPath?: string | null
  runtime?: SessionRuntimeSnapshot | null
  updatedAt?: number
}

export type SessionSummariesWire = {
  summaries?: JsonValue
  missingIds?: JsonValue
}

export type DirectoriesPageWire = {
  items?: JsonValue
  total?: number
  offset?: number
  limit?: number
  hasMore?: boolean
  nextOffset?: number
}

export type RecentIndexEntry = {
  sessionId: string
  directoryId: string
  directoryPath: string
  updatedAt: number
}

export type RunningIndexEntry = {
  sessionId: string
  directoryId: string | null
  directoryPath: string | null
  runtime: SessionRuntimeState
  updatedAt: number
}

export const DIRECTORIES_PAGE_SIZE_DEFAULT = 15
export const FOOTER_PAGE_SIZE_DEFAULT = 10
export const RECENT_INDEX_MAX_ITEMS = 40
export const RECENT_INDEX_DEFAULT_LIMIT = RECENT_INDEX_MAX_ITEMS
export const RUNNING_INDEX_MAX_ITEMS = 400
export const RUNNING_INDEX_DEFAULT_LIMIT = RUNNING_INDEX_MAX_ITEMS

function asRecord(value: JsonValue): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value
}

function toSessionSummarySnapshot(value: JsonValue): SessionSummarySnapshot | null {
  const record = asRecord(value)
  const id = typeof record?.id === 'string' ? record.id.trim() : ''
  if (!record || !id) return null
  return { ...record, id }
}

function toSessionSummarySnapshotList(value: JsonValue): SessionSummarySnapshot[] {
  if (!Array.isArray(value)) return []
  const out: SessionSummarySnapshot[] = []
  for (const item of value) {
    const summary = toSessionSummarySnapshot(item)
    if (summary) out.push(summary)
  }
  return out
}

export function parseSessionPagePayload(raw: JsonValue, fallbackLimit: number): DirectorySessionPageState {
  const payload = asRecord(raw)
  const sessions = Array.isArray(payload?.sessions)
    ? toSessionSummarySnapshotList(payload.sessions)
    : toSessionSummarySnapshotList(raw)
  const totalRoots =
    typeof payload?.total === 'number' && Number.isFinite(payload.total)
      ? Math.max(0, Math.floor(payload.total))
      : sessions.length
  const offset =
    typeof payload?.offset === 'number' && Number.isFinite(payload.offset) ? Math.max(0, Math.floor(payload.offset)) : 0
  const limit =
    typeof payload?.limit === 'number' && Number.isFinite(payload.limit) && payload.limit > 0
      ? Math.max(1, Math.floor(payload.limit))
      : Math.max(1, Math.floor(fallbackLimit || 10))
  const consistency = parseSessionPayloadConsistency(payload?.consistency)
  const treeHintRaw = asRecord(payload?.treeHint)
  const rootSessionIds = Array.isArray(treeHintRaw?.rootSessionIds)
    ? treeHintRaw.rootSessionIds.map((value) => String(value || '').trim()).filter(Boolean)
    : []
  const childrenByParentSessionId: Record<string, string[]> = {}
  const rawChildren = asRecord(treeHintRaw?.childrenByParentSessionId)
  for (const [parentIdRaw, childListRaw] of Object.entries(rawChildren || {})) {
    const parentId = String(parentIdRaw || '').trim()
    if (!parentId || !Array.isArray(childListRaw)) continue
    const childIds = childListRaw.map((value) => String(value || '').trim()).filter(Boolean)
    if (childIds.length === 0) continue
    childrenByParentSessionId[parentId] = Array.from(new Set(childIds))
  }
  const treeHint =
    rootSessionIds.length > 0 || Object.keys(childrenByParentSessionId).length > 0
      ? {
          rootSessionIds: Array.from(new Set(rootSessionIds)),
          childrenByParentSessionId,
        }
      : undefined
  return {
    page: Math.floor(offset / limit),
    totalRoots,
    sessions,
    ...(treeHint ? { treeHint } : {}),
    ...(consistency ? { consistency } : {}),
  }
}

export function normalizeRecentIndexItem(raw: RecentIndexWireItem | null | undefined): RecentIndexEntry | null {
  const sessionId = typeof raw?.sessionId === 'string' ? raw.sessionId.trim() : ''
  const directoryId = typeof raw?.directoryId === 'string' ? raw.directoryId.trim() : ''
  const directoryPath = typeof raw?.directoryPath === 'string' ? raw.directoryPath.trim() : ''
  const updatedAt = typeof raw?.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
  if (!sessionId || !directoryId || !directoryPath) return null
  return { sessionId, directoryId, directoryPath, updatedAt }
}

export function normalizeRunningIndexItem(raw: RunningIndexWireItem | null | undefined): RunningIndexEntry | null {
  const sessionId = typeof raw?.sessionId === 'string' ? raw.sessionId.trim() : ''
  if (!sessionId) return null
  const directoryId = typeof raw?.directoryId === 'string' ? raw.directoryId.trim() : null
  const directoryPath = typeof raw?.directoryPath === 'string' ? raw.directoryPath.trim() : null
  const updatedAt = typeof raw?.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now()
  const runtime = normalizeRuntime(raw?.runtime || undefined)
  return {
    sessionId,
    directoryId,
    directoryPath,
    runtime,
    updatedAt,
  }
}

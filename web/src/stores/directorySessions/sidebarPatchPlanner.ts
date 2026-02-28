import type { SessionSummarySnapshot } from '../../data/directorySessionSnapshotDb'
import type { DirectoryEntry } from '../../features/sessions/model/types'
import type { JsonValue } from '../../types/json'
import type { ChatSidebarPatchOp } from './prefs'

type SidebarPatchPlannerContext = {
  directoriesById: Record<string, DirectoryEntry>
  directoryIdBySessionId: Record<string, string>
  sessionSummariesById: Record<string, SessionSummarySnapshot>
}

export type SidebarPatchPlannerResult = {
  runtimeOnlyOps: ChatSidebarPatchOp[]
  refreshDirectoryIds: string[]
  refreshAll: boolean
  refreshRecentIndex: boolean
  refreshRunningIndex: boolean
  usedBackendHint: boolean
}

export type SidebarPatchRefreshHint = {
  refreshAll: boolean
  refreshDirectoryIds: string[]
  refreshRecentIndex: boolean
  refreshRunningIndex: boolean
}

function normalizeDirForCompareLite(path: string): string {
  const raw = String(path || '').trim()
  if (!raw) return ''
  return raw.replace(/\\+/g, '/').replace(/\/+$/, '').toLowerCase()
}

function directoryIdForPath(path: string, directoriesById: Record<string, DirectoryEntry>): string {
  const normalized = normalizeDirForCompareLite(path)
  if (!normalized) return ''
  for (const entry of Object.values(directoriesById)) {
    const id = String(entry?.id || '').trim()
    if (!id) continue
    if (normalizeDirForCompareLite(String(entry?.path || '')) === normalized) {
      return id
    }
  }
  return ''
}

function collectDirectoryFromSession(
  sessionId: string,
  context: SidebarPatchPlannerContext,
  maybeSession?: SessionSummarySnapshot | null,
): string {
  const sid = String(sessionId || '').trim()
  if (!sid) return ''
  const mapped = String(context.directoryIdBySessionId[sid] || '').trim()
  if (mapped) return mapped
  const fromKnown = context.sessionSummariesById[sid]
  const payload = maybeSession || fromKnown
  const path = typeof payload?.directory === 'string' ? payload.directory : ''
  return directoryIdForPath(path, context.directoriesById)
}

export function planSidebarPatchOps(
  ops: ChatSidebarPatchOp[],
  context: SidebarPatchPlannerContext,
): SidebarPatchPlannerResult {
  const runtimeOnlyOps: ChatSidebarPatchOp[] = []
  const refreshDirectoryIds = new Set<string>()
  let refreshAll = false

  for (const op of ops) {
    switch (op.type) {
      case 'sessionRuntime.upsert':
      case 'sessionRuntime.remove':
        runtimeOnlyOps.push(op)
        break
      case 'directoryEntry.upsert':
      case 'directoryEntry.remove':
        refreshAll = true
        break
      case 'sessionSummary.upsert': {
        const sid = String(op.session?.id || '').trim()
        if (!sid) {
          refreshAll = true
          break
        }
        const prevDid = collectDirectoryFromSession(sid, context)
        const nextDid = collectDirectoryFromSession(sid, context, op.session)
        if (prevDid) refreshDirectoryIds.add(prevDid)
        if (nextDid) refreshDirectoryIds.add(nextDid)
        if (!prevDid && !nextDid) refreshAll = true
        break
      }
      case 'sessionSummary.remove': {
        const sid = String(op.sessionId || '').trim()
        const did = collectDirectoryFromSession(sid, context)
        if (did) {
          refreshDirectoryIds.add(did)
        } else {
          refreshAll = true
        }
        break
      }
    }
  }

  const refreshRecentIndex = refreshAll || refreshDirectoryIds.size > 0
  const refreshRunningIndex = refreshAll || refreshDirectoryIds.size > 0
  return {
    runtimeOnlyOps,
    refreshDirectoryIds: Array.from(refreshDirectoryIds),
    refreshAll,
    refreshRecentIndex,
    refreshRunningIndex,
    usedBackendHint: false,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function parseSidebarPatchRefreshHint(raw: JsonValue | undefined): SidebarPatchRefreshHint | null {
  const record = asRecord(raw)
  if (!record) return null
  const refreshAll = record.refreshAll === true
  const refreshRecentIndex = record.refreshRecentIndex === true
  const refreshRunningIndex = record.refreshRunningIndex === true
  const refreshDirectoryIds = Array.isArray(record.refreshDirectoryIds)
    ? record.refreshDirectoryIds.map((value) => String(value || '').trim()).filter(Boolean)
    : []
  if (!refreshAll && !refreshRecentIndex && !refreshRunningIndex && refreshDirectoryIds.length === 0) {
    return null
  }
  return {
    refreshAll,
    refreshDirectoryIds: Array.from(new Set(refreshDirectoryIds)),
    refreshRecentIndex,
    refreshRunningIndex,
  }
}

export function resolveSidebarPatchPlan(
  ops: ChatSidebarPatchOp[],
  context: SidebarPatchPlannerContext,
  hint: SidebarPatchRefreshHint | null,
): SidebarPatchPlannerResult {
  const runtimeOnlyOps = ops.filter((op) => op.type === 'sessionRuntime.upsert' || op.type === 'sessionRuntime.remove')
  if (hint) {
    return {
      runtimeOnlyOps,
      refreshDirectoryIds: hint.refreshDirectoryIds,
      refreshAll: hint.refreshAll,
      refreshRecentIndex: hint.refreshRecentIndex,
      refreshRunningIndex: hint.refreshRunningIndex,
      usedBackendHint: true,
    }
  }
  return planSidebarPatchOps(ops, context)
}

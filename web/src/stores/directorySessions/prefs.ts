import type { DirectoryEntry } from '@/features/sessions/model/types'
import type { SessionRuntimeSnapshot, SessionSummarySnapshot } from '@/data/directorySessionSnapshotDb'
import { defaultChatSidebarUiPrefs, patchChatSidebarUiPrefs, type ChatSidebarUiPrefs } from '@/data/chatSidebarUiPrefs'

type PrefValue = unknown
type PrefRecord = Record<string, PrefValue>

export type ChatSidebarPatchOp =
  | { type: 'directoryEntry.upsert'; entry: DirectoryEntry }
  | { type: 'directoryEntry.remove'; directoryId: string }
  | { type: 'sessionSummary.upsert'; session: SessionSummarySnapshot }
  | { type: 'sessionSummary.remove'; sessionId: string }
  | { type: 'sessionRuntime.upsert'; runtime: SessionRuntimeSnapshot }
  | { type: 'sessionRuntime.remove'; sessionId: string }

export type ChatSidebarPreferencesPatchOp = {
  type: 'preferences.replace'
  preferences: Partial<ChatSidebarUiPrefs>
}

function asRecord(value: PrefValue): PrefRecord | null {
  return value && typeof value === 'object' ? (value as PrefRecord) : null
}

export function parseChatSidebarPatchOps(raw: PrefValue): ChatSidebarPatchOp[] {
  if (!Array.isArray(raw)) return []
  const out: ChatSidebarPatchOp[] = []

  for (const item of raw) {
    const op = asRecord(item)
    if (!op) continue
    const ty = typeof op?.type === 'string' ? op.type.trim() : ''
    if (!ty) continue

    if (ty === 'directoryEntry.upsert') {
      if (op.entry && typeof op.entry === 'object') {
        out.push({ type: 'directoryEntry.upsert', entry: op.entry as DirectoryEntry })
      }
      continue
    }
    if (ty === 'directoryEntry.remove') {
      const directoryId = typeof op.directoryId === 'string' ? op.directoryId.trim() : ''
      if (directoryId) out.push({ type: 'directoryEntry.remove', directoryId })
      continue
    }
    if (ty === 'sessionSummary.upsert') {
      if (op.session && typeof op.session === 'object') {
        out.push({ type: 'sessionSummary.upsert', session: op.session as SessionSummarySnapshot })
      }
      continue
    }
    if (ty === 'sessionSummary.remove') {
      const sessionId = typeof op.sessionId === 'string' ? op.sessionId.trim() : ''
      if (sessionId) out.push({ type: 'sessionSummary.remove', sessionId })
      continue
    }
    if (ty === 'sessionRuntime.upsert') {
      if (op.runtime && typeof op.runtime === 'object') {
        out.push({ type: 'sessionRuntime.upsert', runtime: op.runtime as SessionRuntimeSnapshot })
      }
      continue
    }
    if (ty === 'sessionRuntime.remove') {
      const sessionId = typeof op.sessionId === 'string' ? op.sessionId.trim() : ''
      if (sessionId) out.push({ type: 'sessionRuntime.remove', sessionId })
      continue
    }
  }

  return out
}

export function parseChatSidebarPreferencesPatchOps(raw: PrefValue): ChatSidebarPreferencesPatchOp[] {
  if (!Array.isArray(raw)) return []
  const out: ChatSidebarPreferencesPatchOp[] = []
  for (const item of raw) {
    const op = asRecord(item)
    if (!op) continue
    const ty = typeof op?.type === 'string' ? op.type.trim() : ''
    if (ty !== 'preferences.replace') continue
    const preferences = op?.preferences
    if (!preferences || typeof preferences !== 'object') continue
    out.push({ type: 'preferences.replace', preferences: preferences as Partial<ChatSidebarUiPrefs> })
  }
  return out
}

export function normalizeUiPrefs(input: Partial<ChatSidebarUiPrefs> | null | undefined): ChatSidebarUiPrefs {
  return patchChatSidebarUiPrefs(defaultChatSidebarUiPrefs(), (input || {}) as Partial<ChatSidebarUiPrefs>)
}

function uiPrefsRecency(prefs: Partial<ChatSidebarUiPrefs> | null | undefined): { version: number; updatedAt: number } {
  const version =
    typeof prefs?.version === 'number' && Number.isFinite(prefs.version) ? Math.max(0, Math.floor(prefs.version)) : 0
  const updatedAt =
    typeof prefs?.updatedAt === 'number' && Number.isFinite(prefs.updatedAt)
      ? Math.max(0, Math.floor(prefs.updatedAt))
      : 0
  return { version, updatedAt }
}

export function compareUiPrefsRecency(
  left: Partial<ChatSidebarUiPrefs> | null | undefined,
  right: Partial<ChatSidebarUiPrefs> | null | undefined,
): number {
  const a = uiPrefsRecency(left)
  const b = uiPrefsRecency(right)
  if (a.version !== b.version) return a.version - b.version
  if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt
  return 0
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

export function uiPrefsBodyEquals(left: ChatSidebarUiPrefs, right: ChatSidebarUiPrefs): boolean {
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

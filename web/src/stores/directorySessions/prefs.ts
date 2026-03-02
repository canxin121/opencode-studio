import { defaultChatSidebarUiPrefs, patchChatSidebarUiPrefs, type ChatSidebarUiPrefs } from '@/data/chatSidebarUiPrefs'

type PrefValue = unknown
type PrefRecord = Record<string, PrefValue>

export type ChatSidebarPreferencesPatchOp = {
  type: 'preferences.replace'
  preferences: Partial<ChatSidebarUiPrefs>
}

function asRecord(value: PrefValue): PrefRecord | null {
  return value && typeof value === 'object' ? (value as PrefRecord) : null
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

import {
  defaultChatSidebarUiPrefs,
  patchChatSidebarUiPrefs,
  type ChatSidebarUiPrefs,
} from '../data/chatSidebarUiPrefs.ts'

function normalizeUiPrefs(input: Partial<ChatSidebarUiPrefs> | null | undefined): ChatSidebarUiPrefs {
  return patchChatSidebarUiPrefs(defaultChatSidebarUiPrefs(), (input || {}) as Partial<ChatSidebarUiPrefs>)
}

export function rebaseUiPrefsBodyOntoRemote(
  remoteRaw: Partial<ChatSidebarUiPrefs> | null | undefined,
  localRaw: Partial<ChatSidebarUiPrefs> | null | undefined,
): ChatSidebarUiPrefs {
  const remote = normalizeUiPrefs(remoteRaw)
  const local = normalizeUiPrefs(localRaw)
  return normalizeUiPrefs({
    ...remote,
    collapsedDirectoryIds: local.collapsedDirectoryIds,
    expandedParentSessionIds: local.expandedParentSessionIds,
    pinnedSessionIds: local.pinnedSessionIds,
    directoriesPage: local.directoriesPage,
    sessionRootPageByDirectoryId: local.sessionRootPageByDirectoryId,
    pinnedSessionsOpen: local.pinnedSessionsOpen,
    pinnedSessionsPage: local.pinnedSessionsPage,
    recentSessionsOpen: local.recentSessionsOpen,
    recentSessionsPage: local.recentSessionsPage,
    runningSessionsOpen: local.runningSessionsOpen,
    runningSessionsPage: local.runningSessionsPage,
    version: remote.version,
    updatedAt: Date.now(),
  })
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

// Rebase only the local delta (relative to base) on top of a newer remote.
// This avoids overwriting concurrent edits from another client.
export function rebaseUiPrefsDeltaOntoRemote(input: {
  base: Partial<ChatSidebarUiPrefs> | null | undefined
  local: Partial<ChatSidebarUiPrefs> | null | undefined
  remote: Partial<ChatSidebarUiPrefs> | null | undefined
}): ChatSidebarUiPrefs {
  const base = normalizeUiPrefs(input.base)
  const local = normalizeUiPrefs(input.local)
  const remote = normalizeUiPrefs(input.remote)

  const out: Partial<ChatSidebarUiPrefs> = {
    ...remote,
    version: remote.version,
    updatedAt: Date.now(),
  }

  if (!sameStringArray(base.collapsedDirectoryIds, local.collapsedDirectoryIds)) {
    out.collapsedDirectoryIds = local.collapsedDirectoryIds
  }
  if (!sameStringArray(base.expandedParentSessionIds, local.expandedParentSessionIds)) {
    out.expandedParentSessionIds = local.expandedParentSessionIds
  }
  if (!sameStringArray(base.pinnedSessionIds, local.pinnedSessionIds)) {
    out.pinnedSessionIds = local.pinnedSessionIds
  }
  if (base.directoriesPage !== local.directoriesPage) {
    out.directoriesPage = local.directoriesPage
  }
  if (!samePageMap(base.sessionRootPageByDirectoryId, local.sessionRootPageByDirectoryId)) {
    out.sessionRootPageByDirectoryId = local.sessionRootPageByDirectoryId
  }
  if (base.pinnedSessionsOpen !== local.pinnedSessionsOpen) {
    out.pinnedSessionsOpen = local.pinnedSessionsOpen
  }
  if (base.pinnedSessionsPage !== local.pinnedSessionsPage) {
    out.pinnedSessionsPage = local.pinnedSessionsPage
  }
  if (base.recentSessionsOpen !== local.recentSessionsOpen) {
    out.recentSessionsOpen = local.recentSessionsOpen
  }
  if (base.recentSessionsPage !== local.recentSessionsPage) {
    out.recentSessionsPage = local.recentSessionsPage
  }
  if (base.runningSessionsOpen !== local.runningSessionsOpen) {
    out.runningSessionsOpen = local.runningSessionsOpen
  }
  if (base.runningSessionsPage !== local.runningSessionsPage) {
    out.runningSessionsPage = local.runningSessionsPage
  }

  return normalizeUiPrefs(out)
}

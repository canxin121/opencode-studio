import type { JsonValue as JsonLike } from '@/types/json'

export type ChatSidebarUiPrefs = {
  version: number
  updatedAt: number
  collapsedDirectoryIds: string[]
  expandedParentSessionIds: string[]
  pinnedSessionIds: string[]
  directoriesPage: number
  sessionRootPageByDirectoryId: Record<string, number>
  pinnedSessionsOpen: boolean
  pinnedSessionsPage: number
  recentSessionsOpen: boolean
  recentSessionsPage: number
  runningSessionsOpen: boolean
  runningSessionsPage: number
}

type JsonObject = Record<string, JsonLike>

const STORAGE_KEY = 'oc2.chat.sidebarUiPrefs.v1'
const LEGACY_STORAGE_KEY = 'oc2.sessions.sidebarUiPrefs.v1'

const DEFAULT_UI_PREFS: ChatSidebarUiPrefs = {
  version: 0,
  updatedAt: 0,
  collapsedDirectoryIds: [],
  expandedParentSessionIds: [],
  pinnedSessionIds: [],
  directoriesPage: 0,
  sessionRootPageByDirectoryId: {},
  pinnedSessionsOpen: false,
  pinnedSessionsPage: 0,
  recentSessionsOpen: false,
  recentSessionsPage: 0,
  runningSessionsOpen: false,
  runningSessionsPage: 0,
}

function asObject(input: JsonLike): JsonObject | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  return input
}

function toStringArray(input: JsonLike): string[] {
  if (!Array.isArray(input)) return []
  return input.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
}

function toNonNegativeInt(input: JsonLike): number {
  const value = typeof input === 'number' && Number.isFinite(input) ? Math.floor(input) : 0
  return value >= 0 ? value : 0
}

function toPageMap(input: JsonLike): Record<string, number> {
  const map = asObject(input)
  if (!map) return {}
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(map)) {
    const id = key.trim()
    if (!id) continue
    const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0
    out[id] = n >= 0 ? n : 0
  }
  return out
}

export function defaultChatSidebarUiPrefs(): ChatSidebarUiPrefs {
  return {
    version: DEFAULT_UI_PREFS.version,
    updatedAt: DEFAULT_UI_PREFS.updatedAt,
    collapsedDirectoryIds: [...DEFAULT_UI_PREFS.collapsedDirectoryIds],
    expandedParentSessionIds: [...DEFAULT_UI_PREFS.expandedParentSessionIds],
    pinnedSessionIds: [...DEFAULT_UI_PREFS.pinnedSessionIds],
    directoriesPage: DEFAULT_UI_PREFS.directoriesPage,
    sessionRootPageByDirectoryId: { ...DEFAULT_UI_PREFS.sessionRootPageByDirectoryId },
    pinnedSessionsOpen: DEFAULT_UI_PREFS.pinnedSessionsOpen,
    pinnedSessionsPage: DEFAULT_UI_PREFS.pinnedSessionsPage,
    recentSessionsOpen: DEFAULT_UI_PREFS.recentSessionsOpen,
    recentSessionsPage: DEFAULT_UI_PREFS.recentSessionsPage,
    runningSessionsOpen: DEFAULT_UI_PREFS.runningSessionsOpen,
    runningSessionsPage: DEFAULT_UI_PREFS.runningSessionsPage,
  }
}

function readStorageRaw(): string | null {
  const next = localStorage.getItem(STORAGE_KEY)
  if (next) return next
  return localStorage.getItem(LEGACY_STORAGE_KEY)
}

export function loadChatSidebarUiPrefs(): ChatSidebarUiPrefs {
  try {
    const raw = readStorageRaw()
    if (!raw) return defaultChatSidebarUiPrefs()
    const parsed = asObject(JSON.parse(raw)) || {}
    const version = toNonNegativeInt(parsed.version)
    const updatedAt = toNonNegativeInt(parsed.updatedAt)
    const directoriesPage =
      typeof parsed.directoriesPage === 'number' && Number.isFinite(parsed.directoriesPage)
        ? Math.max(0, Math.floor(parsed.directoriesPage))
        : 0
    const runningSessionsPage =
      typeof parsed.runningSessionsPage === 'number' && Number.isFinite(parsed.runningSessionsPage)
        ? Math.max(0, Math.floor(parsed.runningSessionsPage))
        : 0
    const recentSessionsPage =
      typeof parsed.recentSessionsPage === 'number' && Number.isFinite(parsed.recentSessionsPage)
        ? Math.max(0, Math.floor(parsed.recentSessionsPage))
        : 0
    const pinnedSessionsPage =
      typeof parsed.pinnedSessionsPage === 'number' && Number.isFinite(parsed.pinnedSessionsPage)
        ? Math.max(0, Math.floor(parsed.pinnedSessionsPage))
        : 0
    return {
      version,
      updatedAt,
      collapsedDirectoryIds: toStringArray(parsed.collapsedDirectoryIds),
      expandedParentSessionIds: toStringArray(parsed.expandedParentSessionIds),
      pinnedSessionIds: toStringArray(parsed.pinnedSessionIds),
      directoriesPage,
      sessionRootPageByDirectoryId: toPageMap(parsed.sessionRootPageByDirectoryId),
      pinnedSessionsOpen: Boolean(parsed.pinnedSessionsOpen),
      pinnedSessionsPage,
      recentSessionsOpen: Boolean(parsed.recentSessionsOpen),
      recentSessionsPage,
      runningSessionsOpen: Boolean(parsed.runningSessionsOpen),
      runningSessionsPage,
    }
  } catch {
    return defaultChatSidebarUiPrefs()
  }
}

export function saveChatSidebarUiPrefs(next: ChatSidebarUiPrefs) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: toNonNegativeInt(next.version),
        updatedAt: toNonNegativeInt(next.updatedAt),
        collapsedDirectoryIds: toStringArray(next.collapsedDirectoryIds),
        expandedParentSessionIds: toStringArray(next.expandedParentSessionIds),
        pinnedSessionIds: toStringArray(next.pinnedSessionIds),
        directoriesPage:
          typeof next.directoriesPage === 'number' && Number.isFinite(next.directoriesPage)
            ? Math.max(0, Math.floor(next.directoriesPage))
            : 0,
        sessionRootPageByDirectoryId: toPageMap(next.sessionRootPageByDirectoryId),
        pinnedSessionsOpen: Boolean(next.pinnedSessionsOpen),
        pinnedSessionsPage:
          typeof next.pinnedSessionsPage === 'number' && Number.isFinite(next.pinnedSessionsPage)
            ? Math.max(0, Math.floor(next.pinnedSessionsPage))
            : 0,
        recentSessionsOpen: Boolean(next.recentSessionsOpen),
        recentSessionsPage:
          typeof next.recentSessionsPage === 'number' && Number.isFinite(next.recentSessionsPage)
            ? Math.max(0, Math.floor(next.recentSessionsPage))
            : 0,
        runningSessionsOpen: Boolean(next.runningSessionsOpen),
        runningSessionsPage:
          typeof next.runningSessionsPage === 'number' && Number.isFinite(next.runningSessionsPage)
            ? Math.max(0, Math.floor(next.runningSessionsPage))
            : 0,
      }),
    )
    // Best-effort cleanup after migration to the chat sidebar key.
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // ignore persistence errors
  }
}

export function patchChatSidebarUiPrefs(
  current: ChatSidebarUiPrefs,
  patch: Partial<ChatSidebarUiPrefs>,
): ChatSidebarUiPrefs {
  return {
    ...current,
    ...patch,
    version: patch.version === undefined ? current.version : toNonNegativeInt(patch.version),
    updatedAt: patch.updatedAt === undefined ? current.updatedAt : toNonNegativeInt(patch.updatedAt),
    collapsedDirectoryIds: patch.collapsedDirectoryIds ?? current.collapsedDirectoryIds,
    expandedParentSessionIds: patch.expandedParentSessionIds ?? current.expandedParentSessionIds,
    pinnedSessionIds: patch.pinnedSessionIds ?? current.pinnedSessionIds,
    sessionRootPageByDirectoryId: patch.sessionRootPageByDirectoryId ?? current.sessionRootPageByDirectoryId,
  }
}

// Backward-compatible aliases for in-progress naming migration.
export type SessionsSidebarUiPrefs = ChatSidebarUiPrefs
export const defaultSessionsSidebarUiPrefs = defaultChatSidebarUiPrefs
export const loadSessionsSidebarUiPrefs = loadChatSidebarUiPrefs
export const saveSessionsSidebarUiPrefs = saveChatSidebarUiPrefs
export const patchSessionsSidebarUiPrefs = patchChatSidebarUiPrefs

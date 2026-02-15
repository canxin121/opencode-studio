import type { ChatSidebarUiPrefs } from '@/data/chatSidebarUiPrefs'
import type { JsonValue } from '@/types/json'

export type SidebarUiPrefsForUi = {
  pinnedSessionIds: string[]
  collapsedDirectoryIds: string[]
  expandedParentSessionIds: string[]
  directoriesPage: number
  pinnedSessionsOpen: boolean
  pinnedSessionsPage: number
  recentSessionsOpen: boolean
  recentSessionsPage: number
  runningSessionsOpen: boolean
  runningSessionsPage: number
}

function toStringArrayUnique(input: JsonValue): string[] {
  const arr = Array.isArray(input) ? input : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of arr) {
    const s = typeof item === 'string' ? item.trim() : ''
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

function toNonNegativeInt(input: JsonValue): number {
  const n = typeof input === 'number' && Number.isFinite(input) ? Math.floor(input) : 0
  return n >= 0 ? n : 0
}

export function normalizeSidebarUiPrefsForUi(prefs: ChatSidebarUiPrefs | null | undefined): SidebarUiPrefsForUi {
  const p: Partial<ChatSidebarUiPrefs> = prefs && typeof prefs === 'object' ? prefs : {}
  return {
    pinnedSessionIds: toStringArrayUnique(p.pinnedSessionIds),
    collapsedDirectoryIds: toStringArrayUnique(p.collapsedDirectoryIds),
    expandedParentSessionIds: toStringArrayUnique(p.expandedParentSessionIds),
    directoriesPage: toNonNegativeInt(p.directoriesPage),
    pinnedSessionsOpen: Boolean(p.pinnedSessionsOpen),
    pinnedSessionsPage: toNonNegativeInt(p.pinnedSessionsPage),
    recentSessionsOpen: Boolean(p.recentSessionsOpen),
    recentSessionsPage: toNonNegativeInt(p.recentSessionsPage),
    runningSessionsOpen: Boolean(p.runningSessionsOpen),
    runningSessionsPage: toNonNegativeInt(p.runningSessionsPage),
  }
}

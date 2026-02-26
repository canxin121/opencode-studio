<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { RiAddLine, RiDeleteBinLine, RiRefreshLine, RiStarFill, RiStarLine } from '@remixicon/vue'

import RenameSessionDialog from '@/components/chat/RenameSessionDialog.vue'
import {
  autoLoadExpandedAlreadyAppliedThisLoad,
  markAutoLoadExpandedAppliedThisLoad,
} from '@/layout/chatSidebar/useChatSidebarPersistedState'
import { patchSessionIdInQuery } from '@/app/navigation/sessionQuery'
import { useChatStore } from '@/stores/chat'
import * as chatApi from '@/stores/chat/api'
import { useSessionActivityStore } from '@/stores/sessionActivity'
import { useSettingsStore } from '@/stores/settings'
import { useToastsStore } from '@/stores/toasts'
import { useUiStore } from '@/stores/ui'
import { useDirectoryStore } from '@/stores/directory'
import { useDirectorySessionStore } from '@/stores/directorySessionStore'

import AddDirectoryDialog from '@/layout/chatSidebar/components/AddDirectoryDialog.vue'
import ChatSidebarHeader from '@/layout/chatSidebar/components/ChatSidebarHeader.vue'
import DirectoriesList from '@/layout/chatSidebar/components/DirectoriesList.vue'
import PinnedSessionsFooter from '@/layout/chatSidebar/components/PinnedSessionsFooter.vue'
import RecentSessionsFooter from '@/layout/chatSidebar/components/RecentSessionsFooter.vue'
import RunningSessionsFooter from '@/layout/chatSidebar/components/RunningSessionsFooter.vue'
import OptionMenu from '@/components/ui/OptionMenu.vue'
import type { OptionMenuGroup, OptionMenuItem } from '@/components/ui/optionMenu.types'
import {
  buildSessionActionItemsForSessionI18n,
  useSessionActionMenu,
  type SessionActionItem,
} from '@/layout/chatSidebar/useSessionActionMenu'
import type { DirectoryEntry } from '@/features/sessions/model/types'
import { buildFlattenedTree, type FlatTreeRow } from '@/features/sessions/model/tree'
import { useSidebarLocate } from '@/layout/chatSidebar/useSidebarLocate'
import { normalizeDirectories } from '@/features/sessions/model/projects'
import { normalizeSidebarUiPrefsForUi } from '@/features/sessions/model/sidebarUiPrefs'
import { DIRECTORIES_PAGE_SIZE_DEFAULT } from '@/stores/directorySessions/index'
import { ApiError } from '@/lib/api'

const props = defineProps<{ mobileVariant?: boolean }>()

const route = useRoute()
const router = useRouter()

const ui = useUiStore()
const chat = useChatStore()
const settings = useSettingsStore()
const toasts = useToastsStore()
const activity = useSessionActivityStore()
const directoryStore = useDirectoryStore()
const directorySessions = useDirectorySessionStore()
const { t } = useI18n()

const lastSidebarErrorToastByKey = new Map<string, { at: number; message: string }>()

function pushSidebarErrorToast(key: string, message: string, timeoutMs = 4500, dedupeWindowMs = 4500) {
  const k = (key || '').trim() || '__sidebar__'
  const msg = String(message || '').trim()
  if (!msg) return

  const now = Date.now()
  const prev = lastSidebarErrorToastByKey.get(k)
  if (prev && prev.message === msg && now - prev.at < Math.max(0, Math.floor(dedupeWindowMs))) return
  lastSidebarErrorToastByKey.set(k, { at: now, message: msg })
  toasts.push('error', msg, timeoutMs)
}

function isUiAuthRequiredError(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.status === 401 && (err.code || '').trim().toLowerCase() === 'auth_required'
  }
  const msg = err instanceof Error ? err.message : String(err)
  return msg.trim().toLowerCase() === 'ui authentication required'
}

function isUiAuthRequiredMessage(message: string): boolean {
  return (
    String(message || '')
      .trim()
      .toLowerCase() === 'ui authentication required'
  )
}

function toIdSet(input: string[]): Set<string> {
  return new Set(input.map((v) => String(v || '').trim()).filter(Boolean))
}

let suppressUiPrefsPatch = false

function applyUiPrefsToLocal(prefsRaw: Parameters<typeof normalizeSidebarUiPrefsForUi>[0]) {
  const prefs = normalizeSidebarUiPrefsForUi(prefsRaw)
  pinnedSessionIds.value = prefs.pinnedSessionIds.slice()
  collapsedDirectories.value = toIdSet(prefs.collapsedDirectoryIds)
  expandedParents.value = toIdSet(prefs.expandedParentSessionIds)
  runningSessionsOpen.value = prefs.runningSessionsOpen
  runningSessionsPage.value = prefs.runningSessionsPage
  recentSessionsOpen.value = prefs.recentSessionsOpen
  recentSessionsPage.value = prefs.recentSessionsPage
  pinnedSessionsOpen.value = prefs.pinnedSessionsOpen
  pinnedSessionsPage.value = prefs.pinnedSessionsPage
  directoryPage.value = prefs.directoriesPage
}

const initialPrefs = normalizeSidebarUiPrefsForUi(directorySessions.uiPrefs)

const pinnedSessionIds = ref<string[]>(initialPrefs.pinnedSessionIds.slice())
const collapsedDirectories = ref<Set<string>>(toIdSet(initialPrefs.collapsedDirectoryIds))
const expandedParents = ref<Set<string>>(toIdSet(initialPrefs.expandedParentSessionIds))
const runningSessionsOpen = ref(Boolean(initialPrefs.runningSessionsOpen))
const runningSessionsPage = ref(initialPrefs.runningSessionsPage)
const runningSessionsPaging = ref(false)
const recentSessionsOpen = ref(Boolean(initialPrefs.recentSessionsOpen))
const recentSessionsPage = ref(initialPrefs.recentSessionsPage)
const recentSessionsPaging = ref(false)
const pinnedSessionsOpen = ref(Boolean(initialPrefs.pinnedSessionsOpen))
const pinnedSessionsPage = ref(initialPrefs.pinnedSessionsPage)
const pinnedSessionsPaging = ref(false)
const directoryPage = ref(initialPrefs.directoriesPage)
const directoryPaging = ref(false)

// Directory entry type lives in '@/features/sessions/model/types'.

const settingsDirectories = computed<DirectoryEntry[]>(() => {
  return normalizeDirectories(settings.data?.directories ?? settings.data?.projects)
})

const directories = computed<DirectoryEntry[]>(() => {
  const base = directorySessions.visibleDirectories
  const overlays = settings.data ? settingsDirectories.value : []
  if (!settings.data || overlays.length === 0) return base

  const labelById = new Map<string, string>()
  for (const entry of overlays) {
    const id = String(entry?.id || '').trim()
    const label = typeof entry?.label === 'string' ? entry.label.trim() : ''
    if (id && label) labelById.set(id, label)
  }

  return base.map((entry) => {
    const id = String(entry?.id || '').trim()
    const label = id ? labelById.get(id) : undefined
    if (!label) return entry
    if (entry.label === label) return entry
    return { ...entry, label }
  })
})
watch(
  () => ({ loaded: Boolean(settings.data), list: settingsDirectories.value }),
  (state) => {
    if (state.loaded) {
      directorySessions.setDirectoryEntries(state.list)
    }
  },
  { immediate: true },
)

// Paging (sidebar can contain many directories/sessions).
const DIRECTORIES_PAGE_SIZE = DIRECTORIES_PAGE_SIZE_DEFAULT
const SESSION_ROOTS_PAGE_SIZE = 10

// Search/filter (user-driven only).
const sidebarQuery = ref('')
const sidebarQueryNorm = computed(() => sidebarQuery.value.trim().toLowerCase())

// Bottom footer: a compact view of currently active/blocked sessions.
// This uses best-effort metadata (loaded sessions) but counts from live status/activity.
const RUNNING_SESSIONS_PAGE_SIZE = 10
const PINNED_SESSIONS_PAGE_SIZE = 10
const RECENT_SESSIONS_PAGE_SIZE = 10

watch(
  () => ({
    collapsedDirectoryIds: Array.from(collapsedDirectories.value),
    expandedParentSessionIds: Array.from(expandedParents.value),
    pinnedSessionIds: pinnedSessionIds.value.slice(),
    directoriesPage: directoryPage.value,
    pinnedSessionsOpen: pinnedSessionsOpen.value,
    pinnedSessionsPage: pinnedSessionsPage.value,
    recentSessionsOpen: recentSessionsOpen.value,
    recentSessionsPage: recentSessionsPage.value,
    runningSessionsOpen: runningSessionsOpen.value,
    runningSessionsPage: runningSessionsPage.value,
  }),
  (next) => {
    if (suppressUiPrefsPatch) return
    directorySessions.patchUiPrefs(next)
  },
  { deep: true, immediate: true },
)

watch(
  () => directorySessions.uiPrefs,
  (next) => {
    suppressUiPrefsPatch = true
    try {
      applyUiPrefsToLocal(next)
    } finally {
      suppressUiPrefsPatch = false
    }
  },
  { deep: true },
)

const {
  sessionActionMenuAnchorRef,
  sessionActionMenuQuery,
  sessionActionMenuTarget,
  filteredSessionActionItems,
  openSessionActionMenu,
  runSessionActionMenu: runSessionActionMenuBase,
  setSessionActionMenuRef,
} = useSessionActionMenu({ chat, ui, selectSession })
type SessionDialogActionItem = SessionActionItem &
  Pick<OptionMenuItem, 'variant' | 'confirmTitle' | 'confirmDescription' | 'confirmText' | 'cancelText'>
type DirectoryDialogActionItem = OptionMenuItem
type SessionValue = unknown
type SessionRecord = Record<string, SessionValue>
type SessionLike = {
  id: string
  title?: string
  slug?: string
  directory?: string
  time?: { updated?: number | null } | null
  [k: string]: SessionValue
}

function asRecord(value: SessionValue): SessionRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as SessionRecord
}

function readSessionId(value: SessionValue): string {
  const raw = asRecord(value)?.id
  return typeof raw === 'string' ? raw.trim() : ''
}

function readSessionDirectory(value: SessionValue): string {
  const raw = asRecord(value)?.directory
  return typeof raw === 'string' ? raw.trim() : ''
}

function readSessionUpdatedAt(value: SessionValue): number {
  const time = asRecord(value)?.time
  const raw = asRecord(time)?.updated
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

function isAbortError(err: SessionValue): boolean {
  if (err instanceof DOMException) return err.name === 'AbortError'
  const name = asRecord(err)?.name
  return name === 'AbortError'
}

// Session action menu logic extracted to '@/layout/chatSidebar/useSessionActionMenu'.

// Common string/label helpers extracted to '@/features/sessions/model/labels'.

const pagedDirectories = computed<DirectoryEntry[]>(() => {
  return directorySessions.directoryPageRows || []
})

const directoryPageTotal = computed<number>(() => {
  const value = Number(directorySessions.directoryPageTotal || 0)
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
})

const visibleDirectories = computed<DirectoryEntry[]>(() => {
  return pagedDirectories.value
})

const directoryPageCount = computed(() => {
  return Math.max(
    1,
    Math.ceil(Math.max(directoryPageTotal.value, pagedDirectories.value.length) / DIRECTORIES_PAGE_SIZE),
  )
})

const directoryPageLoading = computed<boolean>(() => {
  return Boolean(directorySessions.directoryPageLoading)
})

let directoryPageFetchTimer: number | null = null
let skipDirectoryPageWatchOnce = false

function scheduleDirectoryPageFetch(delayMs = 0) {
  if (directoryPageFetchTimer !== null) {
    window.clearTimeout(directoryPageFetchTimer)
    directoryPageFetchTimer = null
  }
  directoryPageFetchTimer = window.setTimeout(
    () => {
      directoryPageFetchTimer = null
      const page = Math.max(0, Math.floor(directoryPage.value || 0))
      void directorySessions
        .loadDirectoryPage({ page, pageSize: DIRECTORIES_PAGE_SIZE, query: sidebarQueryNorm.value })
        .then((result) => {
          const resolvedPage =
            typeof result?.page === 'number' && Number.isFinite(result.page) ? Math.floor(result.page) : page
          if (resolvedPage !== directoryPage.value) {
            skipDirectoryPageWatchOnce = true
            directoryPage.value = resolvedPage
          }
        })
        .catch(() => {
          // keep current directory page data when paging fetch fails
        })
    },
    Math.max(0, Math.floor(delayMs)),
  )
}

async function requestDirectoryPage(nextPage: number) {
  if (directoryPaging.value) return
  const maxPage = Math.max(0, directoryPageCount.value - 1)
  const target = Math.max(0, Math.min(maxPage, Math.floor(nextPage || 0)))
  if (target === directoryPage.value) return

  directoryPaging.value = true
  try {
    const result = await directorySessions.loadDirectoryPage({
      page: target,
      pageSize: DIRECTORIES_PAGE_SIZE,
      query: sidebarQueryNorm.value,
    })
    const resolvedPage =
      typeof result?.page === 'number' && Number.isFinite(result.page) ? Math.floor(result.page) : target
    if (resolvedPage !== directoryPage.value) {
      skipDirectoryPageWatchOnce = true
      directoryPage.value = resolvedPage
    }
  } catch {
    // keep current directory page data when paging fetch fails
  } finally {
    directoryPaging.value = false
  }
}

watch(
  () => sidebarQueryNorm.value,
  (next, prev) => {
    if (next !== prev && directoryPage.value !== 0) {
      directoryPage.value = 0
      return
    }
    scheduleDirectoryPageFetch(next ? 180 : 0)
  },
)

watch(
  () => directoryPage.value,
  () => {
    if (skipDirectoryPageWatchOnce) {
      skipDirectoryPageWatchOnce = false
      return
    }
    scheduleDirectoryPageFetch(0)
  },
)

watch(
  () => directories.value.map((entry) => `${entry.id}:${entry.path}`).join('|'),
  () => {
    scheduleDirectoryPageFetch(0)
  },
  { immediate: true },
)

function isDirectoryCollapsed(directoryId: string): boolean {
  const pid = (directoryId || '').trim()
  return collapsedDirectories.value.has(pid)
}

function dismissDeepLinkFocus() {
  // No-op: sidebar expansion/paging is only changed by explicit user actions.
}

// Session creation can be slow; prevent duplicate creates from rapid clicks.
const creatingSession = ref(false)

const isAddDirectoryOpen = ref(false)
const newDirectoryPath = ref('')

// Mobile: keep the list clean; show actions in a compact dialog.
const directoryActionsOpen = ref(false)
const directoryActionsTarget = ref<DirectoryEntry | null>(null)
const directoryActionsDialogQuery = ref('')
const directoryActionsDialogItems = computed<DirectoryDialogActionItem[]>(() => {
  const base: DirectoryDialogActionItem[] = [
    {
      id: 'refresh',
      label: String(t('chat.sidebar.directoryActions.refresh.label')),
      description: String(t('chat.sidebar.directoryActions.refresh.description')),
      icon: RiRefreshLine,
    },
    {
      id: 'new-session',
      label: String(t('chat.sidebar.directoryActions.newSession.label')),
      description: String(t('chat.sidebar.directoryActions.newSession.description')),
      icon: RiAddLine,
      disabled: creatingSession.value,
    },
    {
      id: 'remove',
      label: String(t('chat.sidebar.directoryActions.remove.label')),
      description: String(t('chat.sidebar.directoryActions.remove.description')),
      icon: RiDeleteBinLine,
      variant: 'destructive',
      confirmTitle: String(t('chat.sidebar.directoryActions.remove.confirmTitle')),
      confirmDescription: String(t('chat.sidebar.directoryActions.remove.confirmDescription')),
      confirmText: String(t('common.remove')),
      cancelText: String(t('common.cancel')),
    },
  ]
  return base
})

const filteredDirectoryActionsDialogItems = computed<DirectoryDialogActionItem[]>(() => {
  const q = directoryActionsDialogQuery.value.trim().toLowerCase()
  const list = directoryActionsDialogItems.value
  if (!q) return list
  return list.filter((item) => {
    const label = item.label.toLowerCase()
    const desc = String(item.description || '').toLowerCase()
    return label.includes(q) || desc.includes(q) || item.id.includes(q)
  })
})
const sessionActionsOpen = ref(false)
const sessionActionsTarget = ref<{ directory: DirectoryEntry; session: SessionLike } | null>(null)
const sessionActionsDialogQuery = ref('')

const renameDialogOpen = ref(false)
const renameBusy = ref(false)
const renameDraft = ref('')
const renameTargetSessionId = ref('')

function resetRenameState() {
  renameDialogOpen.value = false
  renameBusy.value = false
  renameDraft.value = ''
  renameTargetSessionId.value = ''
}

function beginRenameForSession(session: SessionLike, mode: 'dialog' | 'inline') {
  const sid = readSessionId(session)
  if (!sid) return
  const title = typeof session?.title === 'string' ? session.title.trim() : ''
  const slug = typeof session?.slug === 'string' ? session.slug.trim() : ''
  renameTargetSessionId.value = sid
  renameDraft.value = title || slug || sid
  renameBusy.value = false
  renameDialogOpen.value = mode === 'dialog'
}

function isRenamingSession(sessionId: string): boolean {
  const sid = String(sessionId || '').trim()
  if (!sid) return false
  if (props.mobileVariant) return false
  return !renameDialogOpen.value && sid === renameTargetSessionId.value.trim()
}

function updateRenameDraft(next: string) {
  renameDraft.value = String(next || '')
}

function closeDesktopSessionActionMenu() {
  sessionActionMenuTarget.value = null
  sessionActionMenuAnchorRef.value = null
  sessionActionMenuQuery.value = ''
}

// Defensive: if a dialog stacks under the scroll container on some mobile browsers,
// disable pointer events on the sidebar content so taps can't "fall through".
const isSidebarDialogOpen = computed(() =>
  Boolean(isAddDirectoryOpen.value || directoryActionsOpen.value || sessionActionsOpen.value || renameDialogOpen.value),
)
const sessionActionsDialogItems = computed<SessionDialogActionItem[]>(() => {
  const target = sessionActionsTarget.value
  const isPinned = Boolean(target?.session?.id && pinnedSessionIds.value.includes(target.session.id))
  const base: SessionDialogActionItem[] = [
    {
      id: 'toggle-pin',
      label: isPinned
        ? String(t('chat.sidebar.sessionActions.unpin.label'))
        : String(t('chat.sidebar.sessionActions.pin.label')),
      description: isPinned
        ? String(t('chat.sidebar.sessionActions.unpin.description'))
        : String(t('chat.sidebar.sessionActions.pin.description')),
      icon: isPinned ? RiStarFill : RiStarLine,
    },
    {
      id: 'delete',
      label: String(t('chat.sidebar.sessionActions.delete.label')),
      description: String(t('chat.sidebar.sessionActions.delete.description')),
      icon: RiDeleteBinLine,
      variant: 'destructive',
      confirmTitle: String(t('chat.sidebar.sessionActions.delete.confirmTitle')),
      confirmDescription: String(t('chat.sidebar.sessionActions.delete.confirmDescription')),
      confirmText: String(t('chat.sidebar.sessionActions.delete.confirmText')),
      cancelText: String(t('common.cancel')),
    },
  ]
  return [...base, ...buildSessionActionItemsForSessionI18n(t, target?.session)]
})

const filteredSessionActionsDialogItems = computed<SessionDialogActionItem[]>(() => {
  const q = sessionActionsDialogQuery.value.trim().toLowerCase()
  const list = sessionActionsDialogItems.value
  if (!q) return list
  return list.filter((item) => {
    const label = item.label.toLowerCase()
    const desc = String(item.description || '').toLowerCase()
    return label.includes(q) || desc.includes(q) || item.id.includes(q)
  })
})

const directoryActionMenuGroups = computed<OptionMenuGroup[]>(() => [
  {
    id: 'directory-actions',
    items: filteredDirectoryActionsDialogItems.value as OptionMenuItem[],
  },
])

const sessionActionMenuGroups = computed<OptionMenuGroup[]>(() => [
  {
    id: 'session-actions',
    items: filteredSessionActionsDialogItems.value as OptionMenuItem[],
  },
])

function openDirectoryActions(p: DirectoryEntry) {
  directoryActionsTarget.value = p
  directoryActionsDialogQuery.value = ''
  directoryActionsOpen.value = true
}

// Desktop: show inline action buttons on hover (Session-style).
async function refreshDirectoryInline(p: DirectoryEntry) {
  await ensureDirectoryAggregateLoaded(p.id, p.path, { force: true })
}

async function refreshVisibleDirectories() {
  for (const p of pagedDirectories.value) {
    await ensureDirectoryAggregateLoaded(p.id, p.path, { force: true })
  }
}

async function handleSidebarRefresh() {
  await settings.refresh()
  if (settings.error && !isUiAuthRequiredMessage(settings.error)) {
    pushSidebarErrorToast('sidebar:settings', settings.error, 4500, 8000)
  }

  await refreshVisibleDirectories()
  await chat.refreshSessions()
}

async function newSessionInline(p: DirectoryEntry) {
  await createSessionInDirectory(p.id, p.path)
}

async function removeDirectoryInline(p: DirectoryEntry) {
  await removeDirectoryEntry(p.id)
}

function openSessionActions(directory: DirectoryEntry, session: SessionLike) {
  sessionActionsTarget.value = { directory, session }
  sessionActionsDialogQuery.value = ''
  sessionActionsOpen.value = true
}

async function directoryActionRefresh() {
  const p = directoryActionsTarget.value
  if (!p) return
  await ensureDirectoryAggregateLoaded(p.id, p.path, { force: true })
  directoryActionsOpen.value = false
}

async function directoryActionNewSession() {
  const p = directoryActionsTarget.value
  if (!p) return
  await createSessionInDirectory(p.id, p.path)
  directoryActionsOpen.value = false
}

async function directoryActionRemove() {
  const p = directoryActionsTarget.value
  if (!p) return
  await removeDirectoryEntry(p.id)
  directoryActionsOpen.value = false
}

async function runDirectoryDialogAction(item: DirectoryDialogActionItem) {
  if (item.disabled) return
  if (item.id === 'refresh') {
    await directoryActionRefresh()
    return
  }
  if (item.id === 'new-session') {
    await directoryActionNewSession()
    return
  }
  if (item.id === 'remove') {
    await directoryActionRemove()
    return
  }
}

async function sessionActionOpen() {
  const t = sessionActionsTarget.value
  if (!t) return
  await selectDirectory(t.directory.id, t.directory.path)
  await selectSession(t.session.id)
  sessionActionsOpen.value = false
}

function sessionActionTogglePin() {
  const t = sessionActionsTarget.value
  if (!t) return
  togglePin(t.session.id)
  sessionActionsOpen.value = false
}

async function sessionActionDelete() {
  const t = sessionActionsTarget.value
  if (!t) return
  await deleteSession(t.session.id)
  sessionActionsOpen.value = false
}

function openRenameDialogForSession(session: SessionLike) {
  beginRenameForSession(session, 'dialog')
}

function openInlineRenameForSession(session: SessionLike) {
  beginRenameForSession(session, 'inline')
}

function cancelRenameFromSidebar() {
  resetRenameState()
}

async function saveRenameFromSidebar() {
  const sid = renameTargetSessionId.value.trim()
  const next = renameDraft.value.trim()
  if (!sid) return
  if (!next) {
    toasts.push('error', t('chat.toasts.titleCannotBeEmpty'))
    return
  }
  renameBusy.value = true
  try {
    await chat.renameSession(sid, next)
    resetRenameState()
    toasts.push('success', t('chat.toasts.sessionRenamed'))
  } catch (err) {
    toasts.push('error', err instanceof Error ? err.message : String(err))
  } finally {
    renameBusy.value = false
  }
}

async function runSessionActionMenu(item: SessionActionItem) {
  if (item.disabled) return
  const target = sessionActionMenuTarget.value
  if (!target) return
  if (!props.mobileVariant && item.id === 'rename') {
    closeDesktopSessionActionMenu()
    openInlineRenameForSession(target.session)
    return
  }
  await runSessionActionMenuBase(item)
}

async function runSessionDialogAction(item: SessionDialogActionItem) {
  if (item.disabled) return
  if (item.id === 'open') {
    await sessionActionOpen()
    return
  }
  if (item.id === 'toggle-pin') {
    sessionActionTogglePin()
    return
  }
  if (item.id === 'delete') {
    await sessionActionDelete()
    return
  }

  // Mobile session switcher: keep the sidebar open for rename.
  // ChatPage is unmounted while the switcher is open.
  if (props.mobileVariant && item.id === 'rename') {
    const t = sessionActionsTarget.value
    if (!t) return
    sessionActionsOpen.value = false
    openRenameDialogForSession(t.session)
    return
  }

  const t = sessionActionsTarget.value
  if (!t) return
  sessionActionsOpen.value = false
  await selectDirectory(t.directory.id, t.directory.path)
  if (t.session?.id && t.session.id !== chat.selectedSessionId) {
    await selectSession(t.session.id)
  }
  ui.requestSessionAction(item.id)
}

watch(
  () => isAddDirectoryOpen.value,
  (open) => {
    if (open) {
      // Start fresh so suggestions aren't filtered by an old prefix (e.g. ".").
      newDirectoryPath.value = ''
    }
  },
)

// Persisted UI state is owned by directorySessionStore.uiPrefs.

function togglePin(id: string) {
  const idx = pinnedSessionIds.value.indexOf(id)
  if (idx >= 0) pinnedSessionIds.value.splice(idx, 1)
  else pinnedSessionIds.value.unshift(id)
}

const aggregateLoadingByDirectoryId = computed<Record<string, boolean>>(() => {
  return directorySessions.aggregateLoadingByDirectoryId || {}
})
const aggregateAttemptedByDirectoryId = computed<Record<string, boolean>>(() => {
  return directorySessions.aggregateAttemptedByDirectoryId || {}
})
const worktreesByDirectoryId = computed<Record<string, string[]>>(() => {
  return directorySessions.worktreePathsByDirectoryId || {}
})
const sessionsLoading = computed(() => {
  if (chat.sessionsLoading) return true
  if (directoryPageLoading.value) return true
  return Object.values(aggregateLoadingByDirectoryId.value).some(Boolean)
})

function hasCachedSessionsForDirectory(directoryId: string): boolean {
  return directorySessions.hasCachedSessionsForDirectory(directoryId)
}

function toggleDirectoryCollapse(directoryId: string, directoryPath: string) {
  dismissDeepLinkFocus()
  const pid = (directoryId || '').trim()
  const next = new Set(collapsedDirectories.value)
  const wasCollapsed = next.has(pid)
  if (wasCollapsed) next.delete(pid)
  else next.add(pid)
  collapsedDirectories.value = next

  // Auto-load sessions when expanding a directory.
  if (wasCollapsed) {
    void ensureDirectoryAggregateLoaded(directoryId, directoryPath)
  }
}

function hasAttention(sessionId: string): 'permission' | 'question' | null {
  const sid = (sessionId || '').trim()
  const runtime = directorySessions.runtimeBySessionId?.[sid]
  const value = runtime?.attention
  return value === 'permission' || value === 'question' ? value : null
}

function isSessionActiveOrBlocked(sessionId: string): boolean {
  return directorySessions.isSessionRuntimeActive(sessionId, { includeCooldown: true })
}

type RunningSessionItem = {
  id: string
  session: SessionLike | null
  directory: DirectoryEntry | null
  updatedAt: number
  statusType: string
  attention: 'permission' | 'question' | null
}

type RecentSessionItem = {
  id: string
  session: SessionLike
  directory: DirectoryEntry
  updatedAt: number
}

type PinnedSessionItem = {
  id: string
  session: SessionLike
  directory: DirectoryEntry
  updatedAt: number
}

type ThreadRootItem = {
  id: string
  session: SessionLike | null
  directory: DirectoryEntry | null
}

type ThreadSessionRow = ThreadRootItem & {
  renderKey: string
  depth: number
  isParent: boolean
  isExpanded: boolean
}

function childSessionIds(parentId: string): string[] {
  const pid = (parentId || '').trim()
  if (!pid) return []
  const raw = directorySessions.childrenByParentSessionId?.[pid] || []
  const seen = new Set<string>()
  const out: string[] = []
  for (const childId of raw) {
    const sid = String(childId || '').trim()
    if (!sid || seen.has(sid)) continue
    seen.add(sid)
    out.push(sid)
  }
  return out
}

function resolveThreadNode(sessionId: string, fallbackDirectory: DirectoryEntry | null): ThreadRootItem {
  const sid = (sessionId || '').trim()
  if (!sid) {
    return {
      id: '',
      session: null,
      directory: fallbackDirectory,
    }
  }

  const indexed = directorySessions.allSessionIndexById?.[sid] || null
  const session = (indexed?.session as SessionLike | null) || (chat.getSessionById(sid) as SessionLike | null) || null
  const sessionDirectoryPath = readSessionDirectory(session)
  const sessionDirectory = sessionDirectoryPath
    ? directories.value.find((entry) => (entry.path || '').trim() === sessionDirectoryPath) || null
    : null

  return {
    id: sid,
    session,
    directory: indexed?.directory || sessionDirectory || fallbackDirectory || null,
  }
}

function buildThreadRowsFromRoots(roots: ThreadRootItem[]): ThreadSessionRow[] {
  const rows: ThreadSessionRow[] = []

  const append = (node: ThreadRootItem, depth: number, ancestry: Set<string>, keyPrefix: string) => {
    const sid = (node.id || '').trim()
    if (!sid) return

    const renderKey = keyPrefix ? `${keyPrefix}>${sid}` : sid

    const children = childSessionIds(sid)
    const isParent = children.length > 0
    const isExpanded = isParent && expandedParents.value.has(sid)

    rows.push({
      id: sid,
      session: node.session,
      directory: node.directory,
      renderKey,
      depth,
      isParent,
      isExpanded,
    })

    if (!isExpanded) return

    const nextAncestry = new Set(ancestry)
    nextAncestry.add(sid)

    for (const childId of children) {
      if (nextAncestry.has(childId)) continue
      const childNode = resolveThreadNode(childId, node.directory)
      if (!childNode.session) continue
      append(childNode, depth + 1, nextAncestry, renderKey)
    }
  }

  for (const root of roots) {
    const rootNode = resolveThreadNode(root.id, root.directory)
    const sid = (rootNode.id || '').trim()
    if (!sid) continue
    append(
      {
        id: sid,
        session: root.session || rootNode.session,
        directory: root.directory || rootNode.directory,
      },
      0,
      new Set(),
      '',
    )
  }

  return rows
}

const pinnedSessions = computed<PinnedSessionItem[]>(() => {
  const out: PinnedSessionItem[] = []
  const seen = new Set<string>()
  const indexedById = directorySessions.allSessionIndexById || {}

  for (const rawId of pinnedSessionIds.value) {
    const sid = String(rawId || '').trim()
    if (!sid || seen.has(sid)) continue
    seen.add(sid)

    const indexed = indexedById[sid] || null
    const session = indexed?.session || chat.getSessionById(sid) || null
    const directory = (indexed?.directory as DirectoryEntry | null) || null
    if (!session || !directory) continue

    out.push({
      id: sid,
      session,
      directory,
      updatedAt: readSessionUpdatedAt(session),
    })
  }

  return out
})

const pinnedSessionsPageCount = computed(() => {
  const total = pinnedSessions.value.length
  return Math.max(1, Math.ceil(total / PINNED_SESSIONS_PAGE_SIZE))
})

watch(
  () => [pinnedSessions.value.length, pinnedSessionsPageCount.value] as const,
  () => {
    const maxPage = Math.max(0, pinnedSessionsPageCount.value - 1)
    if (pinnedSessionsPage.value > maxPage) pinnedSessionsPage.value = maxPage
    if (pinnedSessionsPage.value < 0) pinnedSessionsPage.value = 0
  },
  { immediate: true },
)

const pagedPinnedSessions = computed(() => {
  const page = Math.max(0, Math.min(pinnedSessionsPageCount.value - 1, Math.floor(pinnedSessionsPage.value || 0)))
  const start = page * PINNED_SESSIONS_PAGE_SIZE
  return pinnedSessions.value.slice(start, start + PINNED_SESSIONS_PAGE_SIZE)
})

const pagedPinnedSessionRows = computed<ThreadSessionRow[]>(() => {
  const roots: ThreadRootItem[] = pagedPinnedSessions.value.map((item) => ({
    id: item.id,
    session: item.session,
    directory: item.directory,
  }))
  return buildThreadRowsFromRoots(roots)
})

async function requestPinnedSessionsPage(nextPage: number) {
  if (pinnedSessionsPaging.value) return
  const maxPage = Math.max(0, pinnedSessionsPageCount.value - 1)
  const target = Math.max(0, Math.min(maxPage, Math.floor(nextPage || 0)))
  if (target === pinnedSessionsPage.value) return

  pinnedSessionsPaging.value = true
  try {
    const start = target * PINNED_SESSIONS_PAGE_SIZE
    const ids = pinnedSessionIds.value.slice(start, start + PINNED_SESSIONS_PAGE_SIZE)
    await directorySessions.ensurePinnedSessionRowsLoaded(ids)
    pinnedSessionsPage.value = target
  } finally {
    pinnedSessionsPaging.value = false
  }
}

const recentSessions = computed<RecentSessionItem[]>(() => {
  return (directorySessions.recentSidebarRows || []).map((row) => ({
    id: row.id,
    session: row.session,
    directory: row.directory,
    updatedAt: row.updatedAt,
  }))
})

const recentSessionsPageCount = computed(() => {
  const total = Math.max(Number(directorySessions.recentIndexTotal || 0), recentSessions.value.length)
  return Math.max(1, Math.ceil(total / RECENT_SESSIONS_PAGE_SIZE))
})

const recentSessionsTotal = computed(() => {
  return Math.max(Number(directorySessions.recentIndexTotal || 0), recentSessions.value.length)
})

watch(
  () => [recentSessions.value.length, recentSessionsPageCount.value] as const,
  () => {
    const maxPage = Math.max(0, recentSessionsPageCount.value - 1)
    if (recentSessionsPage.value > maxPage) recentSessionsPage.value = maxPage
    if (recentSessionsPage.value < 0) recentSessionsPage.value = 0
  },
  { immediate: true },
)

const pagedRecentSessions = computed(() => {
  const page = Math.max(0, Math.min(recentSessionsPageCount.value - 1, Math.floor(recentSessionsPage.value || 0)))
  const start = page * RECENT_SESSIONS_PAGE_SIZE
  return recentSessions.value.slice(start, start + RECENT_SESSIONS_PAGE_SIZE)
})

const pagedRecentSessionRows = computed<ThreadSessionRow[]>(() => {
  const roots: ThreadRootItem[] = pagedRecentSessions.value.map((item) => ({
    id: item.id,
    session: item.session,
    directory: item.directory,
  }))
  return buildThreadRowsFromRoots(roots)
})

async function requestRecentSessionsPage(nextPage: number) {
  if (recentSessionsPaging.value) return
  const maxPage = Math.max(0, recentSessionsPageCount.value - 1)
  const target = Math.max(0, Math.min(maxPage, Math.floor(nextPage || 0)))
  if (target === recentSessionsPage.value) return

  recentSessionsPaging.value = true
  try {
    await directorySessions.ensureRecentSessionRowsLoaded({
      page: target,
      pageSize: RECENT_SESSIONS_PAGE_SIZE,
    })
    recentSessionsPage.value = target
  } finally {
    recentSessionsPaging.value = false
  }
}

const runningSessions = computed<RunningSessionItem[]>(() => {
  return (directorySessions.runningSidebarRows || []).map((row) => ({
    id: row.id,
    session: row.session,
    directory: row.directory,
    updatedAt: row.updatedAt,
    statusType: row.statusType,
    attention: row.attention,
  }))
})

const statusLabelForSessionId = (sessionId: string): { label: string; dotClass: string } => {
  return directorySessions.statusLabelForSessionId(sessionId)
}

watch(
  () => [chat.sessionStatusBySession, chat.attentionBySession, activity.snapshot] as const,
  () => {
    directorySessions.syncRuntimeFromStores({
      sessionStatusBySession: chat.sessionStatusBySession || {},
      attentionBySession: chat.attentionBySession || {},
      activitySnapshot: activity.snapshot || {},
    })
  },
  { immediate: true },
)

const runningSessionsPageCount = computed(() => {
  const total = Math.max(Number(directorySessions.runningIndexTotal || 0), runningSessions.value.length)
  return Math.max(1, Math.ceil(total / RUNNING_SESSIONS_PAGE_SIZE))
})

const runningSessionsTotal = computed(() => {
  return Math.max(Number(directorySessions.runningIndexTotal || 0), runningSessions.value.length)
})

watch(
  () => [runningSessions.value.length, runningSessionsPageCount.value] as const,
  () => {
    const maxPage = Math.max(0, runningSessionsPageCount.value - 1)
    if (runningSessionsPage.value > maxPage) runningSessionsPage.value = maxPage
    if (runningSessionsPage.value < 0) runningSessionsPage.value = 0
  },
  { immediate: true },
)

const pagedRunningSessions = computed(() => {
  const page = Math.max(0, Math.min(runningSessionsPageCount.value - 1, Math.floor(runningSessionsPage.value || 0)))
  const start = page * RUNNING_SESSIONS_PAGE_SIZE
  return runningSessions.value.slice(start, start + RUNNING_SESSIONS_PAGE_SIZE)
})

const pagedRunningSessionRows = computed<ThreadSessionRow[]>(() => {
  const roots: ThreadRootItem[] = pagedRunningSessions.value.map((item) => ({
    id: item.id,
    session: item.session,
    directory: item.directory,
  }))
  return buildThreadRowsFromRoots(roots)
})

async function requestRunningSessionsPage(nextPage: number) {
  if (runningSessionsPaging.value) return
  const maxPage = Math.max(0, runningSessionsPageCount.value - 1)
  const target = Math.max(0, Math.min(maxPage, Math.floor(nextPage || 0)))
  if (target === runningSessionsPage.value) return

  runningSessionsPaging.value = true
  try {
    await directorySessions.ensureRunningSessionRowsLoaded({
      page: target,
      pageSize: RUNNING_SESSIONS_PAGE_SIZE,
    })
    runningSessionsPage.value = target
  } finally {
    runningSessionsPaging.value = false
  }
}

watch(
  () =>
    runningSessionsOpen.value
      ? `${String(runningSessionsPage.value || 0)}|${pagedRunningSessions.value.map((item) => item.id).join('|')}`
      : '',
  () => {
    if (!runningSessionsOpen.value) return
    void directorySessions.ensureRunningSessionRowsLoaded({
      page: Math.max(0, Math.floor(runningSessionsPage.value || 0)),
      pageSize: RUNNING_SESSIONS_PAGE_SIZE,
    })
  },
  { immediate: true },
)

watch(
  () => (recentSessionsOpen.value ? String(recentSessionsPage.value || 0) : ''),
  () => {
    if (!recentSessionsOpen.value) return
    void directorySessions.ensureRecentSessionRowsLoaded({
      page: Math.max(0, Math.floor(recentSessionsPage.value || 0)),
      pageSize: RECENT_SESSIONS_PAGE_SIZE,
    })
  },
  { immediate: true },
)

watch(
  () =>
    pinnedSessionsOpen.value
      ? `${Math.max(0, Math.floor(pinnedSessionsPage.value || 0))}|${pinnedSessionIds.value.join('|')}`
      : '',
  () => {
    if (!pinnedSessionsOpen.value) return
    const page = Math.max(0, Math.floor(pinnedSessionsPage.value || 0))
    const start = page * PINNED_SESSIONS_PAGE_SIZE
    const ids = pinnedSessionIds.value.slice(start, start + PINNED_SESSIONS_PAGE_SIZE)
    void directorySessions.ensurePinnedSessionRowsLoaded(ids)
  },
  { immediate: true },
)

async function openRunningSession(sessionId: string) {
  const sid = (sessionId || '').trim()
  if (!sid) return
  const row = runningSessions.value.find((item) => item.id === sid) || null
  const indexed = directorySessions.allSessionIndexById?.[sid] || null
  const directory = row?.directory || indexed?.directory || null
  if (directory?.id && directory?.path) {
    await selectDirectory(directory.id, directory.path)
  }
  await selectSession(sid)
}

async function openPinnedSession(sessionId: string) {
  const sid = (sessionId || '').trim()
  if (!sid) return
  const indexed = directorySessions.allSessionIndexById?.[sid] || null
  const directory = indexed?.directory || null
  if (directory?.id && directory?.path) {
    await selectDirectory(directory.id, directory.path)
  }
  await selectSession(sid)
}

async function openRecentSession(sessionId: string) {
  const sid = (sessionId || '').trim()
  if (!sid) return
  const row = recentSessions.value.find((item) => item.id === sid) || null
  const indexed = directorySessions.allSessionIndexById?.[sid] || null
  const directory = row?.directory || indexed?.directory || null
  if (directory?.id && directory?.path) {
    await selectDirectory(directory.id, directory.path)
  }
  await selectSession(sid)
}

function directoryHasActiveOrBlocked(p: DirectoryEntry): boolean {
  const list = aggregatedSessionsForDirectory(p.id, p.path)
  for (const s of list) {
    const id = readSessionId(s)
    if (!id) continue
    if (isSessionActiveOrBlocked(id)) return true
  }
  return false
}

async function ensureDirectoryAggregateLoaded(
  directoryId: string,
  directoryPath: string,
  opts?: { force?: boolean; focusSessionId?: string; page?: number; pageSize?: number },
) {
  const pid = (directoryId || '').trim()
  const root = (directoryPath || '').trim()
  if (!pid || !root) return

  const pageSize = Math.max(1, Math.floor(opts?.pageSize || SESSION_ROOTS_PAGE_SIZE))
  const targetPage =
    typeof opts?.page === 'number' && Number.isFinite(opts.page)
      ? Math.max(0, Math.floor(opts.page))
      : sessionRootPage(pid)

  try {
    await directorySessions.ensureDirectoryAggregateLoaded(pid, root, {
      force: opts?.force,
      focusSessionId: opts?.focusSessionId,
      pinnedSessionIds: pinnedSessionIds.value,
      page: targetPage,
      pageSize,
      includeWorktrees: true,
    })
  } catch (err) {
    // Don't render errors inside the sidebar; use toasts instead.
    if (isUiAuthRequiredError(err)) return
    const msg = err instanceof Error ? err.message : String(err)
    pushSidebarErrorToast('sidebar:sessions', msg || String(t('chat.sidebar.errors.failedToLoadSessions')), 4500, 8000)
  }
}

watch(
  () => pinnedSessionIds.value.join('|'),
  () => {
    for (const p of directories.value) {
      const pid = (p.id || '').trim()
      if (!pid) continue
      if (!directorySessions.sessionPageByDirectoryId?.[pid]) continue
      void ensureDirectoryAggregateLoaded(pid, p.path, { force: false })
    }
  },
)

function autoLoadExpandedDirectoriesOnce() {
  for (const p of directories.value) {
    const pid = (p.id || '').trim()
    if (!pid) continue
    if (isDirectoryCollapsed(pid)) continue
    const attempted = Boolean(aggregateAttemptedByDirectoryId.value[pid])
    const hasCache = hasCachedSessionsForDirectory(pid)
    if (attempted && hasCache) continue
    void ensureDirectoryAggregateLoaded(pid, p.path, { force: attempted && !hasCache })
  }
}

watch(
  () => [directories.value.map((p) => `${p.id}:${p.path}`).join('|'), Array.from(collapsedDirectories.value).join('|')],
  () => {
    // Auto-load sessions for currently-expanded directories (once).
    autoLoadExpandedDirectoriesOnce()
  },
  { immediate: true },
)

onMounted(() => {
  // Mobile sidebar mounts/unmounts; avoid refetching on every open.
  if (!autoLoadExpandedAlreadyAppliedThisLoad()) {
    autoLoadExpandedDirectoriesOnce()
    markAutoLoadExpandedAppliedThisLoad()
  }
})

onBeforeUnmount(() => {
  if (directoryPageFetchTimer !== null) {
    window.clearTimeout(directoryPageFetchTimer)
    directoryPageFetchTimer = null
  }
})

async function selectDirectory(directoryId: string, directoryPath: string) {
  dismissDeepLinkFocus()
  directoryStore.setDirectory(directoryPath)
  await ensureDirectoryAggregateLoaded(directoryId, directoryPath)
}

async function focusDirectoryContext(directoryId: string, directoryPath: string) {
  const pid = (directoryId || '').trim()
  const root = (directoryPath || '').trim()
  if (!pid || !root) return
  if ((directoryStore.currentDirectory || '').trim() !== root) {
    dismissDeepLinkFocus()
    directoryStore.setDirectory(root)
  }
}

async function createSessionInDirectory(directoryId: string, directoryPath: string) {
  if (creatingSession.value) return
  creatingSession.value = true
  try {
    await focusDirectoryContext(directoryId, directoryPath)
    ui.setActiveMainTab('chat')
    const created = await chat.createSession()
    if (created?.id) {
      // Ensure the sidebar list reflects the new session without a manual refresh.
      void ensureDirectoryAggregateLoaded(directoryId, directoryPath, {
        force: true,
        focusSessionId: created.id,
      }).catch(() => {
        // ignore
      })

      ui.enableSessionQuery()
      const nextQuery = patchSessionIdInQuery(route.query, created.id)
      // If the user creates a session from Settings/other pages, take them to Chat.
      if ((route.path || '').startsWith('/chat')) {
        await router.replace({ query: nextQuery })
      } else {
        await router.push({ path: '/chat', query: nextQuery })
      }

      // Mobile UX: switch focus to the main chat pane after creating.
      if (props.mobileVariant) ui.setSessionSwitcherOpen(false)
    }
  } catch (err) {
    toasts.push('error', err instanceof Error ? err.message : String(err))
  } finally {
    creatingSession.value = false
  }
}

async function selectSession(sessionId: string) {
  ui.enableSessionQuery()
  // Selecting a session should always take the user to the Chat view.
  ui.setActiveMainTab('chat')
  const nextQuery = patchSessionIdInQuery(route.query, sessionId)
  if ((route.path || '').startsWith('/chat')) {
    await router.replace({ query: nextQuery })
  } else {
    await router.push({ path: '/chat', query: nextQuery })
  }
  await chat.selectSession(sessionId)

  // Mobile UX: selecting a session should immediately close the switcher.
  if (props.mobileVariant) ui.setSessionSwitcherOpen(false)
}

async function deleteSession(sessionId: string) {
  const sid = (sessionId || '').trim()
  if (!sid) return

  // Resolve best-effort directory + directory entry so we can refresh the right sidebar page.
  const idx = directorySessions.allSessionIndexById?.[sid] || null
  const cached = chat.getSessionById(sid)

  const cachedDir = readSessionDirectory(cached)
  const idxDir = readSessionDirectory(idx?.session)

  let directory = idxDir || cachedDir || (idx?.directory?.path || '').trim() || ''
  let directoryEntry: DirectoryEntry | null = idx?.directory ?? null

  if (!directory || !directoryEntry) {
    const resolved = await directorySessions.resolveDirectoryForSession(sid).catch(() => null)
    if (resolved) {
      if (!directory) directory = resolved.locatedDir || resolved.directoryPath
      if (!directoryEntry) {
        directoryEntry = directories.value.find((entry) => entry.id === resolved.directoryId) || null
      }
    }
  }

  await chat.deleteSession(sid, { directory: directory || null })

  // If the deleted session was pinned, drop it from the pin list immediately.
  if (pinnedSessionIds.value.includes(sid)) {
    pinnedSessionIds.value = pinnedSessionIds.value.filter((id) => String(id || '').trim() !== sid)
  }

  // Reconcile the specific directory page so paging/children counts stay correct.
  if (directoryEntry) {
    void ensureDirectoryAggregateLoaded(directoryEntry.id, directoryEntry.path, { force: true })
  }
}

async function addDirectoryEntry() {
  const p = newDirectoryPath.value.trim()
  if (!p) return
  await settings.addProject(p)
  newDirectoryPath.value = ''
  isAddDirectoryOpen.value = false
}

async function removeDirectoryEntry(directoryId: string) {
  await settings.removeProject(directoryId)
}

const isDirectoryFocused = (directory: DirectoryEntry) => {
  const dir = (directoryStore.currentDirectory || '').trim()
  if (!dir || !directory?.path) return false
  if (dir === directory.path) return true
  const wts = worktreesByDirectoryId.value[(directory.id || '').trim()] || []
  return wts.includes(dir)
}

function aggregatedSessionsForDirectory(directoryId: string, directoryPath: string) {
  const list = directorySessions.aggregatedSessionsForDirectory(directoryId, directoryPath)

  return list.map((session) => {
    const sid = readSessionId(session)
    if (!sid) return session
    const fresh = chat.getSessionById(sid)
    if (!fresh) return session

    const freshUpdatedAt = readSessionUpdatedAt(fresh)
    const summaryUpdatedAt = readSessionUpdatedAt(session)

    // Avoid stale chat cache overriding fresher sidebar summary data.
    if (freshUpdatedAt > summaryUpdatedAt) {
      return { ...session, ...fresh }
    }
    return { ...fresh, ...session }
  })
}

async function searchSessionsForDirectory(
  directory: DirectoryEntry,
  query: string,
  limit: number,
  signal?: AbortSignal,
) {
  const root = (directory?.path || '').trim()
  const q = (query || '').trim()
  if (!root || !q || limit <= 0) return []
  try {
    const resp = await chatApi.listSessions(root, {
      scope: 'directory',
      search: q,
      limit,
      includeTotal: false,
      signal,
    })
    return Array.isArray(resp?.sessions) ? resp.sessions : []
  } catch (err) {
    if (isAbortError(err)) throw err
    return []
  }
}

function recentSessionsForList(list: SessionLike[]) {
  const set = new Set(pinnedSessionIds.value)
  return list.filter((s) => !set.has(s.id))
}

// Tree helpers extracted to '@/features/sessions/model/tree'.

function toggleExpandedParent(sessionId: string) {
  const id = (sessionId || '').trim()
  if (!id) return
  const next = new Set(expandedParents.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedParents.value = next
}

function ensureAncestorsExpanded(parentById: Record<string, string | null>, sessionId: string) {
  const sid = (sessionId || '').trim()
  if (!sid) return

  const next = new Set(expandedParents.value)
  const seen = new Set<string>()
  let cur: string | null = sid
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const parent: string | null = parentById[cur] || null
    if (!parent) break
    next.add(parent)
    cur = parent
  }
  expandedParents.value = next
}

const flattenedByDirectoryId = computed(() => {
  const out: Record<string, { rows: FlatTreeRow[]; parentById: Record<string, string | null>; rootIds: string[] }> = {}
  for (const directory of pagedDirectories.value) {
    // Show pinned separately; tree renders non-pinned sessions.
    const list = recentSessionsForList(aggregatedSessionsForDirectory(directory.id, directory.path))
    out[directory.id] = buildFlattenedTree(list, expandedParents.value)
  }
  return out
})

const pinnedThreadRowsByDirectoryId = computed<Record<string, ThreadSessionRow[]>>(() => {
  const out: Record<string, ThreadSessionRow[]> = {}
  const pinnedSet = new Set(pinnedSessionIds.value.map((id) => String(id || '').trim()).filter(Boolean))

  for (const directory of pagedDirectories.value) {
    const roots: ThreadRootItem[] = []
    const list = aggregatedSessionsForDirectory(directory.id, directory.path)
    for (const session of list) {
      const sid = readSessionId(session)
      if (!sid || !pinnedSet.has(sid)) continue
      roots.push({
        id: sid,
        session,
        directory,
      })
    }
    out[directory.id] = buildThreadRowsFromRoots(roots)
  }

  return out
})

function pinnedRowsForDirectory(directoryId: string): ThreadSessionRow[] {
  const pid = (directoryId || '').trim()
  if (!pid) return []
  return pinnedThreadRowsByDirectoryId.value[pid] || []
}

function sessionRootPage(directoryId: string): number {
  return directorySessions.sessionRootPage(directoryId, SESSION_ROOTS_PAGE_SIZE)
}

function sessionRootPageCount(directoryId: string): number {
  return directorySessions.sessionRootPageCount(directoryId, SESSION_ROOTS_PAGE_SIZE)
}

async function setSessionRootPage(directoryId: string, page: number) {
  const pid = (directoryId || '').trim()
  if (!pid) return
  const current = directorySessions.sessionRootPage(pid, SESSION_ROOTS_PAGE_SIZE)
  const maxPage = Math.max(0, sessionRootPageCount(pid) - 1)
  const next = Math.max(0, Math.min(maxPage, Math.floor(page || 0)))
  if (current === next) return

  const directory = directories.value.find((d) => (d.id || '').trim() === pid)
  if (directory?.path) {
    await ensureDirectoryAggregateLoaded(pid, directory.path, {
      force: true,
      page: next,
      pageSize: SESSION_ROOTS_PAGE_SIZE,
    })
  }
}

function pagedRowsForDirectory(directoryId: string): FlatTreeRow[] {
  const pid = (directoryId || '').trim()
  const tree = flattenedByDirectoryId.value[pid]
  if (!tree) return []
  return tree.rows || []
}

const { locatedSessionId, locateFromSearch, searchWarming, sessionSearchHits, setSessionEl } = useSidebarLocate({
  ui,
  directories,
  directoryPage,
  directoriesPageSize: DIRECTORIES_PAGE_SIZE,
  collapsedDirectoryIds: collapsedDirectories,
  pinnedSessionIds,
  sidebarQuery,
  sidebarQueryNorm,
  aggregatedSessionsForDirectory,
  searchSessions: searchSessionsForDirectory,
  ensureDirectoryAggregateLoaded,
  resolveDirectoryForSession: directorySessions.resolveDirectoryForSession,
  flattenedByDirectoryId,
  ensureAncestorsExpanded,
})

// pinned/recent list rendering lives in DirectoriesList.
</script>

<template>
  <div class="oc-chat-sidebar flex h-full flex-col bg-sidebar overflow-hidden">
    <AddDirectoryDialog v-model:open="isAddDirectoryOpen" v-model:path="newDirectoryPath" @add="addDirectoryEntry" />

    <OptionMenu
      :open="directoryActionsOpen"
      v-model:query="directoryActionsDialogQuery"
      :groups="directoryActionMenuGroups"
      :title="String(t('chat.sidebar.directoryActions.menuTitle'))"
      :mobile-title="String(t('chat.sidebar.directoryActions.menuTitle'))"
      :searchable="true"
      :search-placeholder="String(t('common.searchActions'))"
      :empty-text="String(t('common.noActionsFound'))"
      :is-mobile-pointer="true"
      filter-mode="external"
      @update:open="
        (v) => {
          directoryActionsOpen = v
          if (!v) directoryActionsTarget = null
        }
      "
      @select="runDirectoryDialogAction"
    />

    <OptionMenu
      :open="sessionActionsOpen"
      v-model:query="sessionActionsDialogQuery"
      :groups="sessionActionMenuGroups"
      :title="String(t('chat.sidebar.sessionActions.menuTitle'))"
      :mobile-title="String(t('chat.sidebar.sessionActions.menuTitle'))"
      :searchable="true"
      :search-placeholder="String(t('common.searchActions'))"
      :empty-text="String(t('common.noActionsFound'))"
      :is-mobile-pointer="true"
      filter-mode="external"
      @update:open="
        (v) => {
          sessionActionsOpen = v
          if (!v) sessionActionsTarget = null
        }
      "
      @select="runSessionDialogAction"
    />

    <RenameSessionDialog
      :open="renameDialogOpen"
      :draft="renameDraft"
      :busy="renameBusy"
      @update:open="
        (v) => {
          renameDialogOpen = v
          if (!v) cancelRenameFromSidebar()
        }
      "
      @update:draft="(v) => (renameDraft = v)"
      @save="saveRenameFromSidebar"
    />

    <div class="flex flex-col flex-1 min-h-0" :class="isSidebarDialogOpen ? 'pointer-events-none' : ''">
      <ChatSidebarHeader
        :directoryPage="directoryPage"
        :directoryPageCount="directoryPageCount"
        :directoryPaging="directoryPaging || directoryPageLoading"
        :sessionsLoading="sessionsLoading"
        :query="sidebarQuery"
        :is-mobile-pointer="ui.isMobilePointer"
        @update:query="(v) => (sidebarQuery = v)"
        @update:directoryPage="
          (v) => {
            dismissDeepLinkFocus()
            void requestDirectoryPage(v)
          }
        "
        @add-directory="() => (isAddDirectoryOpen = true)"
        @refresh="handleSidebarRefresh"
      />

      <div
        class="flex-1 min-h-0 overflow-x-hidden"
        :class="props.mobileVariant ? 'overflow-y-auto pb-2' : 'flex flex-col overflow-y-hidden'"
      >
        <DirectoriesList
          :uiIsMobile="ui.isMobile"
          :directories="directories"
          :pagedDirectories="pagedDirectories"
          :visibleDirectories="visibleDirectories"
          :sidebarQueryNorm="sidebarQueryNorm"
          :searchWarming="searchWarming"
          :sessionSearchHits="sessionSearchHits"
          :locateFromSearch="locateFromSearch"
          :locatedSessionId="locatedSessionId"
          :setSessionEl="setSessionEl"
          :pinnedSessionIds="pinnedSessionIds"
          :chatSelectedSessionId="chat.selectedSessionId"
          :creatingSession="creatingSession"
          :aggregateLoadingByDirectoryId="aggregateLoadingByDirectoryId"
          :aggregateAttemptedByDirectoryId="aggregateAttemptedByDirectoryId"
          :hasCachedSessionsForDirectory="hasCachedSessionsForDirectory"
          :isDirectoryCollapsed="isDirectoryCollapsed"
          :toggleDirectoryCollapse="toggleDirectoryCollapse"
          :isDirectoryFocused="isDirectoryFocused"
          :directoryHasActiveOrBlocked="directoryHasActiveOrBlocked"
          :openDirectoryActions="openDirectoryActions"
          :refreshDirectoryInline="refreshDirectoryInline"
          :newSessionInline="newSessionInline"
          :removeDirectoryInline="removeDirectoryInline"
          :aggregatedSessionsForDirectory="aggregatedSessionsForDirectory"
          :selectDirectory="selectDirectory"
          :selectSession="selectSession"
          :openSessionActions="openSessionActions"
          :openSessionActionMenu="openSessionActionMenu"
          :togglePin="togglePin"
          :deleteSession="deleteSession"
          :hasAttention="hasAttention"
          :statusLabelForSessionId="statusLabelForSessionId"
          :sessionActionMenuTarget="sessionActionMenuTarget"
          :sessionActionMenuAnchorEl="sessionActionMenuAnchorRef"
          :sessionActionMenuQuery="sessionActionMenuQuery"
          @update:sessionActionMenuQuery="(v) => (sessionActionMenuQuery = v)"
          :filteredSessionActionItems="filteredSessionActionItems"
          :setSessionActionMenuRef="setSessionActionMenuRef"
          :runSessionActionMenu="runSessionActionMenu"
          :isSessionRenaming="isRenamingSession"
          :renameDraft="renameDraft"
          :renameBusy="renameBusy"
          :updateRenameDraft="updateRenameDraft"
          :saveRename="saveRenameFromSidebar"
          :cancelRename="cancelRenameFromSidebar"
          :pinnedRowsForDirectory="pinnedRowsForDirectory"
          :pagedRowsForDirectory="pagedRowsForDirectory"
          :toggleExpandedParent="toggleExpandedParent"
          :sessionRootPageCount="sessionRootPageCount"
          :sessionRootPage="sessionRootPage"
          :setSessionRootPage="
            (pid, page) => {
              dismissDeepLinkFocus()
              void setSessionRootPage(pid, page)
            }
          "
        />

        <PinnedSessionsFooter
          v-model:open="pinnedSessionsOpen"
          :page="pinnedSessionsPage"
          :paging="pinnedSessionsPaging"
          :pinnedSessionRows="pagedPinnedSessionRows"
          :pinnedSessionsTotal="pinnedSessions.length"
          :pinnedSessionsPageCount="pinnedSessionsPageCount"
          :selectedSessionId="chat.selectedSessionId"
          :uiIsMobile="ui.isMobile"
          :pinnedSessionIds="pinnedSessionIds"
          :hasAttention="hasAttention"
          :statusLabelForSessionId="statusLabelForSessionId"
          :openSessionActions="openSessionActions"
          :openSessionActionMenu="openSessionActionMenu"
          :togglePin="togglePin"
          :deleteSession="deleteSession"
          :sessionActionMenuTarget="sessionActionMenuTarget"
          :sessionActionMenuAnchorEl="sessionActionMenuAnchorRef"
          :sessionActionMenuQuery="sessionActionMenuQuery"
          @update:sessionActionMenuQuery="(v) => (sessionActionMenuQuery = v)"
          :filteredSessionActionItems="filteredSessionActionItems"
          :setSessionActionMenuRef="setSessionActionMenuRef"
          :runSessionActionMenu="runSessionActionMenu"
          :isSessionRenaming="isRenamingSession"
          :renameDraft="renameDraft"
          :renameBusy="renameBusy"
          :updateRenameDraft="updateRenameDraft"
          :saveRename="saveRenameFromSidebar"
          :cancelRename="cancelRenameFromSidebar"
          @update:page="(v) => void requestPinnedSessionsPage(v)"
          @open-session="openPinnedSession"
          @toggle-thread="toggleExpandedParent"
        />

        <RecentSessionsFooter
          v-model:open="recentSessionsOpen"
          :page="recentSessionsPage"
          :paging="recentSessionsPaging"
          :recentSessionRows="pagedRecentSessionRows"
          :recentSessionsTotal="recentSessionsTotal"
          :recentSessionsPageCount="recentSessionsPageCount"
          :selectedSessionId="chat.selectedSessionId"
          :uiIsMobile="ui.isMobile"
          :pinnedSessionIds="pinnedSessionIds"
          :hasAttention="hasAttention"
          :statusLabelForSessionId="statusLabelForSessionId"
          :openSessionActions="openSessionActions"
          :openSessionActionMenu="openSessionActionMenu"
          :togglePin="togglePin"
          :deleteSession="deleteSession"
          :sessionActionMenuTarget="sessionActionMenuTarget"
          :sessionActionMenuAnchorEl="sessionActionMenuAnchorRef"
          :sessionActionMenuQuery="sessionActionMenuQuery"
          @update:sessionActionMenuQuery="(v) => (sessionActionMenuQuery = v)"
          :filteredSessionActionItems="filteredSessionActionItems"
          :setSessionActionMenuRef="setSessionActionMenuRef"
          :runSessionActionMenu="runSessionActionMenu"
          :isSessionRenaming="isRenamingSession"
          :renameDraft="renameDraft"
          :renameBusy="renameBusy"
          :updateRenameDraft="updateRenameDraft"
          :saveRename="saveRenameFromSidebar"
          :cancelRename="cancelRenameFromSidebar"
          @update:page="(v) => void requestRecentSessionsPage(v)"
          @open-session="openRecentSession"
          @toggle-thread="toggleExpandedParent"
        />

        <RunningSessionsFooter
          v-model:open="runningSessionsOpen"
          :page="runningSessionsPage"
          :paging="runningSessionsPaging"
          :runningSessionRows="pagedRunningSessionRows"
          :runningSessionsTotal="runningSessionsTotal"
          :runningSessionsPageCount="runningSessionsPageCount"
          :selectedSessionId="chat.selectedSessionId"
          :statusLabelForSessionId="statusLabelForSessionId"
          @open-session="openRunningSession"
          :uiIsMobile="ui.isMobile"
          :pinnedSessionIds="pinnedSessionIds"
          :hasAttention="hasAttention"
          :openSessionActions="openSessionActions"
          :openSessionActionMenu="openSessionActionMenu"
          :togglePin="togglePin"
          :deleteSession="deleteSession"
          :sessionActionMenuTarget="sessionActionMenuTarget"
          :sessionActionMenuAnchorEl="sessionActionMenuAnchorRef"
          :sessionActionMenuQuery="sessionActionMenuQuery"
          @update:sessionActionMenuQuery="(v) => (sessionActionMenuQuery = v)"
          :filteredSessionActionItems="filteredSessionActionItems"
          :setSessionActionMenuRef="setSessionActionMenuRef"
          :runSessionActionMenu="runSessionActionMenu"
          :isSessionRenaming="isRenamingSession"
          :renameDraft="renameDraft"
          :renameBusy="renameBusy"
          :updateRenameDraft="updateRenameDraft"
          :saveRename="saveRenameFromSidebar"
          :cancelRename="cancelRenameFromSidebar"
          @update:page="(v) => void requestRunningSessionsPage(v)"
          @toggle-thread="toggleExpandedParent"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { RiAddLine, RiDeleteBinLine, RiRefreshLine, RiStarFill, RiStarLine } from '@remixicon/vue'

import RenameSessionDialog from '@/components/chat/RenameSessionDialog.vue'
import { patchSessionIdInQuery } from '@/app/navigation/sessionQuery'
import { useChatStore } from '@/stores/chat'
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
import type { FlatTreeRow } from '@/features/sessions/model/tree'
import { normalizeDirForCompare } from '@/features/sessions/model/labels'
import { useSidebarLocate } from '@/layout/chatSidebar/useSidebarLocate'
import { normalizeSidebarUiPrefsForUi } from '@/features/sessions/model/sidebarUiPrefs'
import { buildRunningSessionRows } from '@/layout/chatSidebar/runningSessionRows'
import { apiJson } from '@/lib/api'

const props = defineProps<{ mobileVariant?: boolean }>()

const route = useRoute()
const router = useRouter()

const ui = useUiStore()
const chat = useChatStore()
const settings = useSettingsStore()
const toasts = useToastsStore()
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

function stringArraysEquivalent(left: string[], right: string[]): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false
  }
  return true
}

function setsEquivalent(left: Set<string>, right: Set<string>): boolean {
  if (left === right) return true
  if (left.size !== right.size) return false
  for (const value of left) {
    if (!right.has(value)) return false
  }
  return true
}

function mapsEquivalent(left: Map<string, boolean>, right: Map<string, boolean>): boolean {
  if (left === right) return true
  if (left.size !== right.size) return false
  for (const [key, value] of left.entries()) {
    if (right.get(key) !== value) return false
  }
  return true
}

function applyPendingBooleanOverlay(base: Set<string>, overlay: Map<string, boolean>): { next: Set<string>; acknowledgedIds: string[] } {
  const next = new Set(base)
  const acknowledgedIds: string[] = []

  for (const [id, target] of overlay.entries()) {
    const current = next.has(id)
    if (current === target) {
      acknowledgedIds.push(id)
      continue
    }
    if (target) {
      next.add(id)
    } else {
      next.delete(id)
    }
  }

  return { next, acknowledgedIds }
}

function applyUiPrefsToLocal(prefsRaw: Parameters<typeof normalizeSidebarUiPrefsForUi>[0]) {
  const prefs = normalizeSidebarUiPrefsForUi(prefsRaw)
  let pinPendingTargets = pinCommandPendingTargets.value
  const pinnedFromPrefs = toIdSet(prefs.pinnedSessionIds)
  const pinnedOverlayResult = applyPendingBooleanOverlay(pinnedFromPrefs, pinPendingTargets)
  if (pinnedOverlayResult.acknowledgedIds.length > 0) {
    const nextPendingTargets = new Map(pinPendingTargets)
    for (const sessionId of pinnedOverlayResult.acknowledgedIds) {
      nextPendingTargets.delete(sessionId)
    }
    if (!mapsEquivalent(pinPendingTargets, nextPendingTargets)) {
      pinCommandPendingTargets.value = nextPendingTargets
      pinPendingTargets = nextPendingTargets
    }
  }
  const nextPinnedSessionIds = Array.from(pinnedOverlayResult.next)
  if (!stringArraysEquivalent(pinnedSessionIds.value, nextPinnedSessionIds)) {
    pinnedSessionIds.value = nextPinnedSessionIds
  }

  const nextCollapsedDirectories = toIdSet(prefs.collapsedDirectoryIds)
  for (const pendingDirectoryId of collapseCommandPendingIds.value) {
    if (directoryExpandLoadingIds.value.has(pendingDirectoryId)) continue
    nextCollapsedDirectories.add(pendingDirectoryId)
  }
  if (!setsEquivalent(collapsedDirectories.value, nextCollapsedDirectories)) {
    collapsedDirectories.value = nextCollapsedDirectories
  }

  let expandPendingTargets = expandCommandPendingTargets.value
  const expandedFromPrefs = toIdSet(prefs.expandedParentSessionIds)
  const expandedOverlayResult = applyPendingBooleanOverlay(expandedFromPrefs, expandPendingTargets)
  if (expandedOverlayResult.acknowledgedIds.length > 0) {
    const nextPendingTargets = new Map(expandPendingTargets)
    for (const sessionId of expandedOverlayResult.acknowledgedIds) {
      nextPendingTargets.delete(sessionId)
    }
    if (!mapsEquivalent(expandPendingTargets, nextPendingTargets)) {
      expandCommandPendingTargets.value = nextPendingTargets
      expandPendingTargets = nextPendingTargets
    }
  }
  const nextExpandedParents = expandedOverlayResult.next
  if (!setsEquivalent(expandedParents.value, nextExpandedParents)) {
    expandedParents.value = nextExpandedParents
  }

  if (!runningSessionsOpenUpdating.value && runningSessionsOpen.value !== prefs.runningSessionsOpen) {
    runningSessionsOpen.value = prefs.runningSessionsOpen
  }
  if (runningSessionsPage.value !== prefs.runningSessionsPage) {
    runningSessionsPage.value = prefs.runningSessionsPage
  }
  if (!recentSessionsOpenUpdating.value && recentSessionsOpen.value !== prefs.recentSessionsOpen) {
    recentSessionsOpen.value = prefs.recentSessionsOpen
  }
  if (recentSessionsPage.value !== prefs.recentSessionsPage) {
    recentSessionsPage.value = prefs.recentSessionsPage
  }
  if (!pinnedSessionsOpenUpdating.value && pinnedSessionsOpen.value !== prefs.pinnedSessionsOpen) {
    pinnedSessionsOpen.value = prefs.pinnedSessionsOpen
  }
  if (pinnedSessionsPage.value !== prefs.pinnedSessionsPage) {
    pinnedSessionsPage.value = prefs.pinnedSessionsPage
  }

  const nextPage = Math.max(0, Math.floor(Number(prefs.directoriesPage || 0)))
  if (directoryPage.value !== nextPage) {
    skipDirectoryPageWatchOnce = true
    directoryPage.value = nextPage
  }
}

const initialPrefs = normalizeSidebarUiPrefsForUi(directorySessions.uiPrefs)

const pinnedSessionIds = ref<string[]>(initialPrefs.pinnedSessionIds.slice())
const collapsedDirectories = ref<Set<string>>(toIdSet(initialPrefs.collapsedDirectoryIds))
const expandedParents = ref<Set<string>>(toIdSet(initialPrefs.expandedParentSessionIds))
const runningSessionsOpen = ref(Boolean(initialPrefs.runningSessionsOpen))
const runningSessionsPage = ref(initialPrefs.runningSessionsPage)
const runningSessionsPaging = ref(false)
const runningSessionsOpenUpdating = ref(false)
const recentSessionsOpen = ref(Boolean(initialPrefs.recentSessionsOpen))
const recentSessionsPage = ref(initialPrefs.recentSessionsPage)
const recentSessionsPaging = ref(false)
const recentSessionsOpenUpdating = ref(false)
const pinnedSessionsOpen = ref(Boolean(initialPrefs.pinnedSessionsOpen))
const pinnedSessionsPage = ref(initialPrefs.pinnedSessionsPage)
const pinnedSessionsPaging = ref(false)
const pinnedSessionsOpenUpdating = ref(false)
const directoryPage = ref(initialPrefs.directoriesPage)
const directoryPaging = ref(false)
const pinCommandPendingIds = ref<Set<string>>(new Set())
const pinCommandPendingTargets = ref<Map<string, boolean>>(new Map())
const collapseCommandPendingIds = ref<Set<string>>(new Set())
const directoryExpandLoadingIds = ref<Set<string>>(new Set())
const expandCommandPendingIds = ref<Set<string>>(new Set())
const expandCommandPendingTargets = ref<Map<string, boolean>>(new Map())

// Directory entry type lives in '@/features/sessions/model/types'.

const directories = computed<DirectoryEntry[]>(() => directorySessions.visibleDirectories)

// Paging (sidebar can contain many directories/sessions).
const DIRECTORIES_PAGE_SIZE = 15
const SESSION_ROOTS_PAGE_SIZE = 10

// Search/filter (user-driven only).
const sidebarQuery = ref('')
const sidebarQueryDraft = ref('')
const sidebarQueryNorm = computed(() => sidebarQuery.value.trim().toLowerCase())

function submitSidebarQuery() {
  const nextRaw = sidebarQueryDraft.value
  const nextNorm = nextRaw.trim().toLowerCase()
  const currentNorm = sidebarQueryNorm.value
  if (nextNorm === currentNorm) {
    scheduleSidebarStateFetch(0)
    return
  }
  sidebarQuery.value = nextRaw
}

watch(
  () => sidebarQuery.value,
  (next) => {
    if (sidebarQueryDraft.value !== next) {
      sidebarQueryDraft.value = next
    }
  },
  { immediate: true },
)

watch(
  () => directorySessions.uiPrefs,
  (next) => {
    applyUiPrefsToLocal(next)
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
  return Boolean(directorySessions.loading)
})

let sidebarStateFetchTimer: number | null = null
let skipDirectoryPageWatchOnce = false

watch(
  () => directorySessions.directoriesPageIndex,
  (next) => {
    const resolved = Number.isFinite(Number(next)) ? Math.max(0, Math.floor(Number(next))) : 0
    if (directoryPage.value === resolved) return
    skipDirectoryPageWatchOnce = true
    directoryPage.value = resolved
  },
)

async function revalidateSidebarState(
  opts?: {
    directoriesPage?: number
    focusSessionId?: string
    pinnedPage?: number
    recentPage?: number
    runningPage?: number
    query?: string
  },
  runtimeOpts?: { silent?: boolean },
) {
  const hasDirectoriesPageOverride = Boolean(opts && Object.prototype.hasOwnProperty.call(opts, 'directoriesPage'))
  const directoriesPage = hasDirectoriesPageOverride
    ? typeof opts?.directoriesPage === 'number' && Number.isFinite(opts.directoriesPage)
      ? Math.max(0, Math.floor(opts.directoriesPage))
      : undefined
    : opts?.focusSessionId
      ? undefined
      : Math.max(0, Math.floor(directoryPage.value || 0))
  const directoryQuery = typeof opts?.query === 'string' ? opts.query.trim() : sidebarQueryNorm.value

  const ok = await directorySessions.revalidateFromApi({
    directoriesPage,
    directoryQuery,
    focusSessionId: opts?.focusSessionId,
    pinnedPage: opts?.pinnedPage,
    recentPage: opts?.recentPage,
    runningPage: opts?.runningPage,
  })

  if (!ok && runtimeOpts?.silent !== true) {
    pushSidebarErrorToast('sidebar:state', String(t('chat.sidebar.errors.failedToLoadSessions')), 4500, 8000)
  }
  return ok
}

function scheduleSidebarStateFetch(delayMs = 0) {
  if (sidebarStateFetchTimer !== null) {
    window.clearTimeout(sidebarStateFetchTimer)
    sidebarStateFetchTimer = null
  }
  sidebarStateFetchTimer = window.setTimeout(
    () => {
      sidebarStateFetchTimer = null
      void revalidateSidebarState(undefined, { silent: true })
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
    const ok = await directorySessions.commandSetDirectoriesPage(target, { silent: true })
    if (!ok) {
      await revalidateSidebarState({ directoriesPage: target, query: sidebarQueryNorm.value }, { silent: true })
    }
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
    scheduleSidebarStateFetch(0)
  },
)

watch(
  () => directoryPage.value,
  () => {
    if (skipDirectoryPageWatchOnce) {
      skipDirectoryPageWatchOnce = false
      return
    }
    scheduleSidebarStateFetch(0)
  },
)

watch(
  () => directoryPageCount.value,
  (count) => {
    const maxPage = Math.max(0, Math.floor(count || 1) - 1)
    if (directoryPage.value > maxPage) {
      directoryPage.value = maxPage
    }
  },
)

watch(
  () => directories.value.map((entry) => `${entry.id}:${entry.path}`).join('|'),
  () => {
    if (directoryPaging.value) return
    scheduleSidebarStateFetch(0)
  },
  { immediate: true },
)

function isDirectoryCollapsed(directoryId: string): boolean {
  const pid = (directoryId || '').trim()
  return collapsedDirectories.value.has(pid)
}

function isDirectoryExpandLoading(directoryId: string): boolean {
  const pid = (directoryId || '').trim()
  return directoryExpandLoadingIds.value.has(pid)
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
  void p
  await revalidateSidebarState(undefined, { silent: false })
}

async function refreshVisibleDirectories() {
  await revalidateSidebarState(undefined, { silent: false })
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
  await revalidateSidebarState(undefined, { silent: false })
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

async function togglePin(id: string) {
  const sid = String(id || '').trim()
  if (!sid) return
  if (pinCommandPendingIds.value.has(sid)) return

  const nextPinned = !pinnedSessionIds.value.includes(sid)
  const pendingTargets = new Map(pinCommandPendingTargets.value)
  pendingTargets.set(sid, nextPinned)
  pinCommandPendingTargets.value = pendingTargets
  applyUiPrefsToLocal(directorySessions.uiPrefs)

  const pending = new Set(pinCommandPendingIds.value)
  pending.add(sid)
  pinCommandPendingIds.value = pending

  let commandOk = false
  try {
    commandOk = await directorySessions.commandSetSessionPinned(sid, nextPinned, { silent: true })
  } finally {
    const next = new Set(pinCommandPendingIds.value)
    next.delete(sid)
    pinCommandPendingIds.value = next
  }

  if (commandOk) return

  const revertTargets = new Map(pinCommandPendingTargets.value)
  if (revertTargets.delete(sid)) {
    pinCommandPendingTargets.value = revertTargets
    applyUiPrefsToLocal(directorySessions.uiPrefs)
  }
  await revalidateSidebarState(undefined, { silent: true })
}

const sessionsLoading = computed(() => {
  return chat.sessionsLoading || directoryPageLoading.value
})

const pinnedFooterLoading = computed(() => pinnedSessionsOpenUpdating.value && pinnedSessionsOpen.value)
const recentFooterLoading = computed(() => recentSessionsOpenUpdating.value && recentSessionsOpen.value)
const runningFooterLoading = computed(() => runningSessionsOpenUpdating.value && runningSessionsOpen.value)

async function toggleDirectoryCollapse(directoryId: string, _directoryPath: string) {
  void _directoryPath
  dismissDeepLinkFocus()
  const pid = (directoryId || '').trim()
  if (!pid) return
  if (collapseCommandPendingIds.value.has(pid)) return

  const nextCollapsed = !collapsedDirectories.value.has(pid)
  if (nextCollapsed) {
    const nextLocalCollapsed = new Set(collapsedDirectories.value)
    nextLocalCollapsed.add(pid)
    collapsedDirectories.value = nextLocalCollapsed
  }
  const pending = new Set(collapseCommandPendingIds.value)
  pending.add(pid)
  collapseCommandPendingIds.value = pending
  if (!nextCollapsed) {
    const nextExpandLoading = new Set(directoryExpandLoadingIds.value)
    nextExpandLoading.add(pid)
    directoryExpandLoadingIds.value = nextExpandLoading
  }
  try {
    const ok = await directorySessions.commandSetDirectoryCollapsed(pid, nextCollapsed, { silent: true })
    if (!ok) {
      await revalidateSidebarState(undefined, { silent: true })
    }
  } finally {
    const next = new Set(collapseCommandPendingIds.value)
    next.delete(pid)
    collapseCommandPendingIds.value = next

    const nextExpandLoading = new Set(directoryExpandLoadingIds.value)
    nextExpandLoading.delete(pid)
    directoryExpandLoadingIds.value = nextExpandLoading
  }
}

function hasAttention(sessionId: string): 'permission' | 'question' | null {
  const sid = (sessionId || '').trim()
  const runtime = directorySessions.runtimeBySessionId?.[sid]
  const value = runtime?.attention
  if (value === 'permission' || value === 'question') {
    return value
  }
  if (runtime?.displayState === 'needsPermission') {
    return 'permission'
  }
  if (runtime?.displayState === 'needsReply') {
    return 'question'
  }
  return null
}

type ThreadSessionRow = {
  id: string
  session: SessionLike | null
  directory: DirectoryEntry | null
  renderKey: string
  depth: number
  parentId: string | null
  rootId: string
  isParent: boolean
  isExpanded: boolean
}
const statusLabelForSessionId = (sessionId: string): { label: string; dotClass: string } =>
  directorySessions.statusLabelForSessionId(sessionId)

type DirectorySidebarView = {
  sessionCount: number
  rootPage: number
  rootPageCount: number
  hasActiveOrBlocked: boolean
  hasRunningSessions: boolean
  hasBlockedSessions: boolean
  pinnedRows: ThreadSessionRow[]
  recentRows: ThreadSessionRow[]
  recentParentById: Record<string, string | null>
  recentRootIds: string[]
}

type DirectoryActivityState = 'running' | 'blocked' | 'mixed' | null

const flattenedTreeCacheByDirectoryId = new Map<
  string,
  { section: DirectorySidebarView | null; tree: FlattenedDirectoryTree | null }
>()

const directorySidebarById = computed<Record<string, DirectorySidebarView>>(() => {
  return (directorySessions.directorySidebarById as Record<string, DirectorySidebarView>) || {}
})

watch(
  () => Object.keys(directorySidebarById.value).join('|'),
  () => {
    const activeIds = new Set(Object.keys(directorySidebarById.value))
    for (const directoryId of flattenedTreeCacheByDirectoryId.keys()) {
      if (!activeIds.has(directoryId)) {
        flattenedTreeCacheByDirectoryId.delete(directoryId)
      }
    }
  },
)

const pinnedFooterView = computed(
  () => directorySessions.pinnedFooterView || { total: 0, page: 0, pageCount: 1, rows: [] },
)
const recentFooterView = computed(
  () => directorySessions.recentFooterView || { total: 0, page: 0, pageCount: 1, rows: [] },
)
const runningFooterView = computed(
  () => directorySessions.runningFooterView || { total: 0, page: 0, pageCount: 1, rows: [] },
)

const pinnedSessionsPageCount = computed(() => Math.max(1, Number(pinnedFooterView.value.pageCount || 1)))
const recentSessionsPageCount = computed(() => Math.max(1, Number(recentFooterView.value.pageCount || 1)))
const runningSessionsPageCount = computed(() => Math.max(1, Number(runningFooterView.value.pageCount || 1)))

const pinnedSessionsTotal = computed(() => Math.max(0, Number(pinnedFooterView.value.total || 0)))
const recentSessionsTotal = computed(() => Math.max(0, Number(recentFooterView.value.total || 0)))
const runningSessionsTotal = computed(() => Math.max(0, Number(runningFooterView.value.total || 0)))

function nonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function sessionDirectoryFromLike(session: SessionLike | null | undefined): string {
  const directory = nonEmptyString(session?.directory)
  if (directory) return directory
  const record = asRecord(session as SessionValue)
  return nonEmptyString(record?.cwd)
}

function normalizeSidebarSessionLike(session: SessionLike | null | undefined, fallbackId: string): SessionLike | null {
  const sid = nonEmptyString(session?.id) || nonEmptyString(fallbackId)
  if (!sid) return null

  const source = asRecord(session as SessionValue)
  const next: SessionLike = source ? ({ ...source } as SessionLike) : ({ ...(session || {}) } as SessionLike)
  next.id = sid

  const directory = sessionDirectoryFromLike(next)
  if (directory) {
    next.directory = directory
  }
  return next
}

function mergeSidebarSessionLike(
  rowSession: SessionLike | null,
  cacheSession: SessionLike | null,
  sessionId: string,
): SessionLike {
  const sid = nonEmptyString(sessionId)
  const merged: SessionLike = {
    ...((cacheSession || {}) as SessionLike),
    ...((rowSession || {}) as SessionLike),
    id: sid,
  }

  const title = nonEmptyString(rowSession?.title) || nonEmptyString(cacheSession?.title)
  const slug = nonEmptyString(rowSession?.slug) || nonEmptyString(cacheSession?.slug)
  const directory = sessionDirectoryFromLike(rowSession) || sessionDirectoryFromLike(cacheSession)

  if (title) merged.title = title
  if (slug) merged.slug = slug
  if (directory) merged.directory = directory
  return merged
}

function directoryEntryByPath(path: string): DirectoryEntry | null {
  const normalizedPath = normalizeDirForCompare(path)
  if (!normalizedPath) return null
  for (const entry of directories.value) {
    if (!entry?.id || !entry?.path) continue
    if (normalizeDirForCompare(entry.path) === normalizedPath) {
      return entry
    }
  }
  return null
}

function resolveSidebarRow(row: ThreadSessionRow): ThreadSessionRow {
  const sid = nonEmptyString(row?.id)
  if (!sid) return row

  const rowSession = normalizeSidebarSessionLike(row.session || null, sid)
  const cachedSession = normalizeSidebarSessionLike(chat.getSessionById(sid) as SessionLike | null, sid)
  const session = rowSession || cachedSession ? mergeSidebarSessionLike(rowSession, cachedSession, sid) : null
  const sessionDirectory = sessionDirectoryFromLike(session)
  const directory = row.directory || (sessionDirectory ? directoryEntryByPath(sessionDirectory) : null)

  return {
    ...row,
    id: sid,
    session,
    directory,
  }
}

const pagedPinnedSessionRows = computed<ThreadSessionRow[]>(() =>
  ((pinnedFooterView.value.rows || []) as ThreadSessionRow[]).map(resolveSidebarRow),
)
const pagedRecentSessionRows = computed<ThreadSessionRow[]>(() =>
  ((recentFooterView.value.rows || []) as ThreadSessionRow[]).map(resolveSidebarRow),
)
const pagedRunningSessionRows = computed<ThreadSessionRow[]>(() =>
  ((runningFooterView.value.rows || []) as ThreadSessionRow[]).map(resolveSidebarRow),
)
const runningSessionRows = computed<ThreadSessionRow[]>(
  () => buildRunningSessionRows(pagedRunningSessionRows.value, expandedParents.value) as ThreadSessionRow[],
)

watch(
  () => pinnedFooterView.value.page,
  (next) => {
    const resolved = Math.max(0, Math.floor(Number(next || 0)))
    if (pinnedSessionsPage.value !== resolved) pinnedSessionsPage.value = resolved
  },
)

watch(
  () => recentFooterView.value.page,
  (next) => {
    const resolved = Math.max(0, Math.floor(Number(next || 0)))
    if (recentSessionsPage.value !== resolved) recentSessionsPage.value = resolved
  },
)

watch(
  () => runningFooterView.value.page,
  (next) => {
    const resolved = Math.max(0, Math.floor(Number(next || 0)))
    if (runningSessionsPage.value !== resolved) runningSessionsPage.value = resolved
  },
)

async function requestPinnedSessionsOpen(nextOpen: boolean) {
  if (pinnedSessionsOpenUpdating.value) return
  const target = Boolean(nextOpen)
  const previous = pinnedSessionsOpen.value
  if (target === previous) return

  pinnedSessionsOpen.value = target
  pinnedSessionsOpenUpdating.value = true
  try {
    const ok = await directorySessions.commandSetFooterOpen('pinned', target, { silent: true })
    if (!ok) {
      pinnedSessionsOpen.value = previous
      await revalidateSidebarState(undefined, { silent: true })
    }
  } finally {
    pinnedSessionsOpenUpdating.value = false
  }
}

async function requestRecentSessionsOpen(nextOpen: boolean) {
  if (recentSessionsOpenUpdating.value) return
  const target = Boolean(nextOpen)
  const previous = recentSessionsOpen.value
  if (target === previous) return

  recentSessionsOpen.value = target
  recentSessionsOpenUpdating.value = true
  try {
    const ok = await directorySessions.commandSetFooterOpen('recent', target, { silent: true })
    if (!ok) {
      recentSessionsOpen.value = previous
      await revalidateSidebarState(undefined, { silent: true })
    }
  } finally {
    recentSessionsOpenUpdating.value = false
  }
}

async function requestRunningSessionsOpen(nextOpen: boolean) {
  if (runningSessionsOpenUpdating.value) return
  const target = Boolean(nextOpen)
  const previous = runningSessionsOpen.value
  if (target === previous) return

  runningSessionsOpen.value = target
  runningSessionsOpenUpdating.value = true
  try {
    const ok = await directorySessions.commandSetFooterOpen('running', target, { silent: true })
    if (!ok) {
      runningSessionsOpen.value = previous
      await revalidateSidebarState(undefined, { silent: true })
    }
  } finally {
    runningSessionsOpenUpdating.value = false
  }
}

async function requestPinnedSessionsPage(nextPage: number) {
  if (pinnedSessionsPaging.value) return
  const maxPage = Math.max(0, pinnedSessionsPageCount.value - 1)
  const target = Math.max(0, Math.min(maxPage, Math.floor(nextPage || 0)))
  if (target === pinnedSessionsPage.value) return

  pinnedSessionsPaging.value = true
  try {
    const ok = await directorySessions.commandSetFooterPage('pinned', target, { silent: true })
    if (!ok) {
      await revalidateSidebarState(
        {
          directoriesPage: directoryPage.value,
          query: sidebarQueryNorm.value,
          pinnedPage: target,
        },
        { silent: true },
      )
    }
  } finally {
    pinnedSessionsPaging.value = false
  }
}

async function requestRecentSessionsPage(nextPage: number) {
  if (recentSessionsPaging.value) return
  const maxPage = Math.max(0, recentSessionsPageCount.value - 1)
  const target = Math.max(0, Math.min(maxPage, Math.floor(nextPage || 0)))
  if (target === recentSessionsPage.value) return

  recentSessionsPaging.value = true
  try {
    const ok = await directorySessions.commandSetFooterPage('recent', target, { silent: true })
    if (!ok) {
      await revalidateSidebarState(
        {
          directoriesPage: directoryPage.value,
          query: sidebarQueryNorm.value,
          recentPage: target,
        },
        { silent: true },
      )
    }
  } finally {
    recentSessionsPaging.value = false
  }
}

async function requestRunningSessionsPage(nextPage: number) {
  if (runningSessionsPaging.value) return
  const maxPage = Math.max(0, runningSessionsPageCount.value - 1)
  const target = Math.max(0, Math.min(maxPage, Math.floor(nextPage || 0)))
  if (target === runningSessionsPage.value) return

  runningSessionsPaging.value = true
  try {
    const ok = await directorySessions.commandSetFooterPage('running', target, { silent: true })
    if (!ok) {
      await revalidateSidebarState(
        {
          directoriesPage: directoryPage.value,
          query: sidebarQueryNorm.value,
          runningPage: target,
        },
        { silent: true },
      )
    }
  } finally {
    runningSessionsPaging.value = false
  }
}

async function resolveDirectoryForOpenSession(
  sessionId: string,
  row: ThreadSessionRow | null,
): Promise<DirectoryEntry | null> {
  const rowDirectory = row?.directory
  if (rowDirectory?.id && rowDirectory.path) {
    return rowDirectory
  }

  const resolved = await directorySessions
    .resolveDirectoryForSession(sessionId, {
      directoryId: rowDirectory?.id,
      directoryPath: rowDirectory?.path,
    })
    .catch(() => null)
  if (!resolved?.directoryId || !resolved.directoryPath) return null
  return {
    id: resolved.directoryId,
    path: resolved.directoryPath,
  }
}

async function openRunningSession(sessionId: string) {
  const sid = (sessionId || '').trim()
  if (!sid) return
  const row = pagedRunningSessionRows.value.find((item) => item.id === sid) || null
  const directory = await resolveDirectoryForOpenSession(sid, row)
  if (directory?.id && directory?.path) {
    await selectDirectory(directory.id, directory.path)
  }
  await selectSession(sid)
}

async function openPinnedSession(sessionId: string) {
  const sid = (sessionId || '').trim()
  if (!sid) return
  const row = pagedPinnedSessionRows.value.find((item) => item.id === sid) || null
  const directory = await resolveDirectoryForOpenSession(sid, row)
  if (directory?.id && directory?.path) {
    await selectDirectory(directory.id, directory.path)
  }
  await selectSession(sid)
}

async function openRecentSession(sessionId: string) {
  const sid = (sessionId || '').trim()
  if (!sid) return
  const row = pagedRecentSessionRows.value.find((item) => item.id === sid) || null
  const directory = await resolveDirectoryForOpenSession(sid, row)
  if (directory?.id && directory?.path) {
    await selectDirectory(directory.id, directory.path)
  }
  await selectSession(sid)
}

function directoryActivityState(p: DirectoryEntry): DirectoryActivityState {
  const pid = (p.id || '').trim()
  const section = directorySidebarById.value[pid]
  if (!section) return null

  const hasRunning = section.hasRunningSessions === true
  const hasBlocked = section.hasBlockedSessions === true
  if (hasRunning && hasBlocked) return 'mixed'
  if (hasBlocked) return 'blocked'
  if (hasRunning || section.hasActiveOrBlocked === true) return 'running'
  return null
}

async function ensureDirectorySidebarLoaded(
  directoryId: string,
  directoryPath: string,
  opts?: { force?: boolean; focusSessionId?: string; page?: number; pageSize?: number; includeWorktrees?: boolean },
): Promise<{ directoryId: string; directoryPath: string } | null> {
  const pid = (directoryId || '').trim()
  const root = (directoryPath || '').trim()

  const focusSessionId = String(opts?.focusSessionId || '').trim()

  if (focusSessionId) {
    const ok = await revalidateSidebarState({ focusSessionId }, { silent: true })
    if (!ok) return null

    const focused = directorySessions.sidebarStateFocus
    if (focused && focused.sessionId === focusSessionId) {
      return {
        directoryId: focused.directoryId,
        directoryPath: focused.directoryPath,
      }
    }

    const resolved = await directorySessions.resolveDirectoryForSession(focusSessionId, {
      directoryId: pid,
      directoryPath: root,
      skipRemote: true,
    })
    if (resolved) {
      return {
        directoryId: resolved.directoryId,
        directoryPath: resolved.directoryPath,
      }
    }

    if (pid && root) {
      return {
        directoryId: pid,
        directoryPath: root,
      }
    }
    return null
  }

  if (!pid || !root) return null

  const targetPage =
    typeof opts?.page === 'number' && Number.isFinite(opts.page)
      ? Math.max(0, Math.floor(opts.page))
      : sessionRootPage(pid)
  const boundedTargetPage = directorySessions.setSessionRootPage(pid, targetPage, SESSION_ROOTS_PAGE_SIZE)
  const commandOk = await directorySessions.commandSetDirectoryRootPage(pid, boundedTargetPage, { silent: true })
  if (!commandOk) {
    const ok = await revalidateSidebarState(undefined, { silent: true })
    if (!ok) return null
  }
  return {
    directoryId: pid,
    directoryPath: root,
  }
}

onBeforeUnmount(() => {
  if (sidebarStateFetchTimer !== null) {
    window.clearTimeout(sidebarStateFetchTimer)
    sidebarStateFetchTimer = null
  }
  flattenedTreeCacheByDirectoryId.clear()
})

async function selectDirectory(directoryId: string, directoryPath: string) {
  void directoryId
  dismissDeepLinkFocus()
  directoryStore.setDirectory(directoryPath)
}

async function focusDirectoryContext(directoryId: string, directoryPath: string) {
  const pid = (directoryId || '').trim()
  const root = (directoryPath || '').trim()
  void pid
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
      void revalidateSidebarState(undefined, { silent: true })

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

  const resolved = await directorySessions.resolveDirectoryForSession(sid).catch(() => null)
  const directory = resolved?.locatedDir || resolved?.directoryPath || null

  await chat.deleteSession(sid, { directory })

  void revalidateSidebarState(undefined, { silent: true })
}

async function addDirectoryEntry() {
  const p = newDirectoryPath.value.trim()
  if (!p) return
  await settings.addProject(p)
  newDirectoryPath.value = ''
  isAddDirectoryOpen.value = false
  await revalidateSidebarState(undefined, { silent: true })
}

async function removeDirectoryEntry(directoryId: string) {
  await settings.removeProject(directoryId)
  await revalidateSidebarState(undefined, { silent: true })
}

const isDirectoryFocused = (directory: DirectoryEntry) => {
  const dir = (directoryStore.currentDirectory || '').trim()
  if (!dir || !directory?.path) return false
  return dir === directory.path
}

type FlattenedDirectoryTree = {
  rows: FlatTreeRow[]
  parentById: Record<string, string | null>
  rootIds: string[]
}

type SidebarSearchHit = { directory: DirectoryEntry; session: SessionLike }

async function searchSessionHits(query: string, limit: number, signal?: AbortSignal): Promise<SidebarSearchHit[]> {
  const q = (query || '').trim()
  if (!q || limit <= 0) return []
  try {
    const payload = await apiJson<SessionValue>(
      `/api/chat-sidebar/search?query=${encodeURIComponent(q)}&limit=${encodeURIComponent(String(Math.max(1, Math.floor(limit))))}`,
      signal ? { signal } : undefined,
    )
    const record = asRecord(payload)
    const items = Array.isArray(record?.items) ? record.items : []
    const out: SidebarSearchHit[] = []
    for (const item of items) {
      const row = asRecord(item)
      const directoryRecord = asRecord(row?.directory)
      const sessionRecord = asRecord(row?.session)
      const directoryId = typeof directoryRecord?.id === 'string' ? directoryRecord.id.trim() : ''
      const directoryPath = typeof directoryRecord?.path === 'string' ? directoryRecord.path.trim() : ''
      const sessionId = readSessionId(sessionRecord)
      if (!directoryId || !directoryPath || !sessionId) continue
      out.push({
        directory: {
          id: directoryId,
          path: directoryPath,
        },
        session: {
          ...(sessionRecord as SessionLike),
          id: sessionId,
        },
      })
      if (out.length >= limit) break
    }
    return out
  } catch (err) {
    if (isAbortError(err)) throw err
    return []
  }
}

// Tree helpers extracted to '@/features/sessions/model/tree'.

async function toggleExpandedParent(sessionId: string) {
  const id = (sessionId || '').trim()
  if (!id) return
  if (expandCommandPendingIds.value.has(id)) return

  const nextExpanded = !expandedParents.value.has(id)
  const pendingTargets = new Map(expandCommandPendingTargets.value)
  pendingTargets.set(id, nextExpanded)
  expandCommandPendingTargets.value = pendingTargets
  applyUiPrefsToLocal(directorySessions.uiPrefs)

  const pending = new Set(expandCommandPendingIds.value)
  pending.add(id)
  expandCommandPendingIds.value = pending

  let commandOk = false
  try {
    commandOk = await directorySessions.commandSetSessionExpanded(id, nextExpanded, { silent: true })
  } finally {
    const next = new Set(expandCommandPendingIds.value)
    next.delete(id)
    expandCommandPendingIds.value = next
  }

  if (commandOk) return

  const revertTargets = new Map(expandCommandPendingTargets.value)
  if (revertTargets.delete(id)) {
    expandCommandPendingTargets.value = revertTargets
    applyUiPrefsToLocal(directorySessions.uiPrefs)
  }
  await revalidateSidebarState(undefined, { silent: true })
}

function ensureAncestorsExpanded(parentById: Record<string, string | null>, sessionId: string) {
  const sid = (sessionId || '').trim()
  if (!sid) return

  const toExpand: string[] = []
  const seen = new Set<string>()
  let cur: string | null = sid
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const parent: string | null = parentById[cur] || null
    if (!parent) break
    if (!expandedParents.value.has(parent)) {
      toExpand.push(parent)
    }
    cur = parent
  }
  for (const parentId of toExpand) {
    void directorySessions.commandSetSessionExpanded(parentId, true, { silent: true })
  }
}

function buildBackendFlattenedTree(section: DirectorySidebarView | null | undefined): FlattenedDirectoryTree | null {
  if (!section || !Array.isArray(section.recentRows)) return null

  const rows: FlatTreeRow[] = section.recentRows
    .map((row) => {
      const sid = String(row?.id || '').trim()
      if (!sid) return null
      const resolved = resolveSidebarRow(row)
      return {
        id: sid,
        session: resolved.session || ({ id: sid } as SessionLike),
        depth: Number.isFinite(Number(row?.depth)) ? Math.max(0, Math.floor(Number(row.depth))) : 0,
        isParent: row.isParent,
        isExpanded: row.isExpanded,
        rootId: String(row.rootId || sid).trim() || sid,
      }
    })
    .filter((row): row is FlatTreeRow => Boolean(row))

  const parentById = { ...(section.recentParentById || {}) }
  const rootIds = Array.isArray(section.recentRootIds)
    ? section.recentRootIds.map((value) => String(value || '').trim()).filter(Boolean)
    : []

  return {
    rows,
    parentById,
    rootIds,
  }
}

function flattenedTreeForDirectory(directoryId: string, _directoryPath?: string): FlattenedDirectoryTree | null {
  void _directoryPath
  const pid = (directoryId || '').trim()
  if (!pid) return null

  const section = directorySidebarById.value[pid] || null
  const cached = flattenedTreeCacheByDirectoryId.get(pid)
  if (cached && cached.section === section) {
    return cached.tree
  }

  const tree = buildBackendFlattenedTree(section)
  flattenedTreeCacheByDirectoryId.set(pid, { section, tree })
  return tree
}

function sessionCountForDirectory(directoryId: string, directoryPath: string): number {
  void directoryPath
  const pid = (directoryId || '').trim()
  const section = directorySidebarById.value[pid]
  if (section && Number.isFinite(section.sessionCount)) {
    return Math.max(0, Math.floor(section.sessionCount))
  }
  return 0
}

function pinnedRowsForDirectory(directoryId: string): ThreadSessionRow[] {
  const pid = (directoryId || '').trim()
  if (!pid) return []
  const section = directorySidebarById.value[pid]
  if (section && Array.isArray(section.pinnedRows)) return section.pinnedRows
  return []
}

function sessionRootPage(directoryId: string): number {
  const pid = (directoryId || '').trim()
  const section = directorySidebarById.value[pid]
  if (!section || !Number.isFinite(section.rootPage)) return 0
  return Math.max(0, Math.floor(section.rootPage))
}

function sessionRootPageCount(directoryId: string): number {
  const pid = (directoryId || '').trim()
  const section = directorySidebarById.value[pid]
  if (!section || !Number.isFinite(section.rootPageCount)) return 1
  return Math.max(1, Math.floor(section.rootPageCount))
}

async function setSessionRootPage(directoryId: string, page: number) {
  const pid = (directoryId || '').trim()
  if (!pid) return
  const current = sessionRootPage(pid)
  const next = directorySessions.setSessionRootPage(pid, page, SESSION_ROOTS_PAGE_SIZE)
  if (current === next) return

  const ok = await directorySessions.commandSetDirectoryRootPage(pid, next, { silent: true })
  if (!ok) {
    await revalidateSidebarState(undefined, { silent: true })
  }
}

function pagedRowsForDirectory(directoryId: string): FlatTreeRow[] {
  const pid = (directoryId || '').trim()
  const tree = flattenedTreeForDirectory(pid)
  if (!tree) return []
  return tree.rows || []
}

const { locatedSessionId, locateFromSearch, searchWarming, sessionSearchHits, setSessionEl } = useSidebarLocate({
  ui,
  directories,
  collapsedDirectoryIds: collapsedDirectories,
  pinnedSessionIds,
  sidebarQuery,
  sidebarQueryNorm,
  searchSessionHits,
  ensureDirectorySidebarLoaded,
  resolveDirectoryForSession: directorySessions.resolveDirectoryForSession,
  getFlattenedTreeForDirectory: flattenedTreeForDirectory,
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
        :query="sidebarQueryDraft"
        :is-mobile-pointer="ui.isMobilePointer"
        @update:query="(v) => (sidebarQueryDraft = v)"
        @submit-query="submitSidebarQuery"
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
          :directoryPageLoading="directoryPageLoading"
          :isDirectoryCollapsed="isDirectoryCollapsed"
          :isDirectoryExpandLoading="isDirectoryExpandLoading"
          :toggleDirectoryCollapse="toggleDirectoryCollapse"
          :isDirectoryFocused="isDirectoryFocused"
          :directoryActivityState="directoryActivityState"
          :openDirectoryActions="openDirectoryActions"
          :refreshDirectoryInline="refreshDirectoryInline"
          :newSessionInline="newSessionInline"
          :removeDirectoryInline="removeDirectoryInline"
          :sessionCountForDirectory="sessionCountForDirectory"
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
          :open="pinnedSessionsOpen"
          :page="pinnedSessionsPage"
          :paging="pinnedSessionsPaging"
          :loading="pinnedFooterLoading"
          :pinnedSessionRows="pagedPinnedSessionRows"
          :pinnedSessionsTotal="pinnedSessionsTotal"
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
          @update:open="(v) => void requestPinnedSessionsOpen(v)"
          @update:page="(v) => void requestPinnedSessionsPage(v)"
          @open-session="openPinnedSession"
          @toggle-thread="toggleExpandedParent"
        />

        <RecentSessionsFooter
          :open="recentSessionsOpen"
          :page="recentSessionsPage"
          :paging="recentSessionsPaging"
          :loading="recentFooterLoading"
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
          @update:open="(v) => void requestRecentSessionsOpen(v)"
          @update:page="(v) => void requestRecentSessionsPage(v)"
          @open-session="openRecentSession"
          @toggle-thread="toggleExpandedParent"
        />

        <RunningSessionsFooter
          :open="runningSessionsOpen"
          :page="runningSessionsPage"
          :paging="runningSessionsPaging"
          :loading="runningFooterLoading"
          :runningSessionRows="runningSessionRows"
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
          @update:open="(v) => void requestRunningSessionsOpen(v)"
          @update:page="(v) => void requestRunningSessionsPage(v)"
          @toggle-thread="toggleExpandedParent"
        />
      </div>
    </div>
  </div>
</template>

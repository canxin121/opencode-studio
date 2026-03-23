<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiEditLine,
  RiListCheck3,
  RiLoader4Line,
  RiPlayLine,
  RiPencilLine,
  RiRefreshLine,
  RiStopLine,
} from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import IconButton from '@/components/ui/IconButton.vue'
import Input from '@/components/ui/Input.vue'
import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import ListItemOverflowActionButton from '@/components/ui/ListItemOverflowActionButton.vue'
import ListItemSelectionIndicator from '@/components/ui/ListItemSelectionIndicator.vue'
import OptionMenu from '@/components/ui/OptionMenu.vue'
import type { OptionMenuGroup, OptionMenuItem } from '@/components/ui/optionMenu.types'
import SearchInput from '@/components/ui/SearchInput.vue'
import SidebarListItem from '@/components/ui/SidebarListItem.vue'
import { useUnifiedMultiSelect } from '@/composables/useUnifiedMultiSelect'
import type { WorkspacePreviewSession } from '@/features/workspacePreview/api/workspacePreviewApi'
import { buildPreviewFrameSrc } from '@/features/workspacePreview/model/previewUrl'
import { normalizeDirForCompare } from '@/features/sessions/model/labels'
import SidebarPager from '@/layout/chatSidebar/components/SidebarPager.vue'
import SidebarSectionSkeleton from '@/layout/chatSidebar/components/SidebarSectionSkeleton.vue'
import { apiUrl } from '@/lib/api'
import { useChatStore } from '@/stores/chat'
import { useDirectoryStore } from '@/stores/directory'
import { useToastsStore } from '@/stores/toasts'
import { useUiStore } from '@/stores/ui'
import { useWorkspacePreviewStore } from '@/stores/workspacePreview'

const { t } = useI18n()
const ui = useUiStore()
const toasts = useToastsStore()
const chat = useChatStore()
const preview = useWorkspacePreviewStore()
const directoryStore = useDirectoryStore()

const currentDirectory = computed(() => String(directoryStore.currentDirectory || '').trim())
const currentChatSessionId = computed(() => String(chat.selectedSessionId || '').trim())
const currentDirectoryNorm = computed(() => normalizeDirForCompare(currentDirectory.value))
const sidebarQueryNorm = computed(() =>
  String(preview.sidebarQuery || '')
    .trim()
    .toLowerCase(),
)

const createDialogOpen = ref(false)
const createPreviewId = ref('')
const createRunDirectory = ref('')
const createCommand = ref('')
const createArgsText = ref('')
const createLogsPath = ref('')
const createTargetUrl = ref('')
const actionLoading = ref(false)
const actionError = ref('')

const editDialogOpen = ref(false)
const editSessionId = ref('')
const editTargetUrl = ref('')
const editBusy = ref(false)
const editError = ref('')

const rowMenuOpen = ref(false)
const rowMenuSessionId = ref('')
const rowMenuAnchorEl = ref<HTMLElement | null>(null)

type PreviewSidebarScope = 'chat' | 'directory' | 'all'
const rowMenuScope = ref<PreviewSidebarScope>('directory')

const renamingSessionId = ref('')
const renamingScope = ref<PreviewSidebarScope>('directory')
const renameDialogOpen = ref(false)
const renameDraft = ref('')
const renameBusy = ref(false)
const renameError = ref('')
const renameInputEl = ref<HTMLInputElement | null>(null)

const renameDraftNorm = computed(() => String(renameDraft.value || '').trim())
const renameDraftValid = computed(() => /^[A-Za-z0-9_-]+$/.test(renameDraftNorm.value))
const canSaveRename = computed(() => !renameBusy.value && renameDraftNorm.value.length > 0 && renameDraftValid.value)

const rowMenuSession = computed(
  () => previewSessions.value.find((session) => session.id === rowMenuSessionId.value) || null,
)

type SessionHealthState = 'unknown' | 'checking' | 'ok' | 'error'
type SessionHealthEntry = { state: SessionHealthState; checkedAt: number }

const HEALTH_TTL_MS = 15_000
const HEALTH_POLL_MS = 15_000
const HEALTH_TIMEOUT_MS = 3_500

const healthBySessionId = ref<Record<string, SessionHealthEntry>>({})
const healthInFlight = new Set<string>()
const healthControllers = new Map<string, AbortController>()
let healthPollTimer: number | null = null

const createPreviewIdNorm = computed(() => String(createPreviewId.value || '').trim())
const createPreviewIdValid = computed(() => /^[A-Za-z0-9_-]+$/.test(createPreviewIdNorm.value))
const createRunDirectoryNorm = computed(() => String(createRunDirectory.value || '').trim())
const createCommandNorm = computed(() => String(createCommand.value || '').trim())
const createArgsList = computed(() =>
  String(createArgsText.value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean),
)
const createLogsPathNorm = computed(() => String(createLogsPath.value || '').trim())

const previewSessions = computed<WorkspacePreviewSession[]>(() =>
  Array.isArray(preview.sessions) ? preview.sessions : [],
)
const previewFilteredSessions = computed<WorkspacePreviewSession[]>(() =>
  Array.isArray(preview.filteredSessions) ? preview.filteredSessions : [],
)

const previewMultiSelect = useUnifiedMultiSelect()
const allPreviewSessionIds = computed(() => {
  const ids = new Set<string>()
  for (const session of previewSessions.value) {
    const id = String(session.id || '').trim()
    if (id) ids.add(id)
  }
  return Array.from(ids)
})

const filteredPreviewSessionIds = computed(() => {
  const ids = new Set<string>()
  for (const session of previewFilteredSessions.value) {
    const id = String(session.id || '').trim()
    if (id) ids.add(id)
  }
  return Array.from(ids)
})

function normalizeSessionState(input: unknown): string {
  return String(input || '')
    .trim()
    .toLowerCase()
}

function sessionStateLooksError(state: unknown): boolean {
  const s = normalizeSessionState(state)
  return s === 'error' || s === 'failed' || s === 'crashed'
}

function setSessionHealth(sessionId: string, entry: SessionHealthEntry) {
  healthBySessionId.value = {
    ...healthBySessionId.value,
    [sessionId]: entry,
  }
}

function clearSessionHealth(sessionId?: string) {
  if (!sessionId) {
    for (const controller of healthControllers.values()) {
      try {
        controller.abort()
      } catch {
        // ignore
      }
    }
    healthControllers.clear()
    healthInFlight.clear()
    healthBySessionId.value = {}
    return
  }

  const controller = healthControllers.get(sessionId)
  if (controller) {
    try {
      controller.abort()
    } catch {
      // ignore
    }
    healthControllers.delete(sessionId)
  }
  healthInFlight.delete(sessionId)

  const { [sessionId]: _removed, ...rest } = healthBySessionId.value
  healthBySessionId.value = rest
}

function sessionHealthState(sessionId: string): SessionHealthState {
  const entry = healthBySessionId.value[sessionId]
  return entry?.state || 'unknown'
}

function sessionHealthLabel(state: SessionHealthState): string {
  if (state === 'ok') return String(t('header.status.online'))
  if (state === 'error') return String(t('header.status.offline'))
  if (state === 'checking') return String(t('workspaceDock.loading'))
  return String(t('common.unknown'))
}

function sessionDotClass(session: WorkspacePreviewSession): string {
  const state = normalizeSessionState(session.state)
  if (state === 'stopped' || state === 'idle') return 'bg-muted-foreground/50'
  if (state === 'starting' || state === 'building') return 'bg-muted-foreground/60 animate-pulse'

  const health = sessionHealthState(session.id)
  if (health === 'ok') return 'bg-primary'
  if (health === 'error') return 'bg-destructive'
  if (sessionStateLooksError(session.state)) return 'bg-destructive'
  if (health === 'checking') return 'bg-muted-foreground/60 animate-pulse'
  return 'bg-muted-foreground/40'
}

function sessionDotLabel(session: WorkspacePreviewSession): string {
  const health = sessionHealthState(session.id)
  if (health === 'unknown' && sessionStateLooksError(session.state)) return String(t('header.status.offline'))
  return sessionHealthLabel(health)
}

async function probeSessionHealth(session: WorkspacePreviewSession) {
  const sessionId = String(session.id || '').trim()
  if (!sessionId) return
  const state = normalizeSessionState(session.state)
  if (state === 'stopped' || state === 'idle') return
  if (preview.loading) return
  if (healthInFlight.has(sessionId)) return

  const now = Date.now()
  const prev = healthBySessionId.value[sessionId]
  if (prev && now - prev.checkedAt < HEALTH_TTL_MS && (prev.state === 'ok' || prev.state === 'error')) {
    return
  }

  const prevController = healthControllers.get(sessionId)
  if (prevController) {
    try {
      prevController.abort()
    } catch {
      // ignore
    }
  }

  const controller = new AbortController()
  healthControllers.set(sessionId, controller)
  healthInFlight.add(sessionId)
  setSessionHealth(sessionId, { state: 'checking', checkedAt: now })

  const timeoutId = window.setTimeout(() => {
    try {
      controller.abort()
    } catch {
      // ignore
    }
  }, HEALTH_TIMEOUT_MS)

  try {
    const src = buildPreviewFrameSrc(session.proxyBasePath, now)
    if (!src) {
      setSessionHealth(sessionId, { state: 'error', checkedAt: Date.now() })
      return
    }

    const resp = await fetch(apiUrl(src), {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      },
    })
    const ok = resp.ok || resp.status === 304
    setSessionHealth(sessionId, { state: ok ? 'ok' : 'error', checkedAt: Date.now() })
  } catch {
    setSessionHealth(sessionId, { state: 'error', checkedAt: Date.now() })
  } finally {
    window.clearTimeout(timeoutId)
    healthInFlight.delete(sessionId)
    if (healthControllers.get(sessionId) === controller) healthControllers.delete(sessionId)
  }
}

const SECTION_PAGE_SIZE = 4

const chatSectionOpen = ref(Boolean(currentChatSessionId.value))
const chatSectionPage = ref(0)
const directorySectionOpen = ref(true)
const directorySectionPage = ref(0)
const allSectionOpen = ref(false)
const allSectionPage = ref(0)

function clampPage(page: number, pageCount: number): number {
  const max = Math.max(0, Math.floor(pageCount || 1) - 1)
  return Math.max(0, Math.min(max, Math.floor(page || 0)))
}

const chatSessionsAll = computed(() => {
  const sid = currentChatSessionId.value
  if (!sid) return []
  return previewSessions.value.filter((session) => String(session.opencodeSessionId || '').trim() === sid)
})

const chatSessionsFiltered = computed(() => {
  const sid = currentChatSessionId.value
  if (!sid) return []
  return previewFilteredSessions.value.filter((session) => String(session.opencodeSessionId || '').trim() === sid)
})

const directorySessionsAll = computed(() => {
  const dir = currentDirectoryNorm.value
  if (!dir) return []
  return previewSessions.value.filter((session) => normalizeDirForCompare(session.directory) === dir)
})

const directorySessionsFiltered = computed(() => {
  const dir = currentDirectoryNorm.value
  if (!dir) return []
  return previewFilteredSessions.value.filter((session) => normalizeDirForCompare(session.directory) === dir)
})

const allSessionsAll = computed(() => previewSessions.value)
const allSessionsFiltered = computed(() => previewFilteredSessions.value)

const chatCount = computed(() => Math.max(0, chatSessionsFiltered.value.length))
const directoryCount = computed(() => Math.max(0, directorySessionsFiltered.value.length))
const allCount = computed(() => Math.max(0, allSessionsFiltered.value.length))

const chatPageCount = computed(() => Math.max(1, Math.ceil(chatCount.value / SECTION_PAGE_SIZE)))
const directoryPageCount = computed(() => Math.max(1, Math.ceil(directoryCount.value / SECTION_PAGE_SIZE)))
const allPageCount = computed(() => Math.max(1, Math.ceil(allCount.value / SECTION_PAGE_SIZE)))

const chatPageClamped = computed(() => clampPage(chatSectionPage.value, chatPageCount.value))
const directoryPageClamped = computed(() => clampPage(directorySectionPage.value, directoryPageCount.value))
const allPageClamped = computed(() => clampPage(allSectionPage.value, allPageCount.value))

const pagedChatSessions = computed(() => {
  const start = chatPageClamped.value * SECTION_PAGE_SIZE
  return chatSessionsFiltered.value.slice(start, start + SECTION_PAGE_SIZE)
})

const pagedDirectorySessions = computed(() => {
  const start = directoryPageClamped.value * SECTION_PAGE_SIZE
  return directorySessionsFiltered.value.slice(start, start + SECTION_PAGE_SIZE)
})

const pagedAllSessions = computed(() => {
  const start = allPageClamped.value * SECTION_PAGE_SIZE
  return allSessionsFiltered.value.slice(start, start + SECTION_PAGE_SIZE)
})

const visibleSessionsForHealth = computed(() => {
  const dedupe = new Set<string>()
  const out: WorkspacePreviewSession[] = []

  function push(session: WorkspacePreviewSession) {
    if (!session?.id) return
    if (dedupe.has(session.id)) return
    dedupe.add(session.id)
    out.push(session)
  }

  if (chatSectionOpen.value) {
    for (const session of pagedChatSessions.value) push(session)
  }
  if (directorySectionOpen.value) {
    for (const session of pagedDirectorySessions.value) push(session)
  }
  if (allSectionOpen.value) {
    for (const session of pagedAllSessions.value) push(session)
  }

  return out
})

const visibleSessionIdKey = computed(() => visibleSessionsForHealth.value.map((session) => session.id).join('|'))

function probeVisibleSessions() {
  if (preview.loading) return
  for (const session of visibleSessionsForHealth.value) {
    void probeSessionHealth(session)
  }
}

function canEditTargetUrl(session: WorkspacePreviewSession | null | undefined): boolean {
  return Boolean(String(session?.targetUrl || '').trim())
}

function isSessionRunning(session: WorkspacePreviewSession | null | undefined): boolean {
  if (!session) return false
  const s = normalizeSessionState(session.state)
  if (s === 'running') return true
  return Boolean((session as { pid?: unknown }).pid)
}

const rowMenuGroups = computed<OptionMenuGroup[]>(() => {
  const session = rowMenuSession.value
  if (!session) return []

  const canEditUrl = canEditTargetUrl(session)
  const running = isSessionRunning(session)
  return [
    {
      id: 'preview-session-actions',
      items: [
        ...(running
          ? [
              {
                id: 'stop',
                label: String(t('workspaceDock.preview.sidebar.actions.stop')),
                description: String(t('workspaceDock.preview.sidebar.actions.stopDescription')),
                icon: RiStopLine,
              },
            ]
          : [
              {
                id: 'start',
                label: String(t('workspaceDock.preview.sidebar.actions.start')),
                description: String(t('workspaceDock.preview.sidebar.actions.startDescription')),
                icon: RiPlayLine,
              },
            ]),
        {
          id: 'rename',
          label: String(t('workspaceDock.preview.sidebar.actions.rename')),
          description: String(t('workspaceDock.preview.sidebar.actions.renameDescription')),
          icon: RiEditLine,
        },
        {
          id: 'edit-url',
          label: String(t('workspaceDock.preview.sidebar.actions.editUrl')),
          description: canEditUrl
            ? String(t('workspaceDock.preview.sidebar.actions.editUrlDescription'))
            : String(t('workspaceDock.preview.sidebar.actions.editUrlUnavailable')),
          icon: RiPencilLine,
          disabled: !canEditUrl,
        },
        {
          id: 'delete',
          label: String(t('common.delete')),
          description: String(t('workspaceDock.preview.sidebar.actions.deleteDescription')),
          icon: RiDeleteBinLine,
          variant: 'destructive',
          confirmTitle: String(t('workspaceDock.preview.sidebar.actions.deleteConfirmTitle')),
          confirmDescription: String(t('workspaceDock.preview.sidebar.actions.deleteConfirmDescription')),
          confirmText: String(t('common.delete')),
          cancelText: String(t('common.cancel')),
        },
      ],
    },
  ]
})

async function refreshSessions(opts?: { forceFrameReload?: boolean }) {
  clearSessionHealth()
  await preview.refreshSessions()
  if (opts?.forceFrameReload) preview.bumpRefreshToken()
  probeVisibleSessions()
}

function openCreateDialog() {
  actionError.value = ''
  const suggestedId = createPreviewIdNorm.value || suggestPreviewIdFromDirectory(currentDirectory.value)
  if (!createPreviewIdNorm.value) {
    createPreviewId.value = suggestedId
  }
  if (!createRunDirectoryNorm.value) {
    createRunDirectory.value = currentDirectory.value
  }
  if (!createLogsPathNorm.value) {
    createLogsPath.value = suggestLogsPath(suggestedId)
  }
  createDialogOpen.value = true
}

function suggestPreviewIdFromDirectory(directory: string): string {
  const trimmed = String(directory || '')
    .trim()
    .replace(/[\\/]+$/, '')
  if (!trimmed) return ''
  const parts = trimmed.split(/[\\/]/).filter(Boolean)
  const base = String(parts[parts.length - 1] || '').trim()
  if (!base) return ''
  const normalized = base
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
  return normalized
}

function suggestLogsPath(sessionId: string): string {
  const clean = String(sessionId || '').trim() || 'preview'
  return `.opencode/preview/${clean}.log`
}

async function createManagedSession() {
  if (!currentDirectory.value.trim()) {
    actionError.value = String(t('workspaceDock.preview.emptyState.directoryRequired'))
    return
  }

  if (!createPreviewIdNorm.value) {
    actionError.value = String(t('workspaceDock.preview.emptyState.sessionIdRequired'))
    return
  }
  if (!createPreviewIdValid.value) {
    actionError.value = String(t('workspaceDock.preview.emptyState.sessionIdInvalid'))
    return
  }

  if (!createRunDirectoryNorm.value) {
    actionError.value = String(t('workspaceDock.preview.emptyState.runDirectoryRequired'))
    return
  }

  if (!createCommandNorm.value) {
    actionError.value = String(t('workspaceDock.preview.emptyState.commandRequired'))
    return
  }

  if (createArgsList.value.length === 0) {
    actionError.value = String(t('workspaceDock.preview.emptyState.argsRequired'))
    return
  }

  if (!createLogsPathNorm.value) {
    actionError.value = String(t('workspaceDock.preview.emptyState.logsPathRequired'))
    return
  }

  const targetUrl = createTargetUrl.value.trim()
  if (!targetUrl) {
    actionError.value = String(t('workspaceDock.preview.emptyState.targetUrlRequired'))
    return
  }

  actionLoading.value = true
  actionError.value = ''
  try {
    await preview.createSession({
      id: createPreviewIdNorm.value,
      directory: currentDirectory.value,
      runDirectory: createRunDirectoryNorm.value,
      command: createCommandNorm.value,
      args: createArgsList.value,
      logsPath: createLogsPathNorm.value,
      targetUrl,
      select: true,
    })
    createPreviewId.value = ''
    createRunDirectory.value = ''
    createCommand.value = ''
    createArgsText.value = ''
    createLogsPath.value = ''
    createTargetUrl.value = ''
    createDialogOpen.value = false
    clearSessionHealth()
    probeVisibleSessions()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    actionError.value = String(t('workspaceDock.preview.emptyState.createFailed', { detail }))
  } finally {
    actionLoading.value = false
  }
}

function isRenamingSession(session: WorkspacePreviewSession, scope: PreviewSidebarScope): boolean {
  return renamingSessionId.value === session.id && renamingScope.value === scope
}

function isInlineRenameSession(session: WorkspacePreviewSession, scope: PreviewSidebarScope): boolean {
  return !ui.isCompactLayout && isRenamingSession(session, scope)
}

function startRenameSession(sessionId: string, scope: PreviewSidebarScope) {
  const session = previewSessions.value.find((item) => item.id === sessionId)
  if (!session) return

  renamingSessionId.value = session.id
  renamingScope.value = scope
  renameDraft.value = session.id
  renameBusy.value = false
  renameError.value = ''

  if (scope === 'chat') chatSectionOpen.value = true
  if (scope === 'directory') directorySectionOpen.value = true
  if (scope === 'all') allSectionOpen.value = true

  if (ui.isCompactLayout) {
    renameDialogOpen.value = true
  }
}

function cancelRenameSession() {
  renamingSessionId.value = ''
  renameDraft.value = ''
  renameBusy.value = false
  renameError.value = ''
  renameDialogOpen.value = false
}

async function saveRenameSession() {
  const sessionId = String(renamingSessionId.value || '').trim()
  if (!sessionId) return

  if (!renameDraftNorm.value) {
    renameError.value = String(t('workspaceDock.preview.emptyState.sessionIdRequired'))
    return
  }
  if (!renameDraftValid.value) {
    renameError.value = String(t('workspaceDock.preview.emptyState.sessionIdInvalid'))
    return
  }

  renameBusy.value = true
  renameError.value = ''
  try {
    const updated = await preview.renameSession(sessionId, renameDraftNorm.value)
    cancelRenameSession()
    clearSessionHealth(sessionId)
    clearSessionHealth(updated.id)
    probeVisibleSessions()
  } catch (err) {
    renameError.value = err instanceof Error ? err.message : String(err)
  } finally {
    renameBusy.value = false
  }
}

function onRenameDraftInput(event: Event) {
  const target = event.target as HTMLInputElement | null
  renameDraft.value = target?.value || ''
}

watch(
  () => ({ id: renamingSessionId.value, scope: renamingScope.value, isCompactLayout: ui.isCompactLayout }),
  (next) => {
    if (!next.id) return
    if (next.isCompactLayout) return
    void nextTick(() => {
      const el = renameInputEl.value
      if (!el) return
      el.focus()
      el.select()
    })
  },
)

function openRowMenu(sessionId: string, scope: PreviewSidebarScope, event: MouseEvent) {
  rowMenuSessionId.value = sessionId
  rowMenuScope.value = scope
  rowMenuAnchorEl.value = event.currentTarget as HTMLElement | null
  rowMenuOpen.value = true
}

function setRowMenuOpen(next: boolean) {
  rowMenuOpen.value = Boolean(next)
  if (!rowMenuOpen.value) {
    rowMenuSessionId.value = ''
    rowMenuAnchorEl.value = null
    rowMenuScope.value = 'directory'
  }
}

function openEditDialog(sessionId: string) {
  const session = previewSessions.value.find((item) => item.id === sessionId)
  if (!session) return
  if (!canEditTargetUrl(session)) return

  editError.value = ''
  editSessionId.value = session.id
  editTargetUrl.value = String(session.targetUrl || '').trim()
  editDialogOpen.value = true
}

async function saveEditDialog() {
  const sessionId = String(editSessionId.value || '').trim()
  const targetUrl = String(editTargetUrl.value || '').trim()
  if (!sessionId || !targetUrl) return

  editBusy.value = true
  editError.value = ''
  try {
    await preview.updateSession(sessionId, { targetUrl })
    editDialogOpen.value = false
    clearSessionHealth(sessionId)
    probeVisibleSessions()
  } catch (err) {
    editError.value = err instanceof Error ? err.message : String(err)
  } finally {
    editBusy.value = false
  }
}

async function onRowMenuSelect(item: OptionMenuItem) {
  const session = rowMenuSession.value
  if (!session) return

  if (item.id === 'start') {
    setRowMenuOpen(false)
    try {
      await preview.startSession(session.id)
      clearSessionHealth(session.id)
      probeVisibleSessions()
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      toasts.push('error', String(t('workspaceDock.preview.sidebar.actions.startFailed', { detail })), 4500)
    }
    return
  }

  if (item.id === 'stop') {
    setRowMenuOpen(false)
    try {
      await preview.stopSession(session.id)
      clearSessionHealth(session.id)
      probeVisibleSessions()
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      toasts.push('error', String(t('workspaceDock.preview.sidebar.actions.stopFailed', { detail })), 4500)
    }
    return
  }

  if (item.id === 'rename') {
    const scope = rowMenuScope.value
    setRowMenuOpen(false)
    startRenameSession(session.id, scope)
    return
  }

  if (item.id === 'edit-url') {
    setRowMenuOpen(false)
    openEditDialog(session.id)
    return
  }

  if (item.id === 'delete') {
    setRowMenuOpen(false)
    await deletePreviewSessionById(session.id)
  }
}

function togglePreviewMultiSelectMode() {
  const next = !previewMultiSelect.enabled.value
  if (next) {
    cancelRenameSession()
    setRowMenuOpen(false)
  }
  previewMultiSelect.setEnabled(next)
}

function handlePreviewSessionRowClick(
  session: WorkspacePreviewSession,
  scope: PreviewSidebarScope,
  event?: MouseEvent,
) {
  if (isInlineRenameSession(session, scope)) return
  if (previewMultiSelect.enabled.value) {
    previewMultiSelect.selectByInteraction(session.id, filteredPreviewSessionIds.value, event)
    return
  }
  selectSession(session.id)
}

function selectAllPreviewSessions() {
  if (!previewMultiSelect.enabled.value) return
  previewMultiSelect.selectAll(filteredPreviewSessionIds.value)
}

function invertPreviewSessionsSelection() {
  if (!previewMultiSelect.enabled.value) return
  previewMultiSelect.invertSelection(filteredPreviewSessionIds.value)
}

async function deletePreviewSessionById(sessionId: string): Promise<boolean> {
  const id = String(sessionId || '').trim()
  if (!id) return false
  try {
    await preview.deleteSession(id)
    clearSessionHealth(id)
    probeVisibleSessions()
    return true
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    toasts.push('error', String(t('workspaceDock.preview.sidebar.actions.deleteFailed', { detail })), 4500)
    return false
  }
}

async function deleteSelectedPreviewSessions() {
  const targets = [...previewMultiSelect.selectedList.value]
  if (targets.length === 0) return
  for (const sessionId of targets) {
    await deletePreviewSessionById(sessionId)
  }
  previewMultiSelect.setEnabled(false)
}

watch(
  () => allPreviewSessionIds.value,
  (ids) => {
    previewMultiSelect.retain(ids)
  },
  { immediate: true },
)

watch(
  () => visibleSessionIdKey.value,
  () => {
    probeVisibleSessions()
  },
  { immediate: true },
)

watch(
  () => preview.loading,
  (loading) => {
    if (!loading) probeVisibleSessions()
  },
  { immediate: true },
)

watch(
  chatPageCount,
  () => {
    const clamped = chatPageClamped.value
    if (clamped !== chatSectionPage.value) chatSectionPage.value = clamped
  },
  { immediate: true },
)

watch(
  directoryPageCount,
  () => {
    const clamped = directoryPageClamped.value
    if (clamped !== directorySectionPage.value) directorySectionPage.value = clamped
  },
  { immediate: true },
)

watch(
  allPageCount,
  () => {
    const clamped = allPageClamped.value
    if (clamped !== allSectionPage.value) allSectionPage.value = clamped
  },
  { immediate: true },
)

watch(
  sidebarQueryNorm,
  () => {
    chatSectionPage.value = 0
    directorySectionPage.value = 0
    allSectionPage.value = 0
  },
  { immediate: true },
)

watch(currentChatSessionId, (next, prev) => {
  if (next === prev) return
  chatSectionPage.value = 0
  if (next) chatSectionOpen.value = true
})

watch(currentDirectoryNorm, (next, prev) => {
  if (next === prev) return
  directorySectionPage.value = 0
})

onMounted(() => {
  probeVisibleSessions()
  healthPollTimer = window.setInterval(() => {
    probeVisibleSessions()
  }, HEALTH_POLL_MS)
})

onBeforeUnmount(() => {
  if (healthPollTimer !== null) {
    window.clearInterval(healthPollTimer)
    healthPollTimer = null
  }
  clearSessionHealth()
})

function selectSession(sessionId: string) {
  preview.selectSession(sessionId)
  if (ui.isCompactLayout) ui.setSessionSwitcherOpen(false)
  probeVisibleSessions()
}
</script>

<template>
  <section
    class="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground"
    :class="ui.isCompactLayout ? '' : 'border-r border-border'"
  >
    <div class="h-9 pt-1 select-none pl-3.5 pr-2 flex-shrink-0">
      <div class="flex h-full items-center justify-between gap-2">
        <div class="min-w-0 flex items-center gap-2">
          <p class="typography-ui-label font-medium text-muted-foreground">
            {{ t('workspaceDock.preview.sessionsTitle') }}
            <span class="ml-1 font-mono text-[10px] text-muted-foreground/60"
              >({{ previewFilteredSessions.length }})</span
            >
          </p>
        </div>

        <div class="flex items-center gap-1">
          <IconButton
            :tooltip="String(t('workspaceDock.preview.emptyState.addAction'))"
            :aria-label="String(t('workspaceDock.preview.emptyState.addAction'))"
            :is-touch-pointer="ui.isTouchPointer"
            :disabled="actionLoading"
            @click="openCreateDialog"
          >
            <RiAddLine class="h-4 w-4" />
          </IconButton>

          <IconButton
            :tooltip="String(t('workspaceDock.preview.refresh'))"
            :aria-label="String(t('workspaceDock.preview.refresh'))"
            :is-touch-pointer="ui.isTouchPointer"
            :disabled="preview.loading"
            @click="refreshSessions({ forceFrameReload: true })"
          >
            <RiRefreshLine class="h-4 w-4" :class="preview.loading ? 'animate-spin' : ''" />
          </IconButton>

          <IconButton
            :tooltip="
              String(
                previewMultiSelect.enabled.value
                  ? t('workspaceDock.preview.sidebar.actions.exitMultiSelect')
                  : t('workspaceDock.preview.sidebar.actions.enterMultiSelect'),
              )
            "
            :title="
              String(
                previewMultiSelect.enabled.value
                  ? t('workspaceDock.preview.sidebar.actions.exitMultiSelect')
                  : t('workspaceDock.preview.sidebar.actions.enterMultiSelect'),
              )
            "
            :aria-label="
              String(
                previewMultiSelect.enabled.value
                  ? t('workspaceDock.preview.sidebar.actions.exitMultiSelect')
                  : t('workspaceDock.preview.sidebar.actions.enterMultiSelect'),
              )
            "
            :is-touch-pointer="ui.isTouchPointer"
            :class="previewMultiSelect.enabled.value ? 'bg-primary/10 text-primary hover:bg-primary/15' : ''"
            @click="togglePreviewMultiSelectMode"
          >
            <RiCloseLine v-if="previewMultiSelect.enabled.value" class="h-4 w-4" />
            <RiListCheck3 v-else class="h-4 w-4" />
          </IconButton>
        </div>
      </div>
    </div>

    <div class="px-3 py-2 flex-shrink-0">
      <SearchInput
        :model-value="preview.sidebarQuery"
        @update:model-value="(v) => (preview.sidebarQuery = String(v || ''))"
        @search="() => {}"
        @clear="() => {}"
        :placeholder="String(t('workspaceDock.preview.sidebar.searchPlaceholder'))"
        class="text-xs"
        input-class="h-8 text-xs"
        :input-aria-label="String(t('workspaceDock.preview.sidebar.searchAria'))"
        :input-title="String(t('workspaceDock.preview.sidebar.searchAria'))"
        :search-aria-label="String(t('common.search'))"
        :search-title="String(t('common.search'))"
        :clear-aria-label="String(t('common.clear'))"
        :clear-title="String(t('common.clear'))"
        :is-touch-pointer="ui.isTouchPointer"
      />
    </div>

    <div v-if="previewMultiSelect.enabled.value" class="flex-shrink-0 border-b border-sidebar-border/60 px-2.5 py-1.5">
      <div class="flex flex-wrap items-center justify-between gap-1.5">
        <div class="flex min-w-0 items-center">
          <span
            class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-medium text-foreground/80"
            :title="
              String(
                t('workspaceDock.preview.sidebar.multiSelect.selectedCount', {
                  count: previewMultiSelect.selectedCount.value,
                }),
              )
            "
            :aria-label="
              String(
                t('workspaceDock.preview.sidebar.multiSelect.selectedCount', {
                  count: previewMultiSelect.selectedCount.value,
                }),
              )
            "
          >
            {{ previewMultiSelect.selectedCount.value }}
          </span>
        </div>

        <div class="flex items-center gap-1">
          <IconButton
            size="xs"
            :tooltip="String(t('common.selectAll'))"
            :title="String(t('common.selectAll'))"
            :aria-label="String(t('common.selectAll'))"
            :is-touch-pointer="ui.isTouchPointer"
            :disabled="
              filteredPreviewSessionIds.length === 0 ||
              previewMultiSelect.selectedCount.value === filteredPreviewSessionIds.length
            "
            @click="selectAllPreviewSessions"
          >
            <RiListCheck3 class="h-3.5 w-3.5" />
          </IconButton>

          <IconButton
            size="xs"
            :tooltip="String(t('common.invertSelection'))"
            :title="String(t('common.invertSelection'))"
            :aria-label="String(t('common.invertSelection'))"
            :is-touch-pointer="ui.isTouchPointer"
            :disabled="filteredPreviewSessionIds.length === 0"
            @click="invertPreviewSessionsSelection"
          >
            <RiRefreshLine class="h-3.5 w-3.5" />
          </IconButton>

          <ConfirmPopover
            :title="String(t('workspaceDock.preview.sidebar.confirmDeleteSelected.title'))"
            :description="
              String(
                t('workspaceDock.preview.sidebar.confirmDeleteSelected.description', {
                  count: previewMultiSelect.selectedCount.value,
                }),
              )
            "
            :confirm-text="String(t('workspaceDock.preview.sidebar.actions.deleteSelected'))"
            :cancel-text="String(t('common.cancel'))"
            variant="destructive"
            @confirm="deleteSelectedPreviewSessions"
          >
            <IconButton
              size="xs"
              variant="ghost-destructive"
              :tooltip="String(t('workspaceDock.preview.sidebar.actions.deleteSelected'))"
              :title="String(t('workspaceDock.preview.sidebar.actions.deleteSelected'))"
              :aria-label="String(t('workspaceDock.preview.sidebar.actions.deleteSelected'))"
              :is-touch-pointer="ui.isTouchPointer"
              :disabled="previewMultiSelect.selectedCount.value === 0"
              @click.stop
            >
              <RiDeleteBinLine class="h-3.5 w-3.5" />
            </IconButton>
          </ConfirmPopover>

          <IconButton
            size="xs"
            :tooltip="String(t('workspaceDock.preview.sidebar.actions.exitMultiSelect'))"
            :title="String(t('workspaceDock.preview.sidebar.actions.exitMultiSelect'))"
            :aria-label="String(t('workspaceDock.preview.sidebar.actions.exitMultiSelect'))"
            :is-touch-pointer="ui.isTouchPointer"
            @click="togglePreviewMultiSelectMode"
          >
            <RiCloseLine class="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>
    </div>

    <div class="flex-1 min-h-0 overflow-x-hidden overflow-y-auto pb-2">
      <div class="flex-shrink-0 border-t border-sidebar-border/60 bg-sidebar/95">
        <div
          :class="[
            'group h-10 px-3 flex items-center justify-between gap-2 rounded-md transition-colors',
            chatSectionOpen ? 'bg-secondary/30' : 'hover:bg-secondary/30 focus-within:bg-secondary/30',
          ]"
        >
          <button
            type="button"
            class="flex-1 h-full min-w-0 flex items-center gap-2 text-left rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            :aria-expanded="chatSectionOpen"
            :aria-label="String(t('workspaceDock.preview.sidebar.sections.chat.title'))"
            @click="chatSectionOpen = !chatSectionOpen"
          >
            <component
              :is="chatSectionOpen ? RiArrowDownSLine : RiArrowRightSLine"
              class="h-4 w-4 text-muted-foreground"
            />
            <span class="typography-ui-label font-medium text-muted-foreground">{{
              t('workspaceDock.preview.sidebar.sections.chat.title')
            }}</span>
          </button>
          <div class="flex items-center gap-2 flex-shrink-0">
            <span class="text-[11px] font-mono text-muted-foreground/70">{{ chatCount }}</span>
            <SidebarPager
              v-if="chatSectionOpen && chatPageCount > 1"
              :page="chatSectionPage"
              :page-count="chatPageCount"
              :disabled="preview.loading"
              :prev-label="String(t('common.previousPage'))"
              :next-label="String(t('common.nextPage'))"
              @update:page="(v) => (chatSectionPage = v)"
            />
          </div>
        </div>

        <div v-if="chatSectionOpen" class="px-2 pb-2 animate-in fade-in-0 slide-in-from-top-1 duration-200">
          <SidebarSectionSkeleton v-if="preview.loading && previewSessions.length === 0" :rows="3" compact />
          <div
            v-else-if="!currentChatSessionId"
            class="px-2 py-2 text-xs text-muted-foreground animate-in fade-in-0 duration-150"
          >
            {{ t('workspaceDock.preview.sidebar.sections.chat.emptyNoSession') }}
          </div>
          <div
            v-else-if="sidebarQueryNorm && chatSessionsAll.length > 0 && chatCount === 0"
            class="px-2 py-2 text-xs text-muted-foreground animate-in fade-in-0 duration-150"
          >
            {{ t('workspaceDock.preview.sidebar.noMatchingSessions') }}
          </div>
          <div
            v-else-if="chatSessionsAll.length === 0"
            class="px-2 py-2 text-xs text-muted-foreground animate-in fade-in-0 duration-150"
          >
            {{ t('workspaceDock.preview.sidebar.sections.chat.empty') }}
          </div>
          <div v-else class="space-y-1 pt-1 animate-in fade-in-0 duration-150">
            <SidebarListItem
              v-for="session in pagedChatSessions"
              :key="session.id"
              :active="!previewMultiSelect.enabled.value && preview.activeSessionId === session.id"
              :as="isInlineRenameSession(session, 'chat') ? 'div' : 'button'"
              density="compact"
              :actions-always-visible="
                !previewMultiSelect.enabled.value && (ui.isMobilePointer || isInlineRenameSession(session, 'chat'))
              "
              @click="handlePreviewSessionRowClick(session, 'chat', $event)"
            >
              <template #icon>
                <div class="flex items-center gap-1.5">
                  <ListItemSelectionIndicator
                    v-if="previewMultiSelect.enabled.value"
                    :selected="previewMultiSelect.isSelected(session.id)"
                  />
                  <span
                    class="inline-flex h-1.5 w-1.5 rounded-full flex-shrink-0"
                    :class="sessionDotClass(session)"
                    :title="sessionDotLabel(session)"
                    :aria-label="sessionDotLabel(session)"
                  />
                </div>
              </template>

              <div class="flex w-full items-center min-w-0 gap-2">
                <template v-if="!isInlineRenameSession(session, 'chat')">
                  <div class="flex-1 min-w-0 flex flex-col justify-center">
                    <span class="truncate typography-ui-label w-full text-left" :title="preview.sessionLabel(session)">
                      {{ preview.sessionLabel(session) }}
                    </span>
                    <span
                      class="truncate typography-micro font-mono text-left text-muted-foreground/60 w-full"
                      :title="session.directory || session.id"
                    >
                      {{ session.directory || session.id }}
                    </span>
                  </div>
                </template>

                <template v-else>
                  <input
                    ref="renameInputEl"
                    type="text"
                    :value="renameDraft"
                    class="h-7 min-w-0 flex-1 rounded-md border border-input bg-background/95 px-2 text-xs font-mono text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    :placeholder="String(t('workspaceDock.preview.emptyState.sessionIdPlaceholder'))"
                    @click.stop
                    @input="onRenameDraftInput"
                    @keydown.enter.prevent.stop="saveRenameSession"
                    @keydown.esc.prevent.stop="cancelRenameSession"
                  />
                </template>
              </div>

              <template #actions>
                <template v-if="isInlineRenameSession(session, 'chat')">
                  <IconButton
                    size="xs"
                    class="text-muted-foreground hover:text-foreground hover:bg-primary/6"
                    :title="String(t('common.cancel'))"
                    :aria-label="String(t('common.cancel'))"
                    :disabled="renameBusy"
                    @click.stop="cancelRenameSession"
                  >
                    <RiCloseLine class="h-3.5 w-3.5" />
                  </IconButton>

                  <IconButton
                    size="xs"
                    class="text-primary hover:bg-primary/12"
                    :title="String(t(renameBusy ? 'common.saving' : 'common.save'))"
                    :aria-label="String(t(renameBusy ? 'common.saving' : 'common.save'))"
                    :disabled="!canSaveRename"
                    @click.stop="saveRenameSession"
                  >
                    <RiLoader4Line v-if="renameBusy" class="h-3.5 w-3.5 animate-spin" />
                    <RiCheckLine v-else class="h-3.5 w-3.5" />
                  </IconButton>
                </template>

                <template v-else-if="!previewMultiSelect.enabled.value">
                  <ListItemOverflowActionButton
                    :mobile="ui.isMobilePointer"
                    :label="String(t('common.actions'))"
                    @trigger="(event) => openRowMenu(session.id, 'chat', event)"
                  />
                </template>
              </template>
            </SidebarListItem>
          </div>
        </div>
      </div>

      <div class="flex-shrink-0 border-t border-sidebar-border/60 bg-sidebar/95">
        <div
          :class="[
            'group h-10 px-3 flex items-center justify-between gap-2 rounded-md transition-colors',
            directorySectionOpen ? 'bg-secondary/30' : 'hover:bg-secondary/30 focus-within:bg-secondary/30',
          ]"
        >
          <button
            type="button"
            class="flex-1 h-full min-w-0 flex items-center gap-2 text-left rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            :aria-expanded="directorySectionOpen"
            :aria-label="String(t('workspaceDock.preview.sidebar.sections.directory.title'))"
            @click="directorySectionOpen = !directorySectionOpen"
          >
            <component
              :is="directorySectionOpen ? RiArrowDownSLine : RiArrowRightSLine"
              class="h-4 w-4 text-muted-foreground"
            />
            <span class="typography-ui-label font-medium text-muted-foreground">{{
              t('workspaceDock.preview.sidebar.sections.directory.title')
            }}</span>
          </button>
          <div class="flex items-center gap-2 flex-shrink-0">
            <span class="text-[11px] font-mono text-muted-foreground/70">{{ directoryCount }}</span>
            <SidebarPager
              v-if="directorySectionOpen && directoryPageCount > 1"
              :page="directorySectionPage"
              :page-count="directoryPageCount"
              :disabled="preview.loading"
              :prev-label="String(t('common.previousPage'))"
              :next-label="String(t('common.nextPage'))"
              @update:page="(v) => (directorySectionPage = v)"
            />
          </div>
        </div>

        <div v-if="directorySectionOpen" class="px-2 pb-2 animate-in fade-in-0 slide-in-from-top-1 duration-200">
          <SidebarSectionSkeleton v-if="preview.loading && previewSessions.length === 0" :rows="3" compact />
          <div
            v-else-if="!currentDirectoryNorm"
            class="px-2 py-2 text-xs text-muted-foreground animate-in fade-in-0 duration-150"
          >
            {{ t('workspaceDock.preview.sidebar.sections.directory.emptyNoDirectory') }}
          </div>
          <div
            v-else-if="sidebarQueryNorm && directorySessionsAll.length > 0 && directoryCount === 0"
            class="px-2 py-2 text-xs text-muted-foreground animate-in fade-in-0 duration-150"
          >
            {{ t('workspaceDock.preview.sidebar.noMatchingSessions') }}
          </div>
          <div
            v-else-if="directorySessionsAll.length === 0"
            class="px-2 py-2 text-xs text-muted-foreground animate-in fade-in-0 duration-150"
          >
            {{ t('workspaceDock.preview.sidebar.sections.directory.empty') }}
          </div>
          <div v-else class="space-y-1 pt-1 animate-in fade-in-0 duration-150">
            <SidebarListItem
              v-for="session in pagedDirectorySessions"
              :key="session.id"
              :active="!previewMultiSelect.enabled.value && preview.activeSessionId === session.id"
              :as="isInlineRenameSession(session, 'directory') ? 'div' : 'button'"
              density="compact"
              :actions-always-visible="
                !previewMultiSelect.enabled.value && (ui.isMobilePointer || isInlineRenameSession(session, 'directory'))
              "
              @click="handlePreviewSessionRowClick(session, 'directory', $event)"
            >
              <template #icon>
                <div class="flex items-center gap-1.5">
                  <ListItemSelectionIndicator
                    v-if="previewMultiSelect.enabled.value"
                    :selected="previewMultiSelect.isSelected(session.id)"
                  />
                  <span
                    class="inline-flex h-1.5 w-1.5 rounded-full flex-shrink-0"
                    :class="sessionDotClass(session)"
                    :title="sessionDotLabel(session)"
                    :aria-label="sessionDotLabel(session)"
                  />
                </div>
              </template>

              <div class="flex w-full items-center min-w-0 gap-2">
                <template v-if="!isInlineRenameSession(session, 'directory')">
                  <div class="flex-1 min-w-0 flex flex-col justify-center">
                    <span class="truncate typography-ui-label w-full text-left" :title="preview.sessionLabel(session)">
                      {{ preview.sessionLabel(session) }}
                    </span>
                    <span
                      class="truncate typography-micro font-mono text-left text-muted-foreground/60 w-full"
                      :title="session.directory || session.id"
                    >
                      {{ session.directory || session.id }}
                    </span>
                  </div>
                </template>

                <template v-else>
                  <input
                    ref="renameInputEl"
                    type="text"
                    :value="renameDraft"
                    class="h-7 min-w-0 flex-1 rounded-md border border-input bg-background/95 px-2 text-xs font-mono text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    :placeholder="String(t('workspaceDock.preview.emptyState.sessionIdPlaceholder'))"
                    @click.stop
                    @input="onRenameDraftInput"
                    @keydown.enter.prevent.stop="saveRenameSession"
                    @keydown.esc.prevent.stop="cancelRenameSession"
                  />
                </template>
              </div>

              <template #actions>
                <template v-if="isInlineRenameSession(session, 'directory')">
                  <IconButton
                    size="xs"
                    class="text-muted-foreground hover:text-foreground hover:bg-primary/6"
                    :title="String(t('common.cancel'))"
                    :aria-label="String(t('common.cancel'))"
                    :disabled="renameBusy"
                    @click.stop="cancelRenameSession"
                  >
                    <RiCloseLine class="h-3.5 w-3.5" />
                  </IconButton>

                  <IconButton
                    size="xs"
                    class="text-primary hover:bg-primary/12"
                    :title="String(t(renameBusy ? 'common.saving' : 'common.save'))"
                    :aria-label="String(t(renameBusy ? 'common.saving' : 'common.save'))"
                    :disabled="!canSaveRename"
                    @click.stop="saveRenameSession"
                  >
                    <RiLoader4Line v-if="renameBusy" class="h-3.5 w-3.5 animate-spin" />
                    <RiCheckLine v-else class="h-3.5 w-3.5" />
                  </IconButton>
                </template>

                <template v-else-if="!previewMultiSelect.enabled.value">
                  <ListItemOverflowActionButton
                    :mobile="ui.isMobilePointer"
                    :label="String(t('common.actions'))"
                    @trigger="(event) => openRowMenu(session.id, 'directory', event)"
                  />
                </template>
              </template>
            </SidebarListItem>
          </div>
        </div>
      </div>

      <div class="flex-shrink-0 border-t border-sidebar-border/60 bg-sidebar/95">
        <div
          :class="[
            'group h-10 px-3 flex items-center justify-between gap-2 rounded-md transition-colors',
            allSectionOpen ? 'bg-secondary/30' : 'hover:bg-secondary/30 focus-within:bg-secondary/30',
          ]"
        >
          <button
            type="button"
            class="flex-1 h-full min-w-0 flex items-center gap-2 text-left rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            :aria-expanded="allSectionOpen"
            :aria-label="String(t('workspaceDock.preview.sidebar.sections.all.title'))"
            @click="allSectionOpen = !allSectionOpen"
          >
            <component
              :is="allSectionOpen ? RiArrowDownSLine : RiArrowRightSLine"
              class="h-4 w-4 text-muted-foreground"
            />
            <span class="typography-ui-label font-medium text-muted-foreground">{{
              t('workspaceDock.preview.sidebar.sections.all.title')
            }}</span>
          </button>
          <div class="flex items-center gap-2 flex-shrink-0">
            <span class="text-[11px] font-mono text-muted-foreground/70">{{ allCount }}</span>
            <SidebarPager
              v-if="allSectionOpen && allPageCount > 1"
              :page="allSectionPage"
              :page-count="allPageCount"
              :disabled="preview.loading"
              :prev-label="String(t('common.previousPage'))"
              :next-label="String(t('common.nextPage'))"
              @update:page="(v) => (allSectionPage = v)"
            />
          </div>
        </div>

        <div v-if="allSectionOpen" class="px-2 pb-2 animate-in fade-in-0 slide-in-from-top-1 duration-200">
          <SidebarSectionSkeleton v-if="preview.loading && previewSessions.length === 0" :rows="3" compact />
          <div
            v-else-if="sidebarQueryNorm && allSessionsAll.length > 0 && allCount === 0"
            class="px-2 py-2 text-xs text-muted-foreground animate-in fade-in-0 duration-150"
          >
            {{ t('workspaceDock.preview.sidebar.noMatchingSessions') }}
          </div>
          <div
            v-else-if="allSessionsAll.length === 0"
            class="px-2 py-2 text-xs text-muted-foreground animate-in fade-in-0 duration-150"
          >
            {{ t('workspaceDock.preview.sidebar.sections.all.empty') }}
          </div>
          <div v-else class="space-y-1 pt-1 animate-in fade-in-0 duration-150">
            <SidebarListItem
              v-for="session in pagedAllSessions"
              :key="session.id"
              :active="!previewMultiSelect.enabled.value && preview.activeSessionId === session.id"
              :as="isInlineRenameSession(session, 'all') ? 'div' : 'button'"
              density="compact"
              :actions-always-visible="
                !previewMultiSelect.enabled.value && (ui.isMobilePointer || isInlineRenameSession(session, 'all'))
              "
              @click="handlePreviewSessionRowClick(session, 'all', $event)"
            >
              <template #icon>
                <div class="flex items-center gap-1.5">
                  <ListItemSelectionIndicator
                    v-if="previewMultiSelect.enabled.value"
                    :selected="previewMultiSelect.isSelected(session.id)"
                  />
                  <span
                    class="inline-flex h-1.5 w-1.5 rounded-full flex-shrink-0"
                    :class="sessionDotClass(session)"
                    :title="sessionDotLabel(session)"
                    :aria-label="sessionDotLabel(session)"
                  />
                </div>
              </template>

              <div class="flex w-full items-center min-w-0 gap-2">
                <template v-if="!isInlineRenameSession(session, 'all')">
                  <div class="flex-1 min-w-0 flex flex-col justify-center">
                    <span class="truncate typography-ui-label w-full text-left" :title="preview.sessionLabel(session)">
                      {{ preview.sessionLabel(session) }}
                    </span>
                    <span
                      class="truncate typography-micro font-mono text-left text-muted-foreground/60 w-full"
                      :title="session.directory || session.id"
                    >
                      {{ session.directory || session.id }}
                    </span>
                  </div>
                </template>

                <template v-else>
                  <input
                    ref="renameInputEl"
                    type="text"
                    :value="renameDraft"
                    class="h-7 min-w-0 flex-1 rounded-md border border-input bg-background/95 px-2 text-xs font-mono text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    :placeholder="String(t('workspaceDock.preview.emptyState.sessionIdPlaceholder'))"
                    @click.stop
                    @input="onRenameDraftInput"
                    @keydown.enter.prevent.stop="saveRenameSession"
                    @keydown.esc.prevent.stop="cancelRenameSession"
                  />
                </template>
              </div>

              <template #actions>
                <template v-if="isInlineRenameSession(session, 'all')">
                  <IconButton
                    size="xs"
                    class="text-muted-foreground hover:text-foreground hover:bg-primary/6"
                    :title="String(t('common.cancel'))"
                    :aria-label="String(t('common.cancel'))"
                    :disabled="renameBusy"
                    @click.stop="cancelRenameSession"
                  >
                    <RiCloseLine class="h-3.5 w-3.5" />
                  </IconButton>

                  <IconButton
                    size="xs"
                    class="text-primary hover:bg-primary/12"
                    :title="String(t(renameBusy ? 'common.saving' : 'common.save'))"
                    :aria-label="String(t(renameBusy ? 'common.saving' : 'common.save'))"
                    :disabled="!canSaveRename"
                    @click.stop="saveRenameSession"
                  >
                    <RiLoader4Line v-if="renameBusy" class="h-3.5 w-3.5 animate-spin" />
                    <RiCheckLine v-else class="h-3.5 w-3.5" />
                  </IconButton>
                </template>

                <template v-else-if="!previewMultiSelect.enabled.value">
                  <ListItemOverflowActionButton
                    :mobile="ui.isMobilePointer"
                    :label="String(t('common.actions'))"
                    @trigger="(event) => openRowMenu(session.id, 'all', event)"
                  />
                </template>
              </template>
            </SidebarListItem>
          </div>
        </div>
      </div>
    </div>

    <OptionMenu
      :open="rowMenuOpen"
      :groups="rowMenuGroups"
      :title="String(t('common.actions'))"
      :mobile-title="String(t('common.actions'))"
      :searchable="false"
      :is-mobile-pointer="ui.isMobilePointer"
      desktop-placement="bottom-end"
      :desktop-anchor-el="rowMenuAnchorEl"
      @update:open="setRowMenuOpen"
      @select="onRowMenuSelect"
    />

    <FormDialog
      :open="createDialogOpen"
      :title="String(t('workspaceDock.preview.addDialog.title'))"
      :description="String(t('workspaceDock.preview.addDialog.description'))"
      max-width="max-w-md"
      @close="createDialogOpen = false"
      @update:open="createDialogOpen = $event"
    >
      <div class="space-y-3">
        <div class="space-y-1">
          <label
            class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
            for="workspace-preview-id-sidebar-dialog"
          >
            {{ t('workspaceDock.preview.emptyState.sessionIdLabel') }}
          </label>
          <Input
            id="workspace-preview-id-sidebar-dialog"
            v-model="createPreviewId"
            type="text"
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
            :placeholder="String(t('workspaceDock.preview.emptyState.sessionIdPlaceholder'))"
            :disabled="actionLoading"
            class="h-8 bg-background/80 text-xs font-mono"
            @keydown.enter.prevent="createManagedSession"
          />
          <p class="text-[11px] text-muted-foreground">
            {{ t('workspaceDock.preview.emptyState.sessionIdHelp') }}
          </p>
        </div>

        <div class="space-y-1">
          <label
            class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
            for="workspace-preview-run-dir-sidebar-dialog"
          >
            {{ t('workspaceDock.preview.emptyState.runDirectoryLabel') }}
          </label>
          <Input
            id="workspace-preview-run-dir-sidebar-dialog"
            v-model="createRunDirectory"
            type="text"
            :placeholder="String(t('workspaceDock.preview.emptyState.runDirectoryPlaceholder'))"
            :disabled="actionLoading"
            class="h-8 bg-background/80 text-xs font-mono"
          />
        </div>

        <div class="space-y-1">
          <label
            class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
            for="workspace-preview-command-sidebar-dialog"
          >
            {{ t('workspaceDock.preview.emptyState.commandLabel') }}
          </label>
          <Input
            id="workspace-preview-command-sidebar-dialog"
            v-model="createCommand"
            type="text"
            :placeholder="String(t('workspaceDock.preview.emptyState.commandPlaceholder'))"
            :disabled="actionLoading"
            class="h-8 bg-background/80 text-xs font-mono"
          />
        </div>

        <div class="space-y-1">
          <label
            class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
            for="workspace-preview-args-sidebar-dialog"
          >
            {{ t('workspaceDock.preview.emptyState.argsLabel') }}
          </label>
          <Input
            id="workspace-preview-args-sidebar-dialog"
            v-model="createArgsText"
            type="text"
            :placeholder="String(t('workspaceDock.preview.emptyState.argsPlaceholder'))"
            :disabled="actionLoading"
            class="h-8 bg-background/80 text-xs font-mono"
          />
        </div>

        <div class="space-y-1">
          <label
            class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
            for="workspace-preview-logs-sidebar-dialog"
          >
            {{ t('workspaceDock.preview.emptyState.logsPathLabel') }}
          </label>
          <Input
            id="workspace-preview-logs-sidebar-dialog"
            v-model="createLogsPath"
            type="text"
            :placeholder="String(t('workspaceDock.preview.emptyState.logsPathPlaceholder'))"
            :disabled="actionLoading"
            class="h-8 bg-background/80 text-xs font-mono"
          />
        </div>

        <div class="space-y-1">
          <label
            class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
            for="workspace-preview-target-url-sidebar-dialog"
          >
            {{ t('workspaceDock.preview.emptyState.targetUrlLabel') }}
          </label>
          <Input
            id="workspace-preview-target-url-sidebar-dialog"
            v-model="createTargetUrl"
            type="url"
            :placeholder="String(t('workspaceDock.preview.emptyState.targetUrlPlaceholder'))"
            :disabled="actionLoading"
            class="h-8 bg-background/80 text-xs"
            @keydown.enter.prevent="createManagedSession"
          />
        </div>

        <p class="truncate text-[11px] text-muted-foreground">
          {{ t('workspaceDock.preview.directoryLabel') }}
          <span class="font-mono">{{ currentDirectory || t('workspaceDock.preview.emptyState.directoryEmpty') }}</span>
        </p>

        <p v-if="actionError" class="text-xs text-destructive">{{ actionError }}</p>

        <div class="flex items-center justify-end gap-2 pt-1">
          <Button size="sm" variant="outline" :disabled="actionLoading" @click="createDialogOpen = false">
            {{ t('common.cancel') }}
          </Button>
          <Button
            size="sm"
            :disabled="
              actionLoading ||
              !currentDirectory.trim() ||
              !createPreviewIdNorm.trim() ||
              !createPreviewIdValid ||
              !createRunDirectoryNorm.trim() ||
              !createCommandNorm.trim() ||
              createArgsList.length === 0 ||
              !createLogsPathNorm.trim() ||
              !createTargetUrl.trim()
            "
            @click="createManagedSession"
          >
            {{ t('workspaceDock.preview.emptyState.addAction') }}
          </Button>
        </div>
      </div>
    </FormDialog>

    <FormDialog
      :open="editDialogOpen"
      :title="String(t('workspaceDock.preview.editDialog.title'))"
      :description="String(t('workspaceDock.preview.editDialog.description'))"
      max-width="max-w-md"
      @close="editDialogOpen = false"
      @update:open="editDialogOpen = $event"
    >
      <div class="space-y-3">
        <div class="space-y-1">
          <label
            class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
            for="workspace-preview-edit-target-url"
          >
            {{ t('workspaceDock.preview.emptyState.targetUrlLabel') }}
          </label>
          <Input
            id="workspace-preview-edit-target-url"
            v-model="editTargetUrl"
            type="url"
            :disabled="editBusy"
            class="h-8 bg-background/80 text-xs"
            @keydown.enter.prevent="saveEditDialog"
          />
        </div>

        <p v-if="editError" class="text-xs text-destructive">{{ editError }}</p>

        <div class="flex items-center justify-end gap-2 pt-1">
          <Button size="sm" variant="outline" :disabled="editBusy" @click="editDialogOpen = false">
            {{ t('common.cancel') }}
          </Button>
          <Button size="sm" :disabled="editBusy || !editTargetUrl.trim()" @click="saveEditDialog">
            {{ t('common.save') }}
          </Button>
        </div>
      </div>
    </FormDialog>

    <FormDialog
      :open="renameDialogOpen"
      :title="String(t('workspaceDock.preview.renameDialog.title'))"
      :description="String(t('workspaceDock.preview.renameDialog.description'))"
      max-width="max-w-md"
      @close="cancelRenameSession"
      @update:open="
        (v) => {
          renameDialogOpen = v
          if (!v) cancelRenameSession()
        }
      "
    >
      <div class="space-y-3">
        <div class="space-y-1">
          <label
            class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
            for="workspace-preview-rename-id"
          >
            {{ t('workspaceDock.preview.emptyState.sessionIdLabel') }}
          </label>
          <Input
            id="workspace-preview-rename-id"
            v-model="renameDraft"
            type="text"
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
            :placeholder="String(t('workspaceDock.preview.emptyState.sessionIdPlaceholder'))"
            :disabled="renameBusy"
            class="h-8 bg-background/80 text-xs font-mono"
            @keydown.enter.prevent="saveRenameSession"
          />
          <p class="text-[11px] text-muted-foreground">
            {{ t('workspaceDock.preview.emptyState.sessionIdHelp') }}
          </p>
        </div>

        <p v-if="renameError" class="text-xs text-destructive">{{ renameError }}</p>

        <div class="flex items-center justify-end gap-2 pt-1">
          <Button size="sm" variant="outline" :disabled="renameBusy" @click="cancelRenameSession">
            {{ t('common.cancel') }}
          </Button>
          <Button size="sm" :disabled="!canSaveRename" @click="saveRenameSession">
            {{ renameBusy ? t('common.saving') : t('common.save') }}
          </Button>
        </div>
      </div>
    </FormDialog>
  </section>
</template>

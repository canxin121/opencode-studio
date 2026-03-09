import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { isMainTabId, type MainTabId } from '@/app/navigation/mainTabs'
import { getLocalString, setLocalString } from '@/lib/persist'
import { localStorageKeys } from '@/lib/persistence/storageKeys'

export type MainTab = MainTabId
export type WorkspaceDockPanel = 'git' | 'files' | 'terminal'
export type WorkspaceDockPlacement = 'right' | 'bottom'
export type WorkspaceDockFileAction = 'open' | 'reveal'
export type WorkspaceDockFileRequest = {
  path: string
  action: WorkspaceDockFileAction
}

const STORAGE_SIDEBAR_OPEN = localStorageKeys.ui.sidebarOpen
const STORAGE_SIDEBAR_WIDTH = localStorageKeys.ui.sidebarWidth
const STORAGE_GIT_HISTORY_SEARCH_EXPANDED = localStorageKeys.ui.gitHistorySearchExpanded
const STORAGE_ACTIVE_TAB = localStorageKeys.ui.activeMainTab
const STORAGE_WORKSPACE_DOCK_OPEN = localStorageKeys.ui.workspaceDockOpen
const STORAGE_WORKSPACE_DOCK_PANEL = localStorageKeys.ui.workspaceDockPanel
const STORAGE_WORKSPACE_DOCK_PLACEMENT = localStorageKeys.ui.workspaceDockPlacement
const STORAGE_WORKSPACE_DOCK_WIDTH = localStorageKeys.ui.workspaceDockWidth
const STORAGE_WORKSPACE_DOCK_HEIGHT = localStorageKeys.ui.workspaceDockHeight

export const useUiStore = defineStore('ui', () => {
  const isMobile = ref(false)
  const isMobilePointer = ref(false)

  // Left sessions sidebar (desktop) + drill-down list (mobile)
  const isSidebarOpen = ref(getLocalString(STORAGE_SIDEBAR_OPEN) !== 'false')
  watch(isSidebarOpen, (v) => setLocalString(STORAGE_SIDEBAR_OPEN, v ? 'true' : 'false'))

  const sidebarWidth = ref<number>(
    (() => {
      const raw = getLocalString(STORAGE_SIDEBAR_WIDTH)
      const n = raw ? Number(raw) : NaN
      return Number.isFinite(n) ? Math.min(520, Math.max(220, n)) : 280
    })(),
  )
  const hasManuallyResizedLeftSidebar = ref(false)
  watch(sidebarWidth, (v) => {
    setLocalString(STORAGE_SIDEBAR_WIDTH, String(v))
    hasManuallyResizedLeftSidebar.value = true
  })

  // Mobile drill-down: show sessions sidebar OR main content.
  const isSessionSwitcherOpen = ref(false)

  // Explicit session locate request (used to scroll the sessions sidebar on demand).
  // This is intentionally *not* tied to session selection; only user-triggered actions should update the sidebar.
  const sidebarLocateSeq = ref(0)
  const sidebarLocateSessionId = ref<string | null>(null)

  const effectiveSidebarWidth = computed(() => (isSidebarOpen.value && !isMobile.value ? sidebarWidth.value : 0))

  const gitHistorySearchExpanded = ref(getLocalString(STORAGE_GIT_HISTORY_SEARCH_EXPANDED) === 'true')
  watch(gitHistorySearchExpanded, (v) => setLocalString(STORAGE_GIT_HISTORY_SEARCH_EXPANDED, v ? 'true' : 'false'))

  const isWorkspaceDockOpen = ref(getLocalString(STORAGE_WORKSPACE_DOCK_OPEN) === 'true')
  watch(isWorkspaceDockOpen, (v) => setLocalString(STORAGE_WORKSPACE_DOCK_OPEN, v ? 'true' : 'false'))

  const workspaceDockPanel = ref<WorkspaceDockPanel>(
    (() => {
      const raw = getLocalString(STORAGE_WORKSPACE_DOCK_PANEL).trim()
      if (raw === 'terminal' || raw === 'files') return raw
      return 'git'
    })(),
  )
  watch(workspaceDockPanel, (v) => setLocalString(STORAGE_WORKSPACE_DOCK_PANEL, v))

  const workspaceDockFileRequest = ref<WorkspaceDockFileRequest | null>(null)
  const workspaceDockFileRequestSeq = ref(0)

  const workspaceDockPlacement = ref<WorkspaceDockPlacement>('right')
  watch(workspaceDockPlacement, (v) => setLocalString(STORAGE_WORKSPACE_DOCK_PLACEMENT, v))

  const workspaceDockWidth = ref<number>(
    (() => {
      const raw = getLocalString(STORAGE_WORKSPACE_DOCK_WIDTH)
      const n = raw ? Number(raw) : NaN
      return Number.isFinite(n) ? Math.min(620, Math.max(280, n)) : 360
    })(),
  )
  watch(workspaceDockWidth, (v) => {
    setLocalString(STORAGE_WORKSPACE_DOCK_WIDTH, String(Math.min(620, Math.max(280, v))))
  })

  const workspaceDockHeight = ref<number>(
    (() => {
      const raw = getLocalString(STORAGE_WORKSPACE_DOCK_HEIGHT)
      const n = raw ? Number(raw) : NaN
      return Number.isFinite(n) ? Math.min(520, Math.max(180, n)) : 260
    })(),
  )
  watch(workspaceDockHeight, (v) => {
    setLocalString(STORAGE_WORKSPACE_DOCK_HEIGHT, String(Math.min(520, Math.max(180, v))))
  })

  // Main tab state (kept in sync with router elsewhere)
  const activeMainTab = ref<MainTab>(
    (() => {
      const raw = getLocalString(STORAGE_ACTIVE_TAB).trim()
      return isMainTabId(raw) ? raw : 'chat'
    })(),
  )
  watch(activeMainTab, (v) => setLocalString(STORAGE_ACTIVE_TAB, v))

  // Global overlays
  const isHelpDialogOpen = ref(false)
  const isMcpDialogOpen = ref(false)

  // Cross-component session action requests (sidebar -> chat)
  const sessionActionSeq = ref(0)
  const sessionActionId = ref<string | null>(null)

  // Double-Esc abort prompt state (UI-only; actual abort lives in chat store)
  const abortPromptSessionId = ref<string | null>(null)
  const abortPromptExpiresAt = ref<number | null>(null)

  const sessionQueryEnabled = ref(false)

  function setIsMobile(next: boolean) {
    isMobile.value = next
    if (!next) {
      isSessionSwitcherOpen.value = false
    }
  }

  function setIsMobilePointer(next: boolean) {
    isMobilePointer.value = next
  }

  function toggleSidebar() {
    if (isMobile.value) {
      isSessionSwitcherOpen.value = !isSessionSwitcherOpen.value
      return
    }
    isSidebarOpen.value = !isSidebarOpen.value
    if (isSidebarOpen.value && typeof window !== 'undefined') {
      // When opening and not manually resized, use proportional width.
      if (!hasManuallyResizedLeftSidebar.value) {
        sidebarWidth.value = Math.min(520, Math.max(220, Math.floor(window.innerWidth * 0.2)))
      }
    }
  }

  function setSidebarOpen(open: boolean, opts?: { preserveWidth?: boolean }) {
    const wasOpen = isSidebarOpen.value
    isSidebarOpen.value = open
    if (!open || opts?.preserveWidth || wasOpen) return
    if (typeof window !== 'undefined' && !hasManuallyResizedLeftSidebar.value) {
      sidebarWidth.value = Math.min(520, Math.max(220, Math.floor(window.innerWidth * 0.2)))
    }
  }

  function setSessionSwitcherOpen(open: boolean) {
    isSessionSwitcherOpen.value = open
  }

  function setWorkspaceDockOpen(open: boolean) {
    if (open) {
      workspaceDockPlacement.value = 'right'
    }
    isWorkspaceDockOpen.value = open
  }

  function toggleWorkspaceDock(defaultPanel: WorkspaceDockPanel = 'git') {
    if (isWorkspaceDockOpen.value) {
      isWorkspaceDockOpen.value = false
      return
    }
    workspaceDockPanel.value = defaultPanel
    workspaceDockPlacement.value = 'right'
    isWorkspaceDockOpen.value = true
  }

  function setWorkspaceDockPanel(panel: WorkspaceDockPanel) {
    workspaceDockPanel.value = panel
  }

  function requestWorkspaceDockFile(path: string, action: WorkspaceDockFileAction = 'open') {
    const targetPath = String(path || '').trim()
    if (!targetPath) return

    workspaceDockPanel.value = 'files'
    workspaceDockPlacement.value = 'right'
    isWorkspaceDockOpen.value = true
    workspaceDockFileRequest.value = {
      path: targetPath,
      action: action === 'reveal' ? 'reveal' : 'open',
    }
    workspaceDockFileRequestSeq.value += 1
  }

  function setWorkspaceDockPlacement(_placement: WorkspaceDockPlacement) {
    workspaceDockPlacement.value = 'right'
  }

  function openAndLocateSessionInSidebar(sessionId: string | null) {
    const sid = (sessionId || '').trim()
    if (isMobile.value) {
      isSessionSwitcherOpen.value = true
    } else {
      setSidebarOpen(true, { preserveWidth: true })
    }
    sidebarLocateSessionId.value = sid || null
    sidebarLocateSeq.value += 1
  }

  function clearSidebarLocateRequest() {
    sidebarLocateSessionId.value = null
  }

  function setActiveMainTab(tab: MainTab) {
    activeMainTab.value = tab
  }

  function enableSessionQuery() {
    sessionQueryEnabled.value = true
  }

  function disableSessionQuery() {
    sessionQueryEnabled.value = false
  }

  function toggleHelpDialog() {
    isHelpDialogOpen.value = !isHelpDialogOpen.value
  }
  function setMcpDialogOpen(open: boolean) {
    isMcpDialogOpen.value = open
  }

  function requestSessionAction(actionId: string) {
    const id = String(actionId || '').trim()
    if (!id) return
    sessionActionId.value = id
    sessionActionSeq.value += 1
  }

  function clearSessionActionRequest() {
    sessionActionId.value = null
  }

  function armAbortPrompt(sessionId: string, durationMs: number): number {
    const expiresAt = Date.now() + Math.max(250, durationMs)
    abortPromptSessionId.value = sessionId
    abortPromptExpiresAt.value = expiresAt
    return expiresAt
  }
  function clearAbortPrompt() {
    abortPromptSessionId.value = null
    abortPromptExpiresAt.value = null
  }

  return {
    isMobile,
    isMobilePointer,
    isSidebarOpen,
    sidebarWidth,
    effectiveSidebarWidth,
    isSessionSwitcherOpen,
    isWorkspaceDockOpen,
    gitHistorySearchExpanded,
    sidebarLocateSeq,
    sidebarLocateSessionId,
    workspaceDockPanel,
    workspaceDockFileRequest,
    workspaceDockFileRequestSeq,
    workspaceDockPlacement,
    workspaceDockWidth,
    workspaceDockHeight,
    activeMainTab,
    isHelpDialogOpen,
    isMcpDialogOpen,
    sessionActionSeq,
    sessionActionId,
    sessionQueryEnabled,
    setIsMobile,
    setIsMobilePointer,
    toggleSidebar,
    setSessionSwitcherOpen,
    setWorkspaceDockOpen,
    toggleWorkspaceDock,
    setWorkspaceDockPanel,
    requestWorkspaceDockFile,
    setWorkspaceDockPlacement,
    openAndLocateSessionInSidebar,
    clearSidebarLocateRequest,
    setActiveMainTab,
    enableSessionQuery,
    disableSessionQuery,
    toggleHelpDialog,
    setMcpDialogOpen,
    requestSessionAction,
    clearSessionActionRequest,
    armAbortPrompt,
    clearAbortPrompt,
  }
})

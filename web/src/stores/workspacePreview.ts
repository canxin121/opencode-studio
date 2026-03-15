import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import {
  createWorkspacePreviewSession,
  deleteWorkspacePreviewSession,
  listWorkspacePreviewSessions,
  type WorkspacePreviewSession,
  updateWorkspacePreviewSession,
} from '@/features/workspacePreview/api/workspacePreviewApi'
import type { WorkspacePreviewViewport } from '@/features/workspacePreview/model/previewUrl'
import { getLocalString, setLocalString } from '@/lib/persist'
import { localStorageKeys } from '@/lib/persistence/storageKeys'

const STORAGE_PREVIEW_ACTIVE_SESSION_ID = localStorageKeys.ui.workspacePreviewActiveSessionId
const STORAGE_PREVIEW_SIDEBAR_QUERY = localStorageKeys.ui.workspacePreviewSidebarQuery
const STORAGE_PREVIEW_SIDEBAR_PAGE = localStorageKeys.ui.workspacePreviewSidebarPage
const STORAGE_PREVIEW_VIEWPORT = localStorageKeys.ui.workspacePreviewViewport
const STORAGE_PREVIEW_DESKTOP_WIDTH = localStorageKeys.ui.workspacePreviewViewportDesktopWidth
const STORAGE_PREVIEW_DESKTOP_HEIGHT = localStorageKeys.ui.workspacePreviewViewportDesktopHeight
const STORAGE_PREVIEW_MOBILE_WIDTH = localStorageKeys.ui.workspacePreviewViewportMobileWidth
const STORAGE_PREVIEW_MOBILE_HEIGHT = localStorageKeys.ui.workspacePreviewViewportMobileHeight
const STORAGE_PREVIEW_SCALE = localStorageKeys.ui.workspacePreviewViewportScale
const STORAGE_PREVIEW_TOUCH_SIMULATION = localStorageKeys.ui.workspacePreviewTouchSimulation

const PREVIEW_SIDEBAR_PAGE_SIZE = 24

const VIEWPORT_WIDTH_MIN_PX = 240
const VIEWPORT_WIDTH_MAX_PX = 4096
const VIEWPORT_HEIGHT_MIN_PX = 180
const VIEWPORT_HEIGHT_MAX_PX = 4096
const VIEWPORT_SCALE_MIN_PCT = 25
const VIEWPORT_SCALE_MAX_PCT = 500

const DEFAULT_DESKTOP_VIEWPORT_WIDTH_PX = 1024
const DEFAULT_DESKTOP_VIEWPORT_HEIGHT_PX = 768
const DEFAULT_MOBILE_VIEWPORT_WIDTH_PX = 390
const DEFAULT_MOBILE_VIEWPORT_HEIGHT_PX = 844
const DEFAULT_VIEWPORT_SCALE_PCT = 100
const DEFAULT_TOUCH_SIMULATION = false

const VIEWPORT_PERSIST_DEBOUNCE_MS = 250

function normalizeViewport(value: string): WorkspacePreviewViewport {
  return value === 'mobile' ? 'mobile' : 'desktop'
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const raw = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(raw)) return fallback
  return Math.max(min, Math.min(max, Math.floor(raw)))
}

function readStoredBool(key: string, fallback: boolean): boolean {
  const raw = getLocalString(key).trim().toLowerCase()
  if (!raw) return fallback
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false
  return fallback
}

function readStoredInt(key: string, fallback: number, min: number, max: number): number {
  return clampInt(Number.parseInt(getLocalString(key).trim(), 10), fallback, min, max)
}

function readStoredViewportSize(mode: WorkspacePreviewViewport): { width: number; height: number } {
  if (mode === 'mobile') {
    return {
      width: readStoredInt(
        STORAGE_PREVIEW_MOBILE_WIDTH,
        DEFAULT_MOBILE_VIEWPORT_WIDTH_PX,
        VIEWPORT_WIDTH_MIN_PX,
        VIEWPORT_WIDTH_MAX_PX,
      ),
      height: readStoredInt(
        STORAGE_PREVIEW_MOBILE_HEIGHT,
        DEFAULT_MOBILE_VIEWPORT_HEIGHT_PX,
        VIEWPORT_HEIGHT_MIN_PX,
        VIEWPORT_HEIGHT_MAX_PX,
      ),
    }
  }
  return {
    width: readStoredInt(
      STORAGE_PREVIEW_DESKTOP_WIDTH,
      DEFAULT_DESKTOP_VIEWPORT_WIDTH_PX,
      VIEWPORT_WIDTH_MIN_PX,
      VIEWPORT_WIDTH_MAX_PX,
    ),
    height: readStoredInt(
      STORAGE_PREVIEW_DESKTOP_HEIGHT,
      DEFAULT_DESKTOP_VIEWPORT_HEIGHT_PX,
      VIEWPORT_HEIGHT_MIN_PX,
      VIEWPORT_HEIGHT_MAX_PX,
    ),
  }
}

export const useWorkspacePreviewStore = defineStore('workspacePreview', () => {
  const sessions = ref<WorkspacePreviewSession[]>([])
  const activeSessionId = ref(getLocalString(STORAGE_PREVIEW_ACTIVE_SESSION_ID).trim())

  const sidebarQuery = ref(getLocalString(STORAGE_PREVIEW_SIDEBAR_QUERY))
  const sidebarPage = ref(Math.max(0, Number.parseInt(getLocalString(STORAGE_PREVIEW_SIDEBAR_PAGE).trim(), 10) || 0))

  const viewport = ref<WorkspacePreviewViewport>(normalizeViewport(getLocalString(STORAGE_PREVIEW_VIEWPORT)))
  const storedViewportSize = readStoredViewportSize(viewport.value)
  const viewportWidth = ref<number>(storedViewportSize.width)
  const viewportHeight = ref<number>(storedViewportSize.height)
  const viewportScale = ref<number>(
    readStoredInt(STORAGE_PREVIEW_SCALE, DEFAULT_VIEWPORT_SCALE_PCT, VIEWPORT_SCALE_MIN_PCT, VIEWPORT_SCALE_MAX_PCT),
  )

  // Touch simulation is a responsive-mode feature for desktop pointers.
  // Keep this as a user preference (Firefox-like toggle) instead of auto-enabling.
  const touchSimulation = ref<boolean>(readStoredBool(STORAGE_PREVIEW_TOUCH_SIMULATION, DEFAULT_TOUCH_SIMULATION))

  let viewportPersistTimer: ReturnType<typeof setTimeout> | null = null
  const loading = ref(false)
  const error = ref('')
  const refreshToken = ref(0)

  const activeSession = computed(() => sessions.value.find((session) => session.id === activeSessionId.value) || null)

  function sessionLabel(session: WorkspacePreviewSession): string {
    return String(session.id || '').trim()
  }

  const sidebarQueryNorm = computed(() =>
    String(sidebarQuery.value || '')
      .trim()
      .toLowerCase(),
  )

  const filteredSessions = computed(() => {
    const q = sidebarQueryNorm.value
    if (!q) return sessions.value
    return sessions.value.filter((session) => {
      const haystack = [
        sessionLabel(session),
        session.id,
        session.state,
        session.directory,
        session.targetUrl,
        session.proxyBasePath,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  })

  const sidebarPageCount = computed(() =>
    Math.max(1, Math.ceil(filteredSessions.value.length / PREVIEW_SIDEBAR_PAGE_SIZE)),
  )

  const sidebarPageClamped = computed(() => {
    const maxPage = Math.max(0, sidebarPageCount.value - 1)
    return Math.max(0, Math.min(maxPage, Math.floor(sidebarPage.value || 0)))
  })

  const pagedSessions = computed(() => {
    const page = sidebarPageClamped.value
    const start = page * PREVIEW_SIDEBAR_PAGE_SIZE
    const end = start + PREVIEW_SIDEBAR_PAGE_SIZE
    return filteredSessions.value.slice(start, end)
  })

  watch(activeSessionId, (value) => {
    setLocalString(STORAGE_PREVIEW_ACTIVE_SESSION_ID, String(value || '').trim())
  })

  watch(sidebarQuery, (value) => {
    setLocalString(STORAGE_PREVIEW_SIDEBAR_QUERY, String(value || ''))
  })

  watch(sidebarPage, (value) => {
    setLocalString(STORAGE_PREVIEW_SIDEBAR_PAGE, String(Math.max(0, Math.floor(Number(value) || 0))))
  })

  watch(sidebarQueryNorm, () => {
    // Reset paging when searching.
    sidebarPage.value = 0
  })

  watch(viewport, (value) => {
    setLocalString(STORAGE_PREVIEW_VIEWPORT, value)
  })

  watch(touchSimulation, (value) => {
    setLocalString(STORAGE_PREVIEW_TOUCH_SIMULATION, value ? '1' : '0')
  })

  function scheduleViewportPersist() {
    if (viewportPersistTimer !== null) {
      clearTimeout(viewportPersistTimer)
      viewportPersistTimer = null
    }
    viewportPersistTimer = setTimeout(() => {
      viewportPersistTimer = null

      const width = clampInt(
        viewportWidth.value,
        DEFAULT_DESKTOP_VIEWPORT_WIDTH_PX,
        VIEWPORT_WIDTH_MIN_PX,
        VIEWPORT_WIDTH_MAX_PX,
      )
      const height = clampInt(
        viewportHeight.value,
        DEFAULT_DESKTOP_VIEWPORT_HEIGHT_PX,
        VIEWPORT_HEIGHT_MIN_PX,
        VIEWPORT_HEIGHT_MAX_PX,
      )
      const scale = clampInt(
        viewportScale.value,
        DEFAULT_VIEWPORT_SCALE_PCT,
        VIEWPORT_SCALE_MIN_PCT,
        VIEWPORT_SCALE_MAX_PCT,
      )

      if (viewport.value === 'mobile') {
        setLocalString(STORAGE_PREVIEW_MOBILE_WIDTH, String(width))
        setLocalString(STORAGE_PREVIEW_MOBILE_HEIGHT, String(height))
      } else {
        setLocalString(STORAGE_PREVIEW_DESKTOP_WIDTH, String(width))
        setLocalString(STORAGE_PREVIEW_DESKTOP_HEIGHT, String(height))
      }
      setLocalString(STORAGE_PREVIEW_SCALE, String(scale))
    }, VIEWPORT_PERSIST_DEBOUNCE_MS)
  }

  watch([viewportWidth, viewportHeight, viewportScale, viewport], () => {
    scheduleViewportPersist()
  })

  function ensureActiveSession() {
    const active = String(activeSessionId.value || '').trim()
    if (!active) return
    if (sessions.value.some((session) => session.id === active)) return
    activeSessionId.value = ''
  }

  function ensureSidebarPageInRange() {
    const clamped = sidebarPageClamped.value
    if (clamped !== sidebarPage.value) sidebarPage.value = clamped
  }

  function selectSession(sessionId: string) {
    activeSessionId.value = String(sessionId || '').trim()
    ensureActiveSession()
  }

  function setViewport(value: WorkspacePreviewViewport) {
    const next = value === 'mobile' ? 'mobile' : 'desktop'
    if (viewport.value === next) return

    viewport.value = next
    const size = readStoredViewportSize(next)
    viewportWidth.value = size.width
    viewportHeight.value = size.height
  }

  function setViewportSize(input: { width?: number; height?: number }) {
    if (typeof input.width === 'number') {
      viewportWidth.value = clampInt(input.width, viewportWidth.value, VIEWPORT_WIDTH_MIN_PX, VIEWPORT_WIDTH_MAX_PX)
    }
    if (typeof input.height === 'number') {
      viewportHeight.value = clampInt(
        input.height,
        viewportHeight.value,
        VIEWPORT_HEIGHT_MIN_PX,
        VIEWPORT_HEIGHT_MAX_PX,
      )
    }
  }

  function setViewportScale(value: number) {
    viewportScale.value = clampInt(value, viewportScale.value, VIEWPORT_SCALE_MIN_PCT, VIEWPORT_SCALE_MAX_PCT)
  }

  function setTouchSimulation(value: boolean) {
    touchSimulation.value = Boolean(value)
  }

  function bumpRefreshToken() {
    refreshToken.value += 1
  }

  async function refreshSessions() {
    loading.value = true
    error.value = ''
    try {
      const nextSessions = await listWorkspacePreviewSessions()
      sessions.value = nextSessions
      ensureActiveSession()
      ensureSidebarPageInRange()
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  async function createSession(input: {
    id: string
    directory?: string
    targetUrl: string
    opencodeSessionId?: string
    select?: boolean
  }) {
    const session = await createWorkspacePreviewSession(
      input.id,
      input.directory,
      input.targetUrl,
      input.opencodeSessionId,
    )
    await refreshSessions()
    if (input.select !== false) {
      selectSession(session.id)
      bumpRefreshToken()
    }
    return session
  }

  async function updateSession(
    sessionId: string,
    patch: { directory?: string; opencodeSessionId?: string; targetUrl?: string },
  ) {
    const session = await updateWorkspacePreviewSession(sessionId, patch)
    await refreshSessions()
    if (activeSessionId.value === session.id) bumpRefreshToken()
    return session
  }

  async function deleteSession(sessionId: string) {
    await deleteWorkspacePreviewSession(sessionId)
    if (activeSessionId.value === sessionId) activeSessionId.value = ''
    await refreshSessions()
    bumpRefreshToken()
  }

  return {
    sessions,
    activeSessionId,
    activeSession,
    sidebarQuery,
    sidebarPage,
    sidebarPageCount,
    pagedSessions,
    filteredSessions,
    viewport,
    viewportWidth,
    viewportHeight,
    viewportScale,
    touchSimulation,
    loading,
    error,
    refreshToken,
    selectSession,
    sessionLabel,
    createSession,
    updateSession,
    deleteSession,
    setViewport,
    setViewportSize,
    setViewportScale,
    setTouchSimulation,
    bumpRefreshToken,
    refreshSessions,
  }
})

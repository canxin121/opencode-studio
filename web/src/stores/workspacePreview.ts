import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import {
  listWorkspacePreviewSessions,
  type WorkspacePreviewSession,
} from '@/features/workspacePreview/api/workspacePreviewApi'
import type { WorkspacePreviewScope, WorkspacePreviewViewport } from '@/features/workspacePreview/model/previewUrl'
import { getLocalString, setLocalString } from '@/lib/persist'
import { localStorageKeys } from '@/lib/persistence/storageKeys'

const STORAGE_PREVIEW_ACTIVE_SESSION_ID = localStorageKeys.ui.workspacePreviewActiveSessionId
const STORAGE_PREVIEW_SCOPE = localStorageKeys.ui.workspacePreviewScope
const STORAGE_PREVIEW_VIEWPORT = localStorageKeys.ui.workspacePreviewViewport

function normalizeScope(value: string): WorkspacePreviewScope {
  return value === 'all' ? 'all' : 'current'
}

function listForScope(
  currentSessions: WorkspacePreviewSession[],
  allSessions: WorkspacePreviewSession[],
  scope: WorkspacePreviewScope,
): WorkspacePreviewSession[] {
  return scope === 'all' ? allSessions : currentSessions
}

export const useWorkspacePreviewStore = defineStore('workspacePreview', () => {
  const currentSessions = ref<WorkspacePreviewSession[]>([])
  const allSessions = ref<WorkspacePreviewSession[]>([])
  const activeSessionId = ref(getLocalString(STORAGE_PREVIEW_ACTIVE_SESSION_ID).trim())
  const scope = ref<WorkspacePreviewScope>(normalizeScope(getLocalString(STORAGE_PREVIEW_SCOPE)))
  const viewport = ref<WorkspacePreviewViewport>(
    getLocalString(STORAGE_PREVIEW_VIEWPORT) === 'mobile' ? 'mobile' : 'desktop',
  )
  const loading = ref(false)
  const error = ref('')
  const refreshToken = ref(0)

  const sessions = computed(() => listForScope(currentSessions.value, allSessions.value, scope.value))
  const activeSession = computed(() => sessions.value.find((session) => session.id === activeSessionId.value) || null)

  watch(activeSessionId, (value) => {
    setLocalString(STORAGE_PREVIEW_ACTIVE_SESSION_ID, String(value || '').trim())
  })

  watch(scope, (value) => {
    setLocalString(STORAGE_PREVIEW_SCOPE, value)
  })

  watch(viewport, (value) => {
    setLocalString(STORAGE_PREVIEW_VIEWPORT, value)
  })

  function ensureActiveSession(nextScope = scope.value) {
    const available = listForScope(currentSessions.value, allSessions.value, nextScope)
    if (available.some((session) => session.id === activeSessionId.value)) return
    activeSessionId.value = available[0]?.id || ''
  }

  function setScope(value: WorkspacePreviewScope) {
    scope.value = value === 'all' ? 'all' : 'current'
    ensureActiveSession(scope.value)
  }

  function selectSession(sessionId: string) {
    activeSessionId.value = String(sessionId || '').trim()
    ensureActiveSession(scope.value)
  }

  function setViewport(value: WorkspacePreviewViewport) {
    viewport.value = value === 'mobile' ? 'mobile' : 'desktop'
  }

  function bumpRefreshToken() {
    refreshToken.value += 1
  }

  async function refreshSessions(directory: string, targetScope: WorkspacePreviewScope = scope.value) {
    loading.value = true
    error.value = ''
    try {
      const nextSessions = await listWorkspacePreviewSessions(targetScope === 'current' ? directory : '')
      if (targetScope === 'all') {
        allSessions.value = nextSessions
      } else {
        currentSessions.value = nextSessions
      }
      ensureActiveSession(targetScope === scope.value ? targetScope : scope.value)
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  return {
    currentSessions,
    allSessions,
    sessions,
    activeSessionId,
    activeSession,
    scope,
    viewport,
    loading,
    error,
    refreshToken,
    setScope,
    selectSession,
    setViewport,
    bumpRefreshToken,
    refreshSessions,
  }
})

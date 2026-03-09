import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { resolveWorkspacePreviewUrl } from '@/features/workspacePreview/api/workspacePreviewApi'
import {
  normalizePreviewUrl,
  resolvePreviewTarget,
  type WorkspacePreviewViewport,
} from '@/features/workspacePreview/model/previewUrl'
import { getLocalString, setLocalString } from '@/lib/persist'
import { localStorageKeys } from '@/lib/persistence/storageKeys'

const STORAGE_PREVIEW_MANUAL_URL = localStorageKeys.ui.workspacePreviewManualUrl
const STORAGE_PREVIEW_VIEWPORT = localStorageKeys.ui.workspacePreviewViewport

export const useWorkspacePreviewStore = defineStore('workspacePreview', () => {
  const manualUrl = ref(normalizePreviewUrl(getLocalString(STORAGE_PREVIEW_MANUAL_URL)))
  const detectedUrl = ref('')
  const resolving = ref(false)
  const resolveError = ref('')
  const viewport = ref<WorkspacePreviewViewport>(
    getLocalString(STORAGE_PREVIEW_VIEWPORT) === 'mobile' ? 'mobile' : 'desktop',
  )

  const activeUrl = computed(() => resolvePreviewTarget(manualUrl.value, detectedUrl.value))
  const hasManualUrl = computed(() => Boolean(manualUrl.value))

  watch(manualUrl, (value) => {
    setLocalString(STORAGE_PREVIEW_MANUAL_URL, normalizePreviewUrl(value))
  })

  watch(viewport, (value) => {
    setLocalString(STORAGE_PREVIEW_VIEWPORT, value)
  })

  function setManualUrl(value: string) {
    manualUrl.value = normalizePreviewUrl(value)
  }

  function setViewport(value: WorkspacePreviewViewport) {
    viewport.value = value === 'mobile' ? 'mobile' : 'desktop'
  }

  async function refreshDetectedUrl(directory: string) {
    if (hasManualUrl.value) {
      resolveError.value = ''
      return
    }

    resolving.value = true
    try {
      const resolved = await resolveWorkspacePreviewUrl(directory)
      detectedUrl.value = normalizePreviewUrl(resolved)
      resolveError.value = ''
    } catch (err) {
      resolveError.value = err instanceof Error ? err.message : String(err)
    } finally {
      resolving.value = false
    }
  }

  function clearResolveError() {
    resolveError.value = ''
  }

  return {
    manualUrl,
    detectedUrl,
    activeUrl,
    viewport,
    resolving,
    resolveError,
    hasManualUrl,
    setManualUrl,
    setViewport,
    refreshDetectedUrl,
    clearResolveError,
  }
})

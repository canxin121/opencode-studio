import { defineStore } from 'pinia'
import { ref } from 'vue'

import { apiJson } from '@/lib/api'

type UpdateCheckResponse = {
  available: boolean
  version?: string
  currentVersion?: string
  body?: string
  packageManager?: string
  updateCommand?: string
  error?: string
}

export const useUpdatesStore = defineStore('updates', () => {
  const available = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const latestVersion = ref<string | null>(null)
  const updateCommand = ref<string | null>(null)

  async function checkForUpdates() {
    loading.value = true
    error.value = null
    try {
      const resp = await apiJson<UpdateCheckResponse>('/api/opencode-studio/update-check')
      available.value = Boolean(resp.available)
      latestVersion.value = typeof resp.version === 'string' ? resp.version : null
      updateCommand.value = typeof resp.updateCommand === 'string' ? resp.updateCommand : null
      if (resp.error) {
        error.value = resp.error
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      available.value = false
    } finally {
      loading.value = false
    }
  }

  return { available, loading, error, latestVersion, updateCommand, checkForUpdates }
})

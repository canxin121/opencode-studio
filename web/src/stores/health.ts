import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { apiJson } from '../lib/api'

type Health = {
  status: string
  timestamp: string
  openCodePort: number | null
  openCodeRunning: boolean
  isOpenCodeReady: boolean
  lastOpenCodeError?: string | null
}

export const useHealthStore = defineStore('health', () => {
  const data = ref<Health | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const openCodeConnected = computed(() => Boolean(data.value?.openCodeRunning))

  async function refresh() {
    loading.value = true
    error.value = null
    try {
      data.value = await apiJson<Health>('/health')
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      data.value = null
    } finally {
      loading.value = false
    }
  }

  return { data, loading, error, openCodeConnected, refresh }
})

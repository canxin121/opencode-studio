import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { apiJson } from '../lib/api'

const HEALTH_REQUEST_TIMEOUT_MS = 5000

function timeoutSignal(ms: number): AbortSignal | undefined {
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(ms)
    }
  } catch {
    // ignore
  }
  return undefined
}

export type OpenCodeErrorInfo = {
  code: string
  summary: string
  detail?: string | null
  hint?: string | null
  stderrExcerpt?: string | null
  exitCode?: number | null
  signal?: number | null
}

type Health = {
  status: string
  timestamp: string
  openCodePort: number | null
  openCodeRunning: boolean
  isOpenCodeReady: boolean
  lastOpenCodeError?: string | null
  lastOpenCodeErrorInfo?: OpenCodeErrorInfo | null
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
      data.value = await apiJson<Health>('/health', { signal: timeoutSignal(HEALTH_REQUEST_TIMEOUT_MS) })
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      data.value = null
    } finally {
      loading.value = false
    }
  }

  return { data, loading, error, openCodeConnected, refresh }
})

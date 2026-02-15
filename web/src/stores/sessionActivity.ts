import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { apiJson } from '../lib/api'
import { extractSessionActivityUpdate } from '../lib/sessionActivityEvent.js'
import type { SseEvent } from '../lib/sse'

type Phase = 'idle' | 'busy' | 'cooldown'

type Snapshot = Record<string, { type: Phase }>

export const useSessionActivityStore = defineStore('sessionActivity', () => {
  const snapshot = ref<Snapshot>({})
  const loading = ref(false)
  const error = ref<string | null>(null)

  const sessions = computed(() => Object.entries(snapshot.value))

  async function refresh() {
    loading.value = true
    error.value = null
    try {
      snapshot.value = await apiJson<Snapshot>('/api/session-activity')
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  function applyEvent(evt: SseEvent) {
    const upd = extractSessionActivityUpdate(evt)
    if (!upd) return
    const sessionId = upd.sessionID
    const phase = upd.phase as Phase
    snapshot.value = {
      ...snapshot.value,
      [sessionId]: { type: phase },
    }
  }

  return { snapshot, sessions, loading, error, refresh, applyEvent }
})

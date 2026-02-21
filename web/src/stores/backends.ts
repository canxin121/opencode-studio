import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  ensureBackendsConfigInStorage,
  getActiveBackendTarget,
  normalizeBackendBaseUrl,
  writeBackendsConfigToStorage,
  type BackendTarget,
  type BackendsConfigV1,
} from '@/lib/backend'
import { postAppBroadcast, subscribeAppBroadcast } from '@/lib/appBroadcast'

type AddBackendInput = {
  label: string
  baseUrl: string
  setActive?: boolean
}

type UpdateBackendInput = {
  id: string
  label?: string
  baseUrl?: string
}

const BROADCAST_TYPE = 'backends.updated'

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  } catch {
    // ignore
  }
  return `${Date.now()}-${Math.random()}`
}

function nowMs(): number {
  return Date.now()
}

export const useBackendsStore = defineStore('backends', () => {
  const config = ref<BackendsConfigV1 | null>(null)
  const hydrated = ref(false)

  function hydrate() {
    config.value = ensureBackendsConfigInStorage()
    hydrated.value = true
  }

  // Eager hydrate so the app can read the active backend early.
  hydrate()

  const backends = computed<BackendTarget[]>(() => config.value?.backends || [])
  const activeBackendId = computed<string | null>(() => config.value?.activeBackendId || null)
  const activeBackend = computed<BackendTarget | null>(() => getActiveBackendTarget(config.value))

  function persist(next: BackendsConfigV1, opts?: { broadcast?: boolean }) {
    config.value = next
    writeBackendsConfigToStorage(next)
    if (opts?.broadcast !== false) {
      postAppBroadcast(BROADCAST_TYPE, { activeBackendId: next.activeBackendId, at: nowMs() })
    }
  }

  function setActiveBackend(id: string) {
    const cfg = config.value || ensureBackendsConfigInStorage()
    const trimmed = String(id || '').trim()
    if (!trimmed) return
    if (!cfg.backends.some((b) => b.id === trimmed)) return

    const now = nowMs()
    const nextBackends = cfg.backends.map((b) => (b.id === trimmed ? { ...b, lastUsedAt: now } : b))
    persist({ ...cfg, activeBackendId: trimmed, backends: nextBackends })
  }

  function addBackend(input: AddBackendInput): { ok: true; backend: BackendTarget } | { ok: false; error: string } {
    const cfg = config.value || ensureBackendsConfigInStorage()
    const label = String(input?.label || '').trim()
    const baseUrl = normalizeBackendBaseUrl(String(input?.baseUrl || ''))
    if (!label) return { ok: false, error: 'Label is required' }
    if (!baseUrl) return { ok: false, error: 'Invalid URL' }

    const existing = cfg.backends.find((b) => b.baseUrl === baseUrl)
    const now = nowMs()

    if (existing) {
      const nextBackends = cfg.backends.map((b) =>
        b.id === existing.id ? { ...b, label: label || b.label, lastUsedAt: now } : b,
      )
      const nextActive = input.setActive === false ? cfg.activeBackendId : existing.id
      persist({ ...cfg, activeBackendId: nextActive, backends: nextBackends })
      return { ok: true, backend: { ...existing, label: label || existing.label, lastUsedAt: now } }
    }

    const backend: BackendTarget = {
      id: randomId(),
      label,
      baseUrl,
      createdAt: now,
      lastUsedAt: now,
    }

    const nextBackends = [backend, ...cfg.backends]
    const nextActive = input.setActive === false ? cfg.activeBackendId : backend.id
    persist({ ...cfg, activeBackendId: nextActive, backends: nextBackends })
    return { ok: true, backend }
  }

  function updateBackend(input: UpdateBackendInput): { ok: true } | { ok: false; error: string } {
    const cfg = config.value || ensureBackendsConfigInStorage()
    const id = String(input?.id || '').trim()
    if (!id) return { ok: false, error: 'Missing backend id' }

    const existing = cfg.backends.find((b) => b.id === id)
    if (!existing) return { ok: false, error: 'Backend not found' }

    const nextLabel = typeof input.label === 'string' ? input.label.trim() : existing.label
    const nextBaseUrl =
      typeof input.baseUrl === 'string' ? normalizeBackendBaseUrl(input.baseUrl) : existing.baseUrl
    if (!nextLabel) return { ok: false, error: 'Label is required' }
    if (!nextBaseUrl) return { ok: false, error: 'Invalid URL' }

    const conflict = cfg.backends.find((b) => b.id !== id && b.baseUrl === nextBaseUrl)
    if (conflict) return { ok: false, error: 'Another backend already uses that URL' }

    const nextBackends = cfg.backends.map((b) => (b.id === id ? { ...b, label: nextLabel, baseUrl: nextBaseUrl } : b))
    persist({ ...cfg, backends: nextBackends })
    return { ok: true }
  }

  function removeBackend(id: string): { ok: true } | { ok: false; error: string } {
    const cfg = config.value || ensureBackendsConfigInStorage()
    const trimmed = String(id || '').trim()
    if (!trimmed) return { ok: false, error: 'Missing backend id' }
    if (cfg.backends.length <= 1) return { ok: false, error: 'At least one backend is required' }

    const nextBackends = cfg.backends.filter((b) => b.id !== trimmed)
    if (nextBackends.length === cfg.backends.length) return { ok: false, error: 'Backend not found' }

    const nextActive = cfg.activeBackendId === trimmed ? nextBackends[0]?.id || null : cfg.activeBackendId
    persist({ ...cfg, activeBackendId: nextActive, backends: nextBackends })
    return { ok: true }
  }

  // Keep state in sync across tabs.
  if (typeof window !== 'undefined') {
    subscribeAppBroadcast((msg) => {
      if (msg.type !== BROADCAST_TYPE) return
      hydrate()
    })
  }

  return {
    hydrated,
    config,
    backends,
    activeBackendId,
    activeBackend,
    hydrate,
    addBackend,
    updateBackend,
    removeBackend,
    setActiveBackend,
  }
})

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { ApiError, apiJson, apiUrl } from '../lib/api'
import { buildActiveUiAuthHeaders, clearUiAuthTokenForBaseUrl, writeUiAuthTokenForBaseUrl } from '../lib/uiAuthToken'
import { normalizeBackendBaseUrl, readActiveBackendBaseUrl } from '../lib/backend'
import { desktopConfigGet, isDesktopRuntime } from '../lib/desktopConfig'

const AUTH_REQUEST_TIMEOUT_MS = 5000

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

type AuthStatusOk = { authenticated: boolean; disabled?: boolean; token?: string }
type AuthStatusLocked = { authenticated: boolean; locked: boolean }

function normalizeDesktopConnectHost(host: string): string {
  const trimmed = String(host || '').trim()
  if (!trimmed || trimmed === '0.0.0.0') return '127.0.0.1'
  if (trimmed === '::' || trimmed === '[::]') return '::1'
  return trimmed
}

function toDesktopLocalBackendBaseUrl(host: string, port: number): string {
  const normalizedHost = normalizeDesktopConnectHost(host)
  const numericPort = Number.isFinite(Number(port)) ? Math.floor(Number(port)) : 0
  if (!normalizedHost || numericPort < 1 || numericPort > 65535) return ''
  const bracketHost =
    normalizedHost.includes(':') && !normalizedHost.startsWith('[') ? `[${normalizedHost}]` : normalizedHost
  return normalizeBackendBaseUrl(`http://${bracketHost}:${numericPort}`)
}

export const useAuthStore = defineStore('auth', () => {
  const checked = ref(false)
  const authenticated = ref(false)
  const locked = ref(false)
  const disabled = ref(false)
  const lastError = ref<string | null>(null)
  const desktopAutoLoginInFlight = ref(false)
  const desktopAutoLoginTriedFor = ref<string>('')

  const needsLogin = computed(() => checked.value && !disabled.value && locked.value)

  function requireLogin() {
    // Force the app into the locked state immediately (e.g. when an API call returns auth_required).
    checked.value = true
    authenticated.value = false
    disabled.value = false
    locked.value = true
    lastError.value = null

    // Clear any stored token for the active backend so we don't keep sending a stale credential.
    try {
      clearUiAuthTokenForBaseUrl(readActiveBackendBaseUrl())
    } catch {
      // ignore
    }
  }

  async function refresh() {
    lastError.value = null
    try {
      const authHeaders = buildActiveUiAuthHeaders()
      const resp = await fetch(apiUrl('/auth/session'), {
        signal: timeoutSignal(AUTH_REQUEST_TIMEOUT_MS),
        headers: {
          accept: 'application/json',
          ...authHeaders,
        },
        credentials: authHeaders.authorization ? 'omit' : 'include',
      })
      checked.value = true
      if (resp.ok) {
        const data = (await resp.json()) as AuthStatusOk
        authenticated.value = Boolean(data.authenticated)
        disabled.value = Boolean(data.disabled)
        locked.value = false

        // Best-effort: if the backend returns a token (optional), persist it.
        const token = typeof data.token === 'string' ? data.token.trim() : ''
        if (token) {
          writeUiAuthTokenForBaseUrl(readActiveBackendBaseUrl(), token)
        }
        return
      }

      if (resp.status === 401) {
        const data = (await resp.json().catch(() => null)) as AuthStatusLocked | null
        authenticated.value = false
        disabled.value = false
        locked.value = Boolean(data?.locked)

        // Token is missing/invalid.
        clearUiAuthTokenForBaseUrl(readActiveBackendBaseUrl())

        if (!desktopAutoLoginInFlight.value && (await tryDesktopAutoLogin())) {
          return
        }
        return
      }

      const txt = await resp.text().catch(() => '')
      lastError.value = txt || `Auth status failed (${resp.status})`
      authenticated.value = false
      disabled.value = false
      locked.value = false
    } catch (err) {
      checked.value = true
      lastError.value = err instanceof Error ? err.message : String(err)
      authenticated.value = false
      disabled.value = false
      locked.value = false
    }
  }

  async function login(password: string) {
    lastError.value = null
    try {
      const data = await apiJson<AuthStatusOk>('/auth/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      const token = typeof data?.token === 'string' ? data.token.trim() : ''
      if (token) {
        writeUiAuthTokenForBaseUrl(readActiveBackendBaseUrl(), token)
      }
      await refresh()
    } catch (err) {
      if (err instanceof ApiError) {
        lastError.value = err.message || err.bodyText || null
      } else {
        lastError.value = err instanceof Error ? err.message : String(err)
      }
      await refresh()
    }
  }

  async function tryDesktopAutoLogin(): Promise<boolean> {
    if (!isDesktopRuntime()) return false

    const activeBaseUrl = normalizeBackendBaseUrl(readActiveBackendBaseUrl())
    if (!activeBaseUrl) return false
    if (desktopAutoLoginTriedFor.value === activeBaseUrl) return false

    const cfg = await desktopConfigGet().catch(() => null)
    if (!cfg) return false

    const localDesktopBaseUrl = toDesktopLocalBackendBaseUrl(cfg.backend.host, cfg.backend.port)
    if (!localDesktopBaseUrl || localDesktopBaseUrl !== activeBaseUrl) return false

    const uiPassword = String(cfg.backend.ui_password || '').trim()
    if (!uiPassword) return false

    desktopAutoLoginTriedFor.value = activeBaseUrl
    desktopAutoLoginInFlight.value = true
    try {
      await login(uiPassword)
      return !needsLogin.value
    } finally {
      desktopAutoLoginInFlight.value = false
    }
  }

  return {
    lastError,
    needsLogin,
    refresh,
    login,
    requireLogin,
  }
})

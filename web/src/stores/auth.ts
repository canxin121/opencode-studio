import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { ApiError, apiJson, apiUrl } from '../lib/api'
import { buildActiveUiAuthHeaders, clearUiAuthTokenForBaseUrl, writeUiAuthTokenForBaseUrl } from '../lib/uiAuthToken'
import { readActiveBackendBaseUrl } from '../lib/backend'

type AuthStatusOk = { authenticated: boolean; disabled?: boolean; token?: string }
type AuthStatusLocked = { authenticated: boolean; locked: boolean }

export const useAuthStore = defineStore('auth', () => {
  const checked = ref(false)
  const authenticated = ref(false)
  const locked = ref(false)
  const disabled = ref(false)
  const lastError = ref<string | null>(null)

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

  return {
    lastError,
    needsLogin,
    refresh,
    login,
    requireLogin,
  }
})

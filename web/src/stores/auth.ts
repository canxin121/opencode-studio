import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { ApiError, apiJson } from '../lib/api'

type AuthStatusOk = { authenticated: boolean; disabled?: boolean }
type AuthStatusLocked = { authenticated: boolean; locked: boolean }

export const useAuthStore = defineStore('auth', () => {
  const checked = ref(false)
  const authenticated = ref(false)
  const locked = ref(false)
  const disabled = ref(false)
  const lastError = ref<string | null>(null)

  const needsLogin = computed(() => checked.value && !disabled.value && locked.value)

  async function refresh() {
    lastError.value = null
    try {
      const resp = await fetch('/auth/session', { headers: { accept: 'application/json' } })
      checked.value = true
      if (resp.ok) {
        const data = (await resp.json()) as AuthStatusOk
        authenticated.value = Boolean(data.authenticated)
        disabled.value = Boolean(data.disabled)
        locked.value = false
        return
      }

      if (resp.status === 401) {
        const data = (await resp.json().catch(() => null)) as AuthStatusLocked | null
        authenticated.value = false
        disabled.value = false
        locked.value = Boolean(data?.locked)
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
      await apiJson<AuthStatusOk>('/auth/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      })
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
  }
})

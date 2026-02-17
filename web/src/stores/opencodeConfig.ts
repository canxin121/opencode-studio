import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { ApiError, apiJson } from '@/lib/api'
import { postAppBroadcast } from '@/lib/appBroadcast'
import { useDirectoryStore } from '@/stores/directory'
import type { JsonValue as JsonLike } from '@/types/json'

export type OpencodeConfigScope = 'user' | 'project' | 'custom'

export type OpencodeConfigPaths = {
  user?: string
  project?: string
  custom?: string
}

export type OpencodeConfigResponse = {
  scope: OpencodeConfigScope
  path?: string
  exists: boolean
  config: Record<string, JsonLike>
  paths: OpencodeConfigPaths
}

type RefreshOptions = {
  scope?: OpencodeConfigScope
  directory?: string | null
}

export const useOpencodeConfigStore = defineStore('opencodeConfig', () => {
  const directoryStore = useDirectoryStore()

  const data = ref<Record<string, JsonLike> | null>(null)
  const paths = ref<OpencodeConfigPaths | null>(null)
  const activePath = ref<string | null>(null)
  const scope = ref<OpencodeConfigScope>('user')
  const exists = ref<boolean | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const activeDirectory = computed(() => directoryStore.currentDirectory || null)

  function buildQuery(opts?: RefreshOptions) {
    const params: string[] = []
    const scopeValue = (opts?.scope || scope.value || 'user').trim()
    if (scopeValue) params.push(`scope=${encodeURIComponent(scopeValue)}`)
    const dir = opts?.directory || activeDirectory.value
    if (dir) params.push(`directory=${encodeURIComponent(dir)}`)
    return params.length ? `?${params.join('&')}` : ''
  }

  async function refresh(opts?: RefreshOptions) {
    loading.value = true
    error.value = null
    try {
      const resp = await apiJson<OpencodeConfigResponse>(`/api/config/opencode${buildQuery(opts)}`)
      data.value = resp.config || {}
      paths.value = resp.paths || null
      activePath.value = resp.path || null
      scope.value = resp.scope || scope.value
      exists.value = typeof resp.exists === 'boolean' ? resp.exists : null
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      data.value = null
      paths.value = null
      activePath.value = null
      exists.value = null
    } finally {
      loading.value = false
    }
  }

  async function save(config: Record<string, JsonLike>, opts?: RefreshOptions) {
    error.value = null
    try {
      const resp = await apiJson<OpencodeConfigResponse>(`/api/config/opencode${buildQuery(opts)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(config || {}),
      })
      data.value = resp.config || {}
      paths.value = resp.paths || null
      activePath.value = resp.path || null
      scope.value = resp.scope || scope.value
      exists.value = typeof resp.exists === 'boolean' ? resp.exists : null
      postAppBroadcast('opencodeConfig.updated', { updatedAt: Date.now(), scope: scope.value })
    } catch (err) {
      if (err instanceof ApiError) {
        error.value = err.message || err.bodyText || null
      } else {
        error.value = err instanceof Error ? err.message : String(err)
      }
      throw err
    }
  }

  return {
    data,
    paths,
    activePath,
    scope,
    exists,
    loading,
    error,
    refresh,
    save,
  }
})

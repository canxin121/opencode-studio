import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { fetchPluginList, fetchPluginManifest, invokePluginAction } from '@/plugins/host/api'
import type { JsonValue as JsonLike } from '@/types/json'
import type { PluginActionResponse, PluginListItem, PluginManifestResponse } from '@/plugins/host/types'
import { useOpencodeConfigStore } from '@/stores/opencodeConfig'

export type PluginRuntimeHealth = 'loading' | 'ready' | 'degraded' | 'unavailable'

export const usePluginHostStore = defineStore('pluginHost', () => {
  const opencodeConfig = useOpencodeConfigStore()

  const plugins = ref<PluginListItem[]>([])
  const manifestsById = ref<Record<string, PluginManifestResponse>>({})
  const sourceSpecs = ref<string[]>([])
  const updatedAt = ref(0)
  const loading = ref(false)
  const bootstrapped = ref(false)
  const error = ref<string | null>(null)

  const readyPlugins = computed(() => plugins.value.filter((item) => item.status === 'ready'))
  const degradedPlugins = computed(() => plugins.value.filter((item) => item.status !== 'ready'))

  const health = computed<PluginRuntimeHealth>(() => {
    if (loading.value) return 'loading'
    if (error.value && plugins.value.length === 0) return 'unavailable'
    if (degradedPlugins.value.length > 0) return 'degraded'
    return 'ready'
  })

  const runtimeReady = computed(() => bootstrapped.value && health.value !== 'unavailable')

  async function refreshList() {
    loading.value = true
    error.value = null
    try {
      const resp = await fetchPluginList()
      plugins.value = Array.isArray(resp.plugins) ? resp.plugins : []
      sourceSpecs.value = Array.isArray(resp.sourceSpecs) ? resp.sourceSpecs : []
      updatedAt.value = Number.isFinite(resp.updatedAt) ? Math.max(0, Math.floor(resp.updatedAt)) : 0

      const keep = new Set(plugins.value.map((item) => item.id))
      const next: Record<string, PluginManifestResponse> = {}
      for (const [id, manifest] of Object.entries(manifestsById.value)) {
        if (keep.has(id)) next[id] = manifest
      }
      manifestsById.value = next
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      plugins.value = []
      sourceSpecs.value = []
      updatedAt.value = 0
    } finally {
      loading.value = false
    }
  }

  async function loadManifest(pluginId: string) {
    const id = String(pluginId || '').trim()
    if (!id) return null
    try {
      const manifest = await fetchPluginManifest(id)
      manifestsById.value = { ...manifestsById.value, [id]: manifest }
      return manifest
    } catch {
      return null
    }
  }

  async function preloadReadyManifests() {
    const targets = readyPlugins.value.filter((item) => !manifestsById.value[item.id])
    await Promise.all(targets.map((item) => loadManifest(item.id)))
  }

  async function bootstrap() {
    loading.value = true
    error.value = null
    try {
      await opencodeConfig.refresh().catch(() => {})
      await refreshList()
      await preloadReadyManifests()
    } finally {
      bootstrapped.value = true
      loading.value = false
    }
  }

  function getManifest(pluginId: string): PluginManifestResponse | null {
    const id = String(pluginId || '').trim()
    if (!id) return null
    return manifestsById.value[id] ?? null
  }

  async function action(
    pluginId: string,
    actionName: string,
    payload: JsonLike = null,
    context: JsonLike = null,
  ): Promise<PluginActionResponse> {
    return await invokePluginAction(pluginId, actionName, payload, context)
  }

  async function pluginConfigGet(pluginId: string): Promise<PluginActionResponse> {
    return await action(pluginId, 'config.get', null, null)
  }

  async function pluginConfigSet(pluginId: string, config: JsonLike): Promise<PluginActionResponse> {
    return await action(pluginId, 'config.set', config, null)
  }

  return {
    plugins,
    manifestsById,
    sourceSpecs,
    updatedAt,
    loading,
    bootstrapped,
    error,
    readyPlugins,
    degradedPlugins,
    health,
    runtimeReady,
    bootstrap,
    refreshList,
    loadManifest,
    preloadReadyManifests,
    getManifest,
    action,
    pluginConfigGet,
    pluginConfigSet,
  }
})

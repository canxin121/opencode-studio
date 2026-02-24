import { computed, ref, type Ref } from 'vue'

import { apiJson } from '../../lib/api'
import { extractConfigDefaults } from './modelSelectionDefaults'
import type { OpencodeConfigResponse } from '../../stores/opencodeConfig'
import type { JsonValue as JsonLike } from '../../types/json'

export type Provider = { id: string; name?: string; models?: JsonLike }
type ProvidersConfigResp = { providers: Provider[]; default?: Record<string, string> }
export type Agent = { name: string; description?: string; mode?: string; hidden?: boolean; disable?: boolean }
export type ModelMetaRecord = Record<string, JsonLike>

export type OpencodeConfigStoreLike = {
  data: OpencodeConfigResponse['config'] | null
  scope: string
  exists: boolean | null
  refresh: (opts: { scope: 'project' | 'user'; directory: string | null }) => Promise<void>
}

function isRecord(value: JsonLike): value is ModelMetaRecord {
  return typeof value === 'object' && value !== null
}

function asRecord(value: JsonLike): ModelMetaRecord {
  return isRecord(value) ? value : {}
}

export function modelIdsFromProviderModels(models: JsonLike): string[] {
  if (!models) return []
  if (Array.isArray(models)) {
    return models
      .map((m) => {
        const rec = asRecord(m)
        return typeof rec.id === 'string' ? rec.id.trim() : ''
      })
      .filter(Boolean)
  }
  if (isRecord(models)) {
    return Object.keys(models)
  }
  return []
}

export function isSelectablePrimaryAgent(agent: Agent | null | undefined): boolean {
  if (!agent) return false
  const name = String(agent.name || '').trim()
  if (!name) return false
  if (agent.disable === true) return false
  if (agent.hidden === true) return false
  if (agent.mode === 'subagent') return false
  return true
}

export function useModelSelectionCatalog(opts: {
  opencodeConfig: OpencodeConfigStoreLike
  sessionDirectory: Ref<string>
}) {
  const { opencodeConfig, sessionDirectory } = opts

  const projectConfigLayer = ref<ModelMetaRecord | null>(null)
  const userConfigLayer = ref<ModelMetaRecord | null>(null)
  const providerDefaultModels = ref<Record<string, string>>({})

  const providers = ref<Provider[]>([])
  const agents = ref<Agent[]>([])

  const resolvedOpencodeConfig = computed(() => {
    return projectConfigLayer.value || userConfigLayer.value || {}
  })

  const shareDisabled = computed(() => {
    const cfg = resolvedOpencodeConfig.value
    return String(cfg?.share || '').trim() === 'disabled'
  })

  const projectConfigDefaults = computed(() => extractConfigDefaults(projectConfigLayer.value))
  const userConfigDefaults = computed(() => extractConfigDefaults(userConfigLayer.value))

  const fallbackAgent = computed(() => (agents.value[0]?.name || '').trim())
  const fallbackProviderModel = computed(() => {
    const first = providers.value[0]
    const provider = typeof first?.id === 'string' ? first.id.trim() : ''
    if (!provider) return { provider: '', model: '' }

    const ids = modelIdsFromProviderModels(first?.models)
    const idSet = new Set(ids)
    const candidate = (providerDefaultModels.value[provider] || '').trim()
    const model = candidate && idSet.has(candidate) ? candidate : ids[0] || ''
    return { provider, model }
  })

  function providerListFromConfig(): Provider[] {
    const cfg = resolvedOpencodeConfig.value
    const out: Provider[] = []
    const providerMap = cfg?.provider
    if (!isRecord(providerMap)) return out

    for (const [id, value] of Object.entries(providerMap)) {
      const label = String(id).trim()
      if (!label) continue
      const valueRecord = asRecord(value)
      const name = typeof valueRecord.name === 'string' ? valueRecord.name : undefined
      const modelsRaw = valueRecord.models
      const models = Array.isArray(modelsRaw) || isRecord(modelsRaw) ? modelsRaw : undefined
      out.push({ id: label, name, models })
    }
    return out
  }

  function ensureDefaultProviderInList(list: Provider[]) {
    const def = (projectConfigDefaults.value.defaultProvider || userConfigDefaults.value.defaultProvider || '').trim()
    if (!def) return list
    if (list.some((p) => p.id === def)) return list
    return [...list, { id: def, name: def, models: {} }]
  }

  function mergeProviderLists(primary: Provider[], fallback: Provider[]) {
    const fallbackMap = new Map<string, Provider>()
    for (const p of fallback) fallbackMap.set(p.id, p)

    const out: Provider[] = []
    const seen = new Set<string>()
    for (const p of primary) {
      const existing = fallbackMap.get(p.id)
      out.push(existing ? { ...existing, ...p, models: p.models || existing.models } : p)
      seen.add(p.id)
    }
    for (const p of fallback) {
      if (!seen.has(p.id)) out.push(p)
    }
    return out
  }

  function modelMetaFor(providerId: string, modelId: string): ModelMetaRecord | null {
    const pid = (providerId || '').trim()
    const mid = (modelId || '').trim()
    if (!pid || !mid) return null

    const fromRemote = providers.value.find((p) => p.id === pid)
    const remoteModels = fromRemote?.models
    if (Array.isArray(remoteModels)) {
      const match = remoteModels.find((m) => {
        const rec = asRecord(m)
        return typeof rec.id === 'string' && rec.id.trim() === mid
      })
      return isRecord(match) ? match : null
    }
    if (isRecord(remoteModels) && !Array.isArray(remoteModels)) {
      const candidate = remoteModels[mid]
      return isRecord(candidate) ? candidate : null
    }

    const fromCfg = providerListFromConfig().find((p) => p.id === pid)
    const cfgModels = fromCfg?.models
    if (Array.isArray(cfgModels)) {
      const match = cfgModels.find((m) => {
        const rec = asRecord(m)
        return typeof rec.id === 'string' && rec.id.trim() === mid
      })
      return isRecord(match) ? match : null
    }
    if (isRecord(cfgModels) && !Array.isArray(cfgModels)) {
      const candidate = cfgModels[mid]
      return isRecord(candidate) ? candidate : null
    }

    return null
  }

  function dirQuery(): string {
    const dir = sessionDirectory.value
    return dir ? `?directory=${encodeURIComponent(dir)}` : ''
  }

  async function refreshOpencodeConfig() {
    const dir = sessionDirectory.value
    const scope = dir ? 'project' : 'user'
    projectConfigLayer.value = null
    userConfigLayer.value = null

    try {
      await opencodeConfig.refresh({ scope, directory: dir || null })
    } catch {
      // ignore
    }

    if (scope === 'project' && opencodeConfig.exists !== false) {
      projectConfigLayer.value = isRecord(opencodeConfig.data) ? opencodeConfig.data : {}
    }
    if (scope === 'user') {
      userConfigLayer.value = isRecord(opencodeConfig.data) ? opencodeConfig.data : {}
    }

    if (scope === 'project') {
      try {
        const resp = await apiJson<OpencodeConfigResponse>('/api/config/opencode?scope=user')
        userConfigLayer.value = isRecord(resp?.config) ? resp.config : {}
      } catch {
        userConfigLayer.value = {}
      }
    }
  }

  function agentListFromConfig(): Agent[] {
    const cfg = resolvedOpencodeConfig.value
    const entries: Agent[] = []
    const agentMap = cfg?.agent
    const modeMap = cfg?.mode

    const readMap = (map: ModelMetaRecord | null | undefined) => {
      if (!isRecord(map)) return
      for (const [name, value] of Object.entries(map)) {
        const label = String(name).trim()
        if (!label) continue

        const rec = asRecord(value)
        const description = typeof rec.description === 'string' ? rec.description : undefined
        const mode = typeof rec.mode === 'string' ? rec.mode : undefined
        const hidden = typeof rec.hidden === 'boolean' ? rec.hidden : undefined
        const disable = typeof rec.disable === 'boolean' ? rec.disable : undefined

        if (disable === true) continue
        if (hidden === true) continue
        if (mode === 'subagent') continue
        if (!mode && (label === 'general' || label === 'explore')) continue

        entries.push({ name: label, description, mode, hidden, disable })
      }
    }

    readMap(isRecord(agentMap) ? agentMap : undefined)
    if (isRecord(modeMap)) {
      const decorated: ModelMetaRecord = {}
      for (const [k, v] of Object.entries(modeMap)) {
        decorated[k] = { ...asRecord(v), mode: 'primary' }
      }
      readMap(decorated)
    }

    const defaultAgent = (
      projectConfigDefaults.value.defaultAgent ||
      userConfigDefaults.value.defaultAgent ||
      ''
    ).trim()
    if (defaultAgent && !entries.some((a) => a.name === defaultAgent)) {
      entries.push({ name: defaultAgent })
    }

    return entries.filter(isSelectablePrimaryAgent)
  }

  async function loadProvidersAndAgents() {
    await refreshOpencodeConfig()

    try {
      const resp = await apiJson<ProvidersConfigResp>(`/api/config/providers${dirQuery()}`)
      const list = Array.isArray(resp?.providers) ? resp.providers : []
      const defaults = resp?.default
      const nextProviderDefaults: Record<string, string> = {}
      if (isRecord(defaults) && !Array.isArray(defaults)) {
        for (const [providerID, modelID] of Object.entries(defaults)) {
          const pid = String(providerID || '').trim()
          const mid = typeof modelID === 'string' ? modelID.trim() : ''
          if (pid && mid) nextProviderDefaults[pid] = mid
        }
      }
      providerDefaultModels.value = nextProviderDefaults
      providers.value = ensureDefaultProviderInList(mergeProviderLists(list, providerListFromConfig()))
    } catch {
      providerDefaultModels.value = {}
      providers.value = ensureDefaultProviderInList(mergeProviderLists([], providerListFromConfig()))
    }

    try {
      const resp = await apiJson<JsonLike>(`/api/agent${dirQuery()}`)
      const list: Agent[] = Array.isArray(resp)
        ? resp
            .map((a) => {
              const rec = asRecord(a)
              return {
                name: typeof rec.name === 'string' ? rec.name.trim() : '',
                description: typeof rec.description === 'string' ? rec.description : undefined,
                mode: typeof rec.mode === 'string' ? rec.mode : undefined,
                hidden: typeof rec.hidden === 'boolean' ? rec.hidden : undefined,
              }
            })
            .filter((a: Agent) => Boolean(a.name))
        : []

      const primary = list.filter(isSelectablePrimaryAgent)
      agents.value = primary.length ? primary : agentListFromConfig()
    } catch {
      agents.value = agentListFromConfig()
    }
  }

  return {
    providers,
    agents,
    shareDisabled,
    projectConfigDefaults,
    userConfigDefaults,
    fallbackAgent,
    fallbackProviderModel,
    modelMetaFor,
    loadProvidersAndAgents,
  }
}

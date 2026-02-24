import { computed, ref, type Ref } from 'vue'

import { i18n } from '@/i18n'

import type { AgentListItem, ProviderListItem, RemoteModel } from './OpenCodeConfigPanelOptionTypes'

type ConfigValue = unknown
type ConfigRecord = Record<string, ConfigValue>

export type ProvidersConfigResp = {
  providers?: ProviderListItem[]
  default?: Record<string, string>
}

type ModelEntry = {
  slug: string
  providerId: string
  modelId: string
  meta?: RemoteModel
  ctx?: number
  out?: number
  costIn?: number
  costOut?: number
  costTotal?: number
  status?: string
  family?: string
  tools?: boolean
  reasoning?: boolean
  image?: boolean
  pdf?: boolean
  releaseMs?: number
}

type ToastKind = 'info' | 'success' | 'error'

function isRecord(value: ConfigValue): value is ConfigRecord {
  return typeof value === 'object' && value !== null
}

function asRecord(value: ConfigValue): ConfigRecord {
  return isRecord(value) ? value : {}
}

export function useOpenCodeConfigPanelOptionLists(opts: {
  draft: Ref<ConfigValue>
  providersList: Ref<Array<[string, ConfigValue]>>
  defaultAgent: Ref<string>
  model: Ref<string>
  smallModel: Ref<string>

  apiJson: <T>(path: string, init?: RequestInit) => Promise<T>
  dirQuery: () => string
  toasts: { push: (kind: ToastKind, message: string, timeoutMs?: number) => void }
}) {
  const optionsLoading = ref(false)
  const optionsLoaded = ref(false)
  const optionsError = ref<string | null>(null)
  const agentsRemote = ref<AgentListItem[]>([])
  const providersRemote = ref<ProviderListItem[]>([])
  const toolIdsRemote = ref<string[]>([])
  const toolIdsError = ref<string | null>(null)

  function modelIdsFromProviderModels(models: ConfigValue): string[] {
    if (!models) return []
    if (Array.isArray(models)) {
      return models
        .map((m) => {
          const entry = asRecord(m)
          return typeof entry.id === 'string' ? entry.id.trim() : ''
        })
        .filter(Boolean)
    }
    if (typeof models === 'object') {
      return Object.keys(asRecord(models))
        .map((s) => s.trim())
        .filter(Boolean)
    }
    return []
  }

  function modelsFromProviderModels(models: ConfigValue): RemoteModel[] {
    if (!models) return []
    if (Array.isArray(models)) {
      return models
        .map((m) => {
          const entry = asRecord(m)
          const id = typeof entry.id === 'string' ? entry.id.trim() : ''
          if (!id) return null
          const name = typeof entry.name === 'string' ? entry.name : undefined
          const family = typeof entry.family === 'string' ? entry.family : undefined
          const status = typeof entry.status === 'string' ? entry.status : undefined
          const release_date = typeof entry.release_date === 'string' ? entry.release_date : undefined
          const limit = isRecord(entry.limit) ? entry.limit : undefined
          const capabilities = isRecord(entry.capabilities) ? entry.capabilities : undefined
          const cost = isRecord(entry.cost) ? entry.cost : undefined
          return { id, name, family, status, release_date, limit, capabilities, cost } as RemoteModel
        })
        .filter(Boolean) as RemoteModel[]
    }
    if (typeof models === 'object') {
      // OpenCode returns a map of modelId -> model config.
      return Object.entries(asRecord(models))
        .map(([id, raw]) => {
          const modelId = String(id || '').trim()
          if (!modelId) return null
          const m = asRecord(raw)

          const name = typeof m?.name === 'string' ? m.name : undefined
          const family = typeof m?.family === 'string' ? m.family : undefined
          const status = typeof m?.status === 'string' ? m.status : undefined
          const release_date = typeof m?.release_date === 'string' ? m.release_date : undefined
          const providerID = typeof m?.providerID === 'string' ? m.providerID : undefined
          const api = typeof m?.api === 'string' ? m.api : undefined
          const limit = m?.limit && typeof m.limit === 'object' ? m.limit : undefined
          const capabilities = m?.capabilities && typeof m.capabilities === 'object' ? m.capabilities : undefined
          const cost = m?.cost && typeof m.cost === 'object' ? m.cost : undefined
          const options = m?.options
          const headers = m?.headers && typeof m.headers === 'object' ? m.headers : undefined

          return {
            id: modelId,
            providerID,
            api,
            name,
            family,
            status,
            release_date,
            limit,
            capabilities,
            cost,
            options,
            headers,
          } as RemoteModel
        })
        .filter(Boolean) as RemoteModel[]
    }
    return []
  }

  function formatCompactNumber(value: number | null | undefined): string {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : NaN
    if (!Number.isFinite(n)) return ''
    if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}m`
    if (n >= 1_000) return `${Math.round(n / 1_000)}k`
    return String(Math.round(n))
  }

  function formatCost(value: number | null | undefined): string {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : NaN
    if (!Number.isFinite(n)) return ''
    // Keep it compact but not too lossy.
    const s = n.toFixed(6)
    return s.replace(/0+$/, '').replace(/\.$/, '')
  }

  function formatModelMeta(meta: RemoteModel | undefined): string {
    if (!meta) return ''
    const bits: string[] = []
    const ctx = formatCompactNumber(meta.limit?.context)
    const out = formatCompactNumber(meta.limit?.output)
    if (ctx) bits.push(`ctx ${ctx}`)
    if (out) bits.push(`out ${out}`)
    if (meta.capabilities?.toolcall === true) bits.push('tools')
    if (meta.capabilities?.reasoning === true) bits.push('reasoning')
    if (meta.capabilities?.input?.image === true) bits.push('image')
    if (meta.capabilities?.input?.pdf === true) bits.push('pdf')
    if (meta.status) bits.push(meta.status)
    return bits.join(' · ')
  }

  function formatModelCost(meta: RemoteModel | undefined): string {
    if (!meta?.cost) return ''
    const bits: string[] = []
    const cin = formatCost(meta.cost.input)
    const cout = formatCost(meta.cost.output)
    const cr = formatCost(meta.cost.cache?.read)
    const cw = formatCost(meta.cost.cache?.write)
    if (cin) bits.push(`in ${cin}`)
    if (cout) bits.push(`out ${cout}`)
    if (cr || cw) bits.push(`cache r ${cr || '—'} w ${cw || '—'}`)
    return bits.length ? `cost ${bits.join(' · ')}` : ''
  }

  function parseDateMs(value: string | undefined): number {
    const s = String(value || '').trim()
    if (!s) return 0
    const ms = Date.parse(s)
    return Number.isFinite(ms) ? ms : 0
  }

  function agentEntriesFromConfig(): AgentListItem[] {
    const cfg = asRecord(opts.draft.value)
    const out: AgentListItem[] = []
    const seen = new Set<string>()

    const isDisabled = (name: string): boolean => {
      const n = String(name || '').trim()
      if (!n) return false
      // Match OpenCode config schema: agent.<name>.disable
      const agentMap = asRecord(cfg.agent)
      const entry = asRecord(agentMap[n])
      if (entry.disable === true) return true
      return false
    }

    const add = (name: string, v: ConfigValue) => {
      const n = String(name || '').trim()
      if (!n || seen.has(n)) return
      const entry = asRecord(v)
      const description = typeof entry.description === 'string' ? entry.description : undefined
      const mode = typeof entry.mode === 'string' ? entry.mode : undefined
      const hidden = typeof entry.hidden === 'boolean' ? entry.hidden : undefined
      const disable = typeof entry.disable === 'boolean' ? entry.disable : undefined
      out.push({ name: n, description, mode, hidden, disable })
      seen.add(n)
    }

    const agentMap = asRecord(cfg.agent)
    if (Object.keys(agentMap).length > 0) {
      for (const [name, v] of Object.entries(agentMap)) add(name, v)
    }

    // Minimal fallback so the selector is never empty.
    // Only add built-ins when nothing is configured AND they are not disabled.
    if (out.length === 0) {
      if (!isDisabled('build')) add('build', { mode: 'primary', description: 'Default primary agent (fallback)' })
      if (!isDisabled('plan')) add('plan', { mode: 'primary', description: 'Primary planning agent' })
    }
    return out
  }

  function modelSlugsFromConfigProviders(): string[] {
    const cfg = asRecord(opts.draft.value)
    const providerMap = asRecord(cfg.provider)
    if (!Object.keys(providerMap).length) return []

    const out: string[] = []
    for (const [providerId, provider] of Object.entries(providerMap)) {
      const pid = String(providerId || '').trim()
      if (!pid) continue
      const models = isRecord(provider) ? provider.models : undefined
      const modelIds = modelIdsFromProviderModels(models)
      for (const mid of modelIds) {
        out.push(`${pid}/${mid}`)
      }
    }
    return out
  }

  function isValidDefaultAgent(entry: AgentListItem | undefined): boolean {
    if (!entry) return false
    // default_agent must be a primary agent; OpenCode rejects subagent/hidden.
    if (entry.mode === 'subagent') return false
    if (entry.hidden === true) return false
    if (entry.disable === true) return false
    return true
  }

  const agentOptions = computed<AgentListItem[]>(() => {
    const merged = new Map<string, AgentListItem>()
    for (const a of agentEntriesFromConfig()) merged.set(a.name, a)
    for (const a of agentsRemote.value) {
      // Prefer remote metadata when available.
      merged.set(a.name, { ...merged.get(a.name), ...a })
    }

    const current = opts.defaultAgent.value.trim()
    if (current && !merged.has(current)) {
      merged.set(current, { name: current })
    }

    return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name))
  })

  const modelSlugOptions = computed<string[]>(() => {
    const merged = new Set<string>()

    for (const p of providersRemote.value) {
      const pid = String(p.id || '').trim()
      if (!pid) continue
      for (const mid of modelIdsFromProviderModels(p.models)) {
        merged.add(`${pid}/${mid}`)
      }
    }
    for (const slug of modelSlugsFromConfigProviders()) merged.add(slug)

    // Preserve current values even if not in provider list.
    const cur = opts.model.value.trim()
    if (cur) merged.add(cur)
    const curSmall = opts.smallModel.value.trim()
    if (curSmall) merged.add(curSmall)

    return Array.from(merged.values()).sort((a, b) => a.localeCompare(b))
  })

  const modelMetaBySlug = computed(() => {
    const map = new Map<string, RemoteModel>()
    for (const p of providersRemote.value) {
      const pid = String(p.id || '').trim()
      if (!pid) continue
      for (const m of modelsFromProviderModels(p.models)) {
        const mid = String(m?.id || '').trim()
        if (!mid) continue
        map.set(`${pid}/${mid}`, m)
      }
    }
    return map
  })

  const selectedModelMeta = computed(() => {
    const v = opts.model.value.trim()
    if (!v) return undefined
    return modelMetaBySlug.value.get(v)
  })

  const selectedSmallModelMeta = computed(() => {
    const v = opts.smallModel.value.trim()
    if (!v) return undefined
    return modelMetaBySlug.value.get(v)
  })

  const knownModelSlugs = computed<Set<string>>(() => {
    const set = new Set<string>()
    for (const p of providersRemote.value) {
      const pid = String(p.id || '').trim()
      if (!pid) continue
      for (const mid of modelIdsFromProviderModels(p.models)) set.add(`${pid}/${mid}`)
    }
    for (const slug of modelSlugsFromConfigProviders()) set.add(slug)
    return set
  })

  const allModelEntries = computed<ModelEntry[]>(() => {
    const entries: ModelEntry[] = []
    const metaMap = modelMetaBySlug.value
    const slugs = Array.from(knownModelSlugs.value.values())
    for (const slug of slugs) {
      const [providerId, modelId] = slug.split('/')
      const pid = String(providerId || '').trim()
      const mid = String(modelId || '').trim()
      if (!pid || !mid) continue
      const meta = metaMap.get(slug)
      const ctx = typeof meta?.limit?.context === 'number' ? meta!.limit!.context : undefined
      const out = typeof meta?.limit?.output === 'number' ? meta!.limit!.output : undefined
      const costIn = typeof meta?.cost?.input === 'number' ? meta!.cost!.input : undefined
      const costOut = typeof meta?.cost?.output === 'number' ? meta!.cost!.output : undefined
      const costTotal =
        typeof costIn === 'number' && typeof costOut === 'number'
          ? costIn + costOut
          : typeof costIn === 'number'
            ? costIn
            : typeof costOut === 'number'
              ? costOut
              : undefined
      const status = typeof meta?.status === 'string' ? meta!.status : undefined
      const family = typeof meta?.family === 'string' ? meta!.family : undefined
      const tools = meta?.capabilities?.toolcall === true
      const reasoning = meta?.capabilities?.reasoning === true
      const image = meta?.capabilities?.input?.image === true
      const pdf = meta?.capabilities?.input?.pdf === true
      const releaseMs = meta?.release_date ? parseDateMs(meta.release_date) : undefined

      entries.push({
        slug,
        providerId: pid,
        modelId: mid,
        meta,
        ctx,
        out,
        costIn,
        costOut,
        costTotal,
        status,
        family,
        tools,
        reasoning,
        image,
        pdf,
        releaseMs,
      })
    }
    return entries
  })

  const recommendedSmallModel = computed(() => {
    const base = opts.model.value.trim()
    if (!base || !base.includes('/')) return null
    const baseMeta = modelMetaBySlug.value.get(base)
    const baseProvider = base.split('/')[0]

    const baseCost =
      typeof baseMeta?.cost?.input === 'number' || typeof baseMeta?.cost?.output === 'number'
        ? (baseMeta?.cost?.input || 0) + (baseMeta?.cost?.output || 0)
        : null

    const candidates = allModelEntries.value
      .filter((e) => e.slug !== base)
      .filter((e) => e.tools === true)
      .filter((e) => e.status !== 'deprecated')
      .filter((e) => typeof e.costTotal === 'number')
      .filter((e) => typeof e.out === 'number' && e.out >= 1024)

    if (candidates.length === 0) return null

    // Prefer same provider; otherwise global.
    const sameProvider = candidates.filter((e) => e.providerId === baseProvider)
    const pool = sameProvider.length ? sameProvider : candidates
    pool.sort((a, b) => (a.costTotal ?? Number.POSITIVE_INFINITY) - (b.costTotal ?? Number.POSITIVE_INFINITY))
    const best = pool[0]
    if (!best) return null

    const reasonBits: string[] = []
    reasonBits.push('tool-capable')
    if (best.providerId === baseProvider) reasonBits.push('same provider')
    if (baseCost !== null && typeof best.costTotal === 'number') {
      if (best.costTotal < baseCost) reasonBits.push('cheaper')
    }
    return { slug: best.slug, reason: reasonBits.join(', ') }
  })

  const defaultAgentWarning = computed(() => {
    const cur = opts.defaultAgent.value.trim()
    if (!cur) return ''
    const entry = agentOptions.value.find((a) => a.name === cur)
    if (!entry) return `Unknown agent: ${cur}`
    if (entry.mode === 'subagent') return `Default agent must be a primary agent ("${cur}" is subagent)`
    if (entry.hidden === true) return `Default agent cannot be hidden ("${cur}" is hidden)`
    if (entry.disable === true) return `Default agent cannot be disabled ("${cur}" is disabled)`
    return ''
  })

  function modelFormatWarning(value: string): string {
    const v = (value || '').trim()
    if (!v) return ''
    if (!v.includes('/')) return 'Expected format: provider/model'
    const parts = v.split('/').filter(Boolean)
    if (parts.length < 2) return 'Expected format: provider/model'
    return ''
  }

  const modelWarning = computed(() => modelFormatWarning(opts.model.value))
  const smallModelWarning = computed(() => modelFormatWarning(opts.smallModel.value))

  const modelUnknownWarning = computed(() => {
    const v = opts.model.value.trim()
    if (!v) return ''
    if (modelWarning.value) return ''
    if (knownModelSlugs.value.size === 0) return ''
    return knownModelSlugs.value.has(v) ? '' : 'Not in known provider/model list (may still work)'
  })

  const smallModelUnknownWarning = computed(() => {
    const v = opts.smallModel.value.trim()
    if (!v) return ''
    if (smallModelWarning.value) return ''
    if (knownModelSlugs.value.size === 0) return ''
    return knownModelSlugs.value.has(v) ? '' : 'Not in known provider/model list (may still work)'
  })

  async function refreshOptionLists(opts2: { toast?: boolean } = {}) {
    optionsLoading.value = true
    optionsLoaded.value = true
    optionsError.value = null
    toolIdsError.value = null
    try {
      // Best-effort: these are proxied to OpenCode.
      const [providersResp, agentsResp] = await Promise.all([
        opts.apiJson<ProvidersConfigResp>(`/api/config/providers${opts.dirQuery()}`),
        opts.apiJson<ConfigValue>(`/api/agent${opts.dirQuery()}`),
      ])

      providersRemote.value = Array.isArray(providersResp?.providers) ? providersResp.providers : []
      agentsRemote.value = Array.isArray(agentsResp)
        ? agentsResp
            .map((a) => {
              const entry = asRecord(a)
              return {
                name: typeof entry.name === 'string' ? entry.name.trim() : '',
                description: typeof entry.description === 'string' ? entry.description : undefined,
                mode: typeof entry.mode === 'string' ? entry.mode : undefined,
                hidden: typeof entry.hidden === 'boolean' ? entry.hidden : undefined,
              }
            })
            .filter((a: AgentListItem) => Boolean(a.name))
        : []

      if (opts2.toast) {
        opts.toasts.push('success', i18n.global.t('settings.opencodeConfig.errors.refreshedAgentModelLists'))
      }
    } catch (err) {
      optionsError.value = err instanceof Error ? err.message : String(err)
      providersRemote.value = []
      agentsRemote.value = []

      if (opts2.toast) {
        opts.toasts.push(
          'error',
          optionsError.value || i18n.global.t('settings.opencodeConfig.errors.failedToRefreshAgentModelLists'),
        )
      }
    } finally {
      // Tool IDs are optional; don't block providers/agents UX on failure.
      try {
        const ids = await opts.apiJson<string[]>(`/api/experimental/tool/ids${opts.dirQuery()}`)
        toolIdsRemote.value = Array.isArray(ids) ? ids.map((s) => String(s || '').trim()).filter(Boolean) : []
      } catch (err) {
        toolIdsRemote.value = []
        toolIdsError.value = err instanceof Error ? err.message : String(err)
      }
      optionsLoading.value = false
    }
  }

  return {
    agentOptions,
    agentsRemote,
    defaultAgentWarning,
    formatModelCost,
    formatModelMeta,
    isValidDefaultAgent,
    modelMetaBySlug,
    modelSlugOptions,
    modelUnknownWarning,
    modelWarning,
    optionsError,
    optionsLoaded,
    optionsLoading,
    providersRemote,
    refreshOptionLists,
    recommendedSmallModel,
    selectedModelMeta,
    selectedSmallModelMeta,
    smallModelUnknownWarning,
    smallModelWarning,
    toolIdsError,
    toolIdsRemote,
  }
}

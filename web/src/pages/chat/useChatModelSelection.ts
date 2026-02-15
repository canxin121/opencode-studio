import { computed, nextTick, ref, watch, type Ref } from 'vue'

import { apiJson } from '@/lib/api'
import type { OpencodeConfigResponse } from '@/stores/opencodeConfig'
import type { SessionRunConfig } from '@/types/chat'
import type { JsonValue as JsonLike } from '@/types/json'

type Provider = { id: string; name?: string; models?: JsonLike }
type ProvidersConfigResp = { providers: Provider[]; default?: Record<string, string> }
type Agent = { name: string; description?: string; mode?: string; hidden?: boolean; disable?: boolean }
type UnknownRecord = Record<string, JsonLike>
type ChatMessageLike = { info?: UnknownRecord }

type SelectionSource = 'empty' | 'session' | 'default' | 'auto' | 'manual'

type ChatLike = {
  selectedSessionId: string | null
  selectedSessionRunConfig: SessionRunConfig | null
  messages: ChatMessageLike[]
}

type OpencodeConfigStoreLike = {
  data: OpencodeConfigResponse['config'] | null
  scope: string
  exists: boolean | null
  refresh: (opts: { scope: 'project' | 'user'; directory: string | null }) => Promise<void>
}

type UiLike = { isMobile: boolean; isMobilePointer: boolean }

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function parseModelSlug(slug: string): { provider: string; model: string } {
  const raw = (slug || '').trim()
  const idx = raw.indexOf('/')
  if (idx <= 0) return { provider: '', model: '' }
  const provider = raw.slice(0, idx).trim()
  const model = raw.slice(idx + 1).trim()
  return { provider, model }
}

function isRecord(value: JsonLike): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function asRecord(value: JsonLike): UnknownRecord {
  return isRecord(value) ? value : {}
}

function modelIdsFromProviderModels(models: JsonLike): string[] {
  if (!models) return []
  if (Array.isArray(models)) {
    // Upstream may return an array of model objects.
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

function isSelectablePrimaryAgent(agent: Agent | null | undefined): boolean {
  if (!agent) return false
  const name = String(agent.name || '').trim()
  if (!name) return false
  // Mirror OpenCode expectations: primary (or all) and visible.
  if (agent.disable === true) return false
  if (agent.hidden === true) return false
  if (agent.mode === 'subagent') return false
  return true
}

export function useChatModelSelection(opts: {
  chat: ChatLike
  ui: UiLike
  opencodeConfig: OpencodeConfigStoreLike
  sessionDirectory: Ref<string>

  // UI refs for picker anchoring.
  composerControlsRef: Ref<HTMLDivElement | null>
  composerPickerOpen: Ref<null | 'agent' | 'model' | 'variant'>
  composerPickerStyle: Ref<Record<string, string>>
  agentTriggerRef: Ref<HTMLElement | null>
  modelTriggerRef: Ref<HTMLElement | null>
  variantTriggerRef: Ref<HTMLElement | null>

  // Other UI state that must be reset when opening picker.
  modelPickerQuery: Ref<string>
  agentPickerQuery: Ref<string>
  closeComposerActionMenu: () => void
  commandOpen: Ref<boolean>
  commandQuery: Ref<string>
  commandIndex: Ref<number>
}) {
  const {
    chat,
    opencodeConfig,
    sessionDirectory,
    composerControlsRef,
    composerPickerOpen,
    composerPickerStyle,
    agentTriggerRef,
    modelTriggerRef,
    variantTriggerRef,
    modelPickerQuery,
    agentPickerQuery,
    closeComposerActionMenu,
    commandOpen,
    commandQuery,
    commandIndex,
  } = opts

  const opencodeConfigFallback = ref<UnknownRecord | null>(null)

  const resolvedOpencodeConfig = computed(() => {
    const cfg = isRecord(opencodeConfig.data) ? opencodeConfig.data : null
    if (opencodeConfig.scope === 'project' && opencodeConfig.exists === false) {
      return opencodeConfigFallback.value || {}
    }
    return cfg || {}
  })

  const shareDisabled = computed(() => {
    const cfg = resolvedOpencodeConfig.value
    return String(cfg?.share || '').trim() === 'disabled'
  })

  const opencodeDefaults = computed(() => {
    const cfg = resolvedOpencodeConfig.value
    const pickString = (obj: JsonLike, keys: string[]) => {
      const rec = asRecord(obj)
      for (const k of keys) {
        const v = rec[k]
        if (typeof v === 'string') {
          const s = v.trim()
          if (s) return s
        }
      }
      return ''
    }

    const normalizeAgentName = (raw: string) => {
      let v = String(raw || '').trim()
      if (v.startsWith('@')) v = v.slice(1).trim()
      return v
    }

    const defaultAgent = normalizeAgentName(
      pickString(cfg, ['default_agent', 'defaultAgent', 'agent', 'default_agent_name', 'defaultAgentName']),
    )

    // OpenCode config uses a mixture of snake_case and camelCase across versions.
    const providerRaw = pickString(cfg, ['provider', 'default_provider', 'defaultProvider', 'providerID', 'providerId'])
    const modelRaw = pickString(cfg, ['model', 'default_model', 'defaultModel', 'default_model_id', 'defaultModelId'])

    let defaultProvider = providerRaw
    let defaultModel = ''
    if (modelRaw) {
      const parsed = parseModelSlug(modelRaw)
      if (parsed.provider && parsed.model) {
        if (!defaultProvider) defaultProvider = parsed.provider
        defaultModel = parsed.model
      } else {
        defaultModel = modelRaw
      }
    }

    return { defaultAgent, defaultProvider, defaultModel }
  })

  // OpenCode /config/providers returns { providers, default }, where `default` is a
  // map of providerID -> default modelID (per-provider, already priority-sorted).
  const providerDefaultModels = ref<Record<string, string>>({})

  const providers = ref<Provider[]>([])
  const agents = ref<Agent[]>([])

  const remoteDefaults = ref<{ provider?: string; model?: string; agent?: string }>({})

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

  const effectiveDefaults = computed(() => {
    const rd = remoteDefaults.value

    // Only treat {provider, model} as a pair; avoid mixing sources.
    const remoteProvider = (rd.provider || '').trim()
    const remoteModel = (rd.model || '').trim()
    const configProvider = (opencodeDefaults.value.defaultProvider || '').trim()
    const configModel = (opencodeDefaults.value.defaultModel || '').trim()
    const fallback = fallbackProviderModel.value

    const providerModel =
      remoteProvider && remoteModel
        ? { provider: remoteProvider, model: remoteModel }
        : configProvider && configModel
          ? { provider: configProvider, model: configModel }
          : fallback

    return {
      agent: (rd.agent || opencodeDefaults.value.defaultAgent || fallbackAgent.value || '').trim(),
      provider: providerModel.provider,
      model: providerModel.model,
    }
  })

  // Session selection state.
  const selectedProviderId = ref('')
  const selectedModelId = ref('')
  const selectedAgent = ref('')

  const agentSource = ref<SelectionSource>('empty')
  const providerSource = ref<SelectionSource>('empty')
  const modelSource = ref<SelectionSource>('empty')
  const variantSource = ref<SelectionSource>('empty')

  // Variant selection is per-model (provider/model) and persists across sessions.
  const STORAGE_MODEL_VARIANT_BY_KEY = 'oc2.chat.modelVariantByKey'
  const variantByModelKey = ref<Record<string, string>>({})
  try {
    const raw = (localStorage.getItem(STORAGE_MODEL_VARIANT_BY_KEY) || '').trim()
    const parsed = raw ? JSON.parse(raw) : null
    if (isRecord(parsed) && !Array.isArray(parsed)) {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed)) {
        const key = String(k || '').trim()
        const val = typeof v === 'string' ? v.trim() : ''
        if (key && val) out[key] = val
      }
      variantByModelKey.value = out
    }
  } catch {
    // ignore
  }

  let persistVariantByModelTimer: number | null = null
  function persistVariantByModelSoon() {
    if (persistVariantByModelTimer !== null) return
    persistVariantByModelTimer = window.setTimeout(() => {
      persistVariantByModelTimer = null
      try {
        localStorage.setItem(STORAGE_MODEL_VARIANT_BY_KEY, JSON.stringify(variantByModelKey.value))
      } catch {
        // ignore
      }
    }, 250)
  }

  const selectedModelKey = computed(() => {
    const pid = selectedProviderId.value.trim()
    const mid = selectedModelId.value.trim()
    return pid && mid ? `${pid}/${mid}` : ''
  })

  const selectedVariant = computed<string>({
    get() {
      const key = selectedModelKey.value
      if (!key) return ''
      const v = variantByModelKey.value[key]
      return typeof v === 'string' ? v : ''
    },
    set(nextValue) {
      const key = selectedModelKey.value
      if (!key) return
      const v = String(nextValue || '').trim()

      const next = { ...variantByModelKey.value }
      if (v) {
        next[key] = v
      } else {
        delete next[key]
      }
      variantByModelKey.value = next
      persistVariantByModelSoon()
    },
  })

  // Picker options.
  type ModelSlugOption = { value: string; label: string; providerId: string; modelId: string }
  const selectedModelSlug = computed(() => {
    return selectedProviderId.value && selectedModelId.value
      ? `${selectedProviderId.value}/${selectedModelId.value}`
      : ''
  })

  function providerListFromConfig(): Provider[] {
    const cfg = resolvedOpencodeConfig.value
    const out: Provider[] = []
    const providerMap = cfg?.provider
    if (isRecord(providerMap)) {
      for (const [id, value] of Object.entries(providerMap)) {
        const label = String(id).trim()
        if (!label) continue
        const valueRecord = asRecord(value)
        const name = typeof valueRecord.name === 'string' ? valueRecord.name : undefined
        const modelsRaw = valueRecord.models
        const models = Array.isArray(modelsRaw) || isRecord(modelsRaw) ? modelsRaw : undefined
        out.push({ id: label, name, models })
      }
    }
    return out
  }

  function ensureDefaultProviderInList(list: Provider[]) {
    // Only ensure *configured* defaults are present. Runtime defaults are derived from
    // the provider list itself and don't need injecting.
    const def = (opencodeDefaults.value.defaultProvider || '').trim()
    if (!def) return list
    if (list.some((p) => p.id === def)) return list
    return [...list, { id: def, name: def, models: {} }]
  }

  function mergeProviderLists(primary: Provider[], fallback: Provider[]) {
    // Preserve upstream ordering (OpenCode defaults depend on provider order).
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

  const modelSlugOptions = computed<ModelSlugOption[]>(() => {
    const out: ModelSlugOption[] = []
    for (const p of providers.value) {
      const ids = modelIdsFromProviderModels(p.models)
      for (const modelId of ids) {
        const value = `${p.id}/${modelId}`
        const label = `${p.name || p.id} / ${modelId}`
        out.push({ value, label, providerId: p.id, modelId })
      }
    }

    // Preserve selection even if it isn't present in the model list.
    if (selectedProviderId.value && selectedModelId.value) {
      const value = `${selectedProviderId.value}/${selectedModelId.value}`
      if (!out.some((x) => x.value === value)) {
        out.push({
          value,
          label: value,
          providerId: selectedProviderId.value,
          modelId: selectedModelId.value,
        })
      }
    }

    out.sort((a, b) => a.label.localeCompare(b.label))
    return out
  })

  function modelMetaFor(providerId: string, modelId: string): UnknownRecord | null {
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

  const variantOptionsFromModel = computed<string[]>(() => {
    const meta = modelMetaFor(selectedProviderId.value, selectedModelId.value)
    const variants = isRecord(meta?.variants) ? meta.variants : null
    const out: string[] = []
    if (isRecord(variants) && !Array.isArray(variants)) {
      for (const [key, value] of Object.entries(variants)) {
        const id = String(key).trim()
        if (!id) continue
        const disabled = isRecord(value) && value.disabled === true
        if (!disabled) out.push(id)
      }
    }
    out.sort((a, b) => a.localeCompare(b))
    return out
  })

  const variantOptions = computed<string[]>(() => {
    const out = variantOptionsFromModel.value.slice()

    // Preserve selection even if we don't know the full variant list.
    const selected = selectedVariant.value.trim()
    if (selected && !out.includes(selected)) out.push(selected)

    out.sort((a, b) => a.localeCompare(b))
    return out
  })

  const hasVariantsForSelection = computed(() => {
    // Only show the Variant chip when the current model actually exposes variants.
    return variantOptionsFromModel.value.length > 0
  })

  const agentChipLabel = computed(() => {
    const v = (selectedAgent.value || effectiveDefaults.value.agent || '').trim()
    return v || 'Agent'
  })

  const modelChipLabel = computed(() => {
    const provider = selectedProviderId.value.trim()
    const model = selectedModelId.value.trim()
    if (provider && model) return `${provider}/${model}`
    const defProvider = effectiveDefaults.value.provider
    const defModel = effectiveDefaults.value.model
    if (defProvider && defModel) return `${defProvider}/${defModel}`
    return 'Model'
  })

  const modelChipLabelMobile = computed(() => {
    // On mobile, keep the chip compact by showing only the model portion.
    const label = modelChipLabel.value.trim()
    const idx = label.indexOf('/')
    if (idx > 0 && idx < label.length - 1) return label.slice(idx + 1)
    return label
  })

  const variantChipLabel = computed(() => {
    const v = selectedVariant.value.trim()
    if (v) return v
    return hasVariantsForSelection.value ? 'Variants' : 'Variant'
  })

  const filteredModelSlugOptions = computed<ModelSlugOption[]>(() => {
    const q = modelPickerQuery.value.trim().toLowerCase()
    const list = modelSlugOptions.value
    if (!q) return list
    return list.filter((opt) => opt.label.toLowerCase().includes(q) || opt.value.toLowerCase().includes(q))
  })

  const filteredAgentsForPicker = computed<Agent[]>(() => {
    const q = agentPickerQuery.value.trim().toLowerCase()
    const list = agents.value.filter(isSelectablePrimaryAgent)
    if (!q) return list
    return list.filter((a) => {
      const name = (a.name || '').toLowerCase()
      const desc = (a.description || '').toLowerCase()
      return name.includes(q) || desc.includes(q)
    })
  })

  function closeComposerPicker() {
    composerPickerOpen.value = null
  }

  function toggleComposerPicker(kind: 'agent' | 'model' | 'variant') {
    if (composerPickerOpen.value === kind) {
      composerPickerOpen.value = null
      return
    }
    closeComposerActionMenu()
    // Close command picker when opening selector panels.
    commandOpen.value = false
    commandQuery.value = ''
    commandIndex.value = 0

    composerPickerOpen.value = kind

    // Anchor the picker to the trigger's left edge (similar to attachment/command menus).
    void nextTick(() => {
      const box = composerControlsRef.value
      const anchor =
        kind === 'agent' ? agentTriggerRef.value : kind === 'model' ? modelTriggerRef.value : variantTriggerRef.value
      if (!box || !anchor) {
        composerPickerStyle.value = { left: '8px' }
        return
      }
      const boxRect = box.getBoundingClientRect()
      const anchorRect = anchor.getBoundingClientRect()

      const padding = 8
      const boxWidth = Math.max(0, boxRect.width)
      const maxWidth = Math.max(240, Math.round(Math.min(520, boxWidth - padding * 2)))

      // Position the menu so it opens above the trigger without overflowing the composer.
      const rawLeft = Math.round(anchorRect.left - boxRect.left)
      const maxLeft = Math.max(padding, Math.round(boxWidth - padding - maxWidth))
      const left = clampNumber(rawLeft, padding, maxLeft)
      composerPickerStyle.value = { left: `${left}px`, maxWidth: `${maxWidth}px` }
    })

    if (kind === 'model') {
      modelPickerQuery.value = ''
    } else if (kind === 'agent') {
      agentPickerQuery.value = ''
    }
  }

  function ensureAgentOption(name: string) {
    const label = name.trim()
    if (!label) return
    if (agents.value.some((a) => a.name === label)) return
    agents.value = [...agents.value, { name: label }]
  }

  function ensureProviderOption(id: string) {
    const label = id.trim()
    if (!label) return
    if (providers.value.some((p) => p.id === label)) return
    providers.value = [...providers.value, { id: label, name: label, models: {} }]
  }

  function setAgent(value: string, source: SelectionSource) {
    selectedAgent.value = value
    agentSource.value = value ? source : 'empty'
    if (value) ensureAgentOption(value)
  }

  function setProvider(value: string, source: SelectionSource) {
    selectedProviderId.value = value
    providerSource.value = value ? source : 'empty'
    if (value) ensureProviderOption(value)
  }

  function setModel(value: string, source: SelectionSource) {
    selectedModelId.value = value
    modelSource.value = value ? source : 'empty'
  }

  function setVariant(value: string, source: SelectionSource) {
    selectedVariant.value = value
    variantSource.value = value ? source : 'empty'
  }

  function applyOpencodeDefaults() {
    const { agent, provider, model } = effectiveDefaults.value
    if (!selectedAgent.value && agent && agentSource.value !== 'manual') {
      setAgent(agent, 'default')
    }
    if (!selectedProviderId.value && provider && providerSource.value !== 'manual') {
      setProvider(provider, 'default')
    }
    if (!selectedModelId.value && model && selectedProviderId.value && modelSource.value !== 'manual') {
      setModel(model, 'default')
    }

    if (!selectedProviderId.value && providers.value.length === 1) {
      setProvider(providers.value[0]?.id || '', 'auto')
    }
    if (!selectedModelId.value && selectedProviderId.value) {
      const providerObj = providers.value.find((p) => p.id === selectedProviderId.value)
      const ids = modelIdsFromProviderModels(providerObj?.models)
      if (ids.length === 1) setModel(ids[0] || '', 'auto')
    }
    if (!selectedProviderId.value && !selectedModelId.value && modelSlugOptions.value.length === 1) {
      const only = modelSlugOptions.value[0]
      if (only) {
        setProvider(only.providerId, 'auto')
        setModel(only.modelId, 'auto')
      }
    }
  }

  function chooseAgent(name: string) {
    selectedAgent.value = name
    agentSource.value = 'manual'
    closeComposerPicker()
  }

  function chooseAgentDefault() {
    selectedAgent.value = ''
    agentSource.value = 'empty'
    closeComposerPicker()
    applyOpencodeDefaults()
  }

  function chooseVariant(value: string) {
    selectedVariant.value = value
    variantSource.value = 'manual'
    closeComposerPicker()
  }

  function chooseVariantDefault() {
    selectedVariant.value = ''
    variantSource.value = 'empty'
    closeComposerPicker()
    applyOpencodeDefaults()
  }

  function chooseModelSlug(value: string) {
    const parsed = parseModelSlug(value)
    selectedProviderId.value = parsed.provider
    selectedModelId.value = parsed.model
    providerSource.value = 'manual'
    modelSource.value = 'manual'
    closeComposerPicker()
  }

  function chooseModelDefault() {
    selectedProviderId.value = ''
    selectedModelId.value = ''
    providerSource.value = 'empty'
    modelSource.value = 'empty'
    closeComposerPicker()
    applyOpencodeDefaults()
  }

  function deriveSessionSelection(): { agent?: string; provider?: string; model?: string; variant?: string } {
    const list = chat.messages
    const pickLast = (extract: (info: UnknownRecord) => string) => {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const info = asRecord(list[i]?.info)
        const v = extract(info)
        if (v) return v
      }
      return ''
    }

    const agent = pickLast((info) => (typeof info?.agent === 'string' ? info.agent.trim() : ''))

    const provider =
      pickLast((info) => (typeof info?.providerID === 'string' ? info.providerID.trim() : '')) ||
      pickLast((info) => {
        const model = asRecord(info.model)
        return typeof model.providerID === 'string' ? model.providerID.trim() : ''
      })

    const model =
      pickLast((info) => (typeof info?.modelID === 'string' ? info.modelID.trim() : '')) ||
      pickLast((info) => {
        const modelInfo = asRecord(info.model)
        return typeof modelInfo.modelID === 'string' ? modelInfo.modelID.trim() : ''
      })

    const variant = pickLast((info) => (typeof info?.variant === 'string' ? info.variant.trim() : ''))
    return { agent, provider, model, variant }
  }

  function applySessionSelection() {
    if (!chat.selectedSessionId) return
    if (
      agentSource.value === 'manual' ||
      providerSource.value === 'manual' ||
      modelSource.value === 'manual' ||
      variantSource.value === 'manual'
    ) {
      return
    }

    // Prefer the persisted session run config (survives reloads / blocked prompts).
    const rc = asRecord(chat.selectedSessionRunConfig)
    const agent = typeof rc.agent === 'string' ? rc.agent.trim() : ''
    const provider = typeof rc.providerID === 'string' ? rc.providerID.trim() : ''
    const model = typeof rc.modelID === 'string' ? rc.modelID.trim() : ''
    const variant = typeof rc.variant === 'string' ? rc.variant.trim() : ''
    if (agent) setAgent(agent, 'session')
    if (provider) setProvider(provider, 'session')
    if (model) setModel(model, 'session')
    if (variant) setVariant(variant, 'session')

    const derived = deriveSessionSelection()
    if (derived.agent) setAgent(derived.agent, 'session')
    if (derived.provider) setProvider(derived.provider, 'session')
    if (derived.model) setModel(derived.model, 'session')
    if (derived.variant) setVariant(derived.variant, 'session')
    if (!derived.agent && !derived.provider && !derived.model) {
      applyOpencodeDefaults()
    }
  }

  function resetSelectionForSessionSwitch() {
    selectedAgent.value = ''
    selectedProviderId.value = ''
    selectedModelId.value = ''
    agentSource.value = 'empty'
    providerSource.value = 'empty'
    modelSource.value = 'empty'
    variantSource.value = 'empty'
  }

  const agentHint = computed(() => {
    if (agentSource.value === 'manual' || agentSource.value === 'session') return ''
    if (selectedAgent.value) {
      return agentSource.value === 'auto'
        ? 'Auto-selected the only available agent'
        : `Using OpenCode agent: ${selectedAgent.value}`
    }
    return effectiveDefaults.value.agent
      ? `Using OpenCode agent: ${effectiveDefaults.value.agent}`
      : 'No default agent configured'
  })

  const modelHint = computed(() => {
    if (modelSource.value === 'manual' || modelSource.value === 'session') return ''
    if (selectedProviderId.value && selectedModelId.value) {
      const slug = `${selectedProviderId.value}/${selectedModelId.value}`
      return modelSource.value === 'auto' ? 'Auto-selected the only available model' : `Using OpenCode model: ${slug}`
    }
    return effectiveDefaults.value.provider && effectiveDefaults.value.model
      ? `Using OpenCode model: ${effectiveDefaults.value.provider}/${effectiveDefaults.value.model}`
      : 'No default model configured'
  })

  const variantHint = computed(() => {
    if (variantSource.value === 'manual' || variantSource.value === 'session') return ''
    if (selectedVariant.value) return `Using variant: ${selectedVariant.value}`
    return ''
  })

  async function refreshOpencodeConfig() {
    const dir = sessionDirectory.value
    const scope = dir ? 'project' : 'user'
    opencodeConfigFallback.value = null
    try {
      await opencodeConfig.refresh({ scope, directory: dir || null })
    } catch {
      // ignore
    }
    if (scope === 'project' && opencodeConfig.exists === false) {
      try {
        const resp = await apiJson<OpencodeConfigResponse>('/api/config/opencode?scope=user')
        opencodeConfigFallback.value = isRecord(resp?.config) ? resp.config : {}
      } catch {
        opencodeConfigFallback.value = {}
      }
    }
  }

  function agentListFromConfig(): Agent[] {
    const cfg = resolvedOpencodeConfig.value
    const entries: Agent[] = []
    const agentMap = cfg?.agent
    const modeMap = cfg?.mode
    const readMap = (map: UnknownRecord | null | undefined) => {
      if (!isRecord(map)) return
      for (const [name, value] of Object.entries(map)) {
        const label = String(name).trim()
        if (!label) continue

        const v = asRecord(value)
        const description = typeof v.description === 'string' ? v.description : undefined
        const mode = typeof v.mode === 'string' ? v.mode : undefined
        const hidden = typeof v.hidden === 'boolean' ? v.hidden : undefined
        const disable = typeof v.disable === 'boolean' ? v.disable : undefined

        // If OpenCode isn't reachable, we still try to keep the picker sane.
        // Built-in subagents are known; don't offer them as primary agents.
        if (disable === true) continue
        if (hidden === true) continue
        if (mode === 'subagent') continue
        if (!mode && (label === 'general' || label === 'explore')) continue

        entries.push({ name: label, description, mode, hidden, disable })
      }
    }
    readMap(isRecord(agentMap) ? agentMap : undefined)

    // Deprecated mode map entries are primary agents.
    if (isRecord(modeMap)) {
      const decorated: UnknownRecord = {}
      for (const [k, v] of Object.entries(modeMap)) {
        decorated[k] = { ...asRecord(v), mode: 'primary' }
      }
      readMap(decorated)
    }

    // Do not inject built-in agents here.
    // The chat agent picker should reflect the upstream OpenCode registry; if OpenCode
    // is unavailable, we prefer showing only explicitly configured agents.
    const defaultAgent = effectiveDefaults.value.agent
    if (defaultAgent && !entries.some((a) => a.name === defaultAgent)) {
      entries.push({ name: defaultAgent })
    }
    return entries.filter(isSelectablePrimaryAgent)
  }

  function dirQuery(): string {
    const dir = sessionDirectory.value
    return dir ? `?directory=${encodeURIComponent(dir)}` : ''
  }

  async function loadProvidersAndAgents() {
    await refreshOpencodeConfig()

    // Best-effort: these are proxied to OpenCode.
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

      // If OpenCode is reachable, trust its agent registry; do not inject build/plan fallbacks
      // from local config, since those may be disabled upstream.
      const primary = list.filter(isSelectablePrimaryAgent)
      agents.value = primary.length ? primary : agentListFromConfig()
    } catch {
      agents.value = agentListFromConfig()
    }

    applyOpencodeDefaults()
  }

  // Keep model selection consistent with provider.
  watch(
    () => selectedProviderId.value,
    () => {
      // Reset model if provider changed and the current selection is no longer valid.
      const providerObj = providers.value.find((p) => p.id === selectedProviderId.value)
      const ids = modelIdsFromProviderModels(providerObj?.models)
      if (selectedModelId.value && ids.length > 0 && !ids.includes(selectedModelId.value)) {
        selectedModelId.value = ''
      }
    },
  )

  watch(
    () => `${selectedProviderId.value}/${selectedModelId.value}`,
    () => {
      // Variant selection is per-model; don't let a "manual" source leak across model switches.
      if (variantSource.value === 'manual') variantSource.value = 'empty'
    },
  )

  watch(
    () => {
      const rc = asRecord(chat.selectedSessionRunConfig)
      const at = rc.at
      if (typeof at === 'number') return at
      if (typeof at === 'string') return at
      return null
    },
    () => {
      applySessionSelection()
    },
    { immediate: true },
  )

  watch(
    () => chat.messages.length,
    () => {
      applySessionSelection()
    },
  )

  return {
    providers,
    agents,
    selectedProviderId,
    selectedModelId,
    selectedAgent,
    selectedVariant,
    effectiveDefaults,
    shareDisabled,
    modelMetaFor,

    composerPickerStyle,
    toggleComposerPicker,
    composerPickerOpen,
    modelPickerQuery,
    agentPickerQuery,

    selectedModelSlug,
    modelSlugOptions,
    filteredModelSlugOptions,
    chooseModelSlug,
    chooseModelDefault,
    filteredAgentsForPicker,
    chooseAgent,
    chooseAgentDefault,
    variantOptions,
    hasVariantsForSelection,
    chooseVariant,
    chooseVariantDefault,

    agentHint,
    modelHint,
    variantHint,
    modelChipLabel,
    modelChipLabelMobile,
    agentChipLabel,
    variantChipLabel,

    resetSelectionForSessionSwitch,
    applySessionSelection,
    loadProvidersAndAgents,
  }
}

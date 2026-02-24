import { computed, ref, watch, type Ref } from 'vue'

import { parseModelSlug, resolveEffectiveDefaults } from './modelSelectionDefaults'
import {
  modelIdsFromProviderModels,
  useModelSelectionCatalog,
  type ModelMetaRecord,
  type OpencodeConfigStoreLike,
} from './modelSelectionCatalog'
import { useModelSelectionPickerUi } from './modelSelectionPickerUi'
import { resolveAgentSelection, resolveModelSelection, resolveVariantSelection } from './modelSelectionResolver'
import {
  deriveSessionSelectionFromMessages,
  normalizeSessionManualModelStorageEntry,
  readSessionManualModelPair,
  readSessionRunConfigSelection,
  removeSessionManualModelPair,
  writeSessionManualModelPair,
} from './modelSelectionSession'
import { useModelSelectionStateMachine } from './modelSelectionStateMachine'
import { createStringMapPersister, loadStringMapFromStorage, normalizeStringMapEntry } from './modelSelectionStorage'
import { useModelSelectionViewState } from './modelSelectionViewState'
import type { SessionRunConfig } from '@/types/chat'

type ChatMessageLike = { info?: ModelMetaRecord }

type ChatLike = {
  selectedSessionId: string | null
  selectedSessionRunConfig: SessionRunConfig | null
  messages: ChatMessageLike[]
}

type UiLike = { isMobile: boolean; isMobilePointer: boolean }

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
  onOpenComposerPicker: () => void
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
    onOpenComposerPicker,
    commandOpen,
    commandQuery,
    commandIndex,
  } = opts

  const {
    providers,
    agents,
    shareDisabled,
    projectConfigDefaults,
    userConfigDefaults,
    fallbackAgent,
    fallbackProviderModel,
    modelMetaFor,
    loadProvidersAndAgents: loadCatalogProvidersAndAgents,
  } = useModelSelectionCatalog({
    opencodeConfig,
    sessionDirectory,
  })

  const effectiveDefaults = computed(() => {
    return resolveEffectiveDefaults({
      projectConfig: projectConfigDefaults.value,
      userConfig: userConfigDefaults.value,
      opencodeSelection: fallbackProviderModel.value,
      fallbackAgent: fallbackAgent.value,
    })
  })

  // Session selection state.
  const selectedProviderId = ref('')
  const selectedModelId = ref('')
  const selectedAgent = ref('')

  // Variant selection is per-model (provider/model) and persists across sessions.
  const STORAGE_MODEL_VARIANT_BY_KEY = 'oc2.chat.modelVariantByKey'
  const variantByModelKey = ref<Record<string, string>>(
    loadStringMapFromStorage(STORAGE_MODEL_VARIANT_BY_KEY, normalizeStringMapEntry),
  )
  const variantByModelPersister = createStringMapPersister({
    storageKey: STORAGE_MODEL_VARIANT_BY_KEY,
    getValue: () => variantByModelKey.value,
  })

  function persistVariantByModelSoon() {
    variantByModelPersister.persistSoon()
  }

  const STORAGE_SESSION_MANUAL_MODEL_BY_SESSION = 'oc2.chat.sessionManualModelBySession'
  const sessionManualModelBySession = ref<Record<string, string>>(
    loadStringMapFromStorage(STORAGE_SESSION_MANUAL_MODEL_BY_SESSION, normalizeSessionManualModelStorageEntry),
  )
  const sessionManualModelPersister = createStringMapPersister({
    storageKey: STORAGE_SESSION_MANUAL_MODEL_BY_SESSION,
    getValue: () => sessionManualModelBySession.value,
  })

  function persistSessionManualModelSoon() {
    sessionManualModelPersister.persistSoon()
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

  const {
    agentSource,
    providerSource,
    modelSource,
    variantSource,
    setAgent,
    setProvider,
    setModel,
    setVariant,
    resetSelectionForSessionSwitch,
  } = useModelSelectionStateMachine({
    selectedAgent,
    selectedProviderId,
    selectedModelId,
    selectedVariant,
    ensureAgentOption: (name: string) => {
      const label = name.trim()
      if (!label) return
      if (agents.value.some((agent) => agent.name === label)) return
      agents.value = [...agents.value, { name: label }]
    },
    ensureProviderOption: (providerId: string) => {
      const label = providerId.trim()
      if (!label) return
      if (providers.value.some((provider) => provider.id === label)) return
      providers.value = [...providers.value, { id: label, name: label, models: {} }]
    },
  })

  const {
    selectedModelSlug,
    modelSlugOptions,
    filteredModelSlugOptions,
    filteredAgentsForPicker,
    variantOptions,
    hasVariantsForSelection,
    agentChipLabel,
    modelChipLabel,
    modelChipLabelMobile,
    variantChipLabel,
    agentHint,
    modelHint,
    variantHint,
  } = useModelSelectionViewState({
    providers,
    agents,
    selectedProviderId,
    selectedModelId,
    selectedAgent,
    selectedVariant,
    modelPickerQuery,
    agentPickerQuery,
    effectiveDefaults,
    agentSource,
    modelSource,
    variantSource,
    modelMetaFor,
  })

  const { closeComposerPicker, toggleComposerPicker } = useModelSelectionPickerUi({
    composerControlsRef,
    composerPickerOpen,
    composerPickerStyle,
    agentTriggerRef,
    modelTriggerRef,
    variantTriggerRef,
    modelPickerQuery,
    agentPickerQuery,
    onOpenComposerPicker,
    commandOpen,
    commandQuery,
    commandIndex,
  })

  function activeSessionId(): string {
    return String(chat.selectedSessionId || '').trim()
  }

  function readSessionManualModelPairForSession(sessionId: string): { provider: string; model: string } {
    return readSessionManualModelPair(sessionManualModelBySession.value, sessionId)
  }

  function saveSessionManualModelPair(sessionId: string, provider: string, model: string) {
    const next = writeSessionManualModelPair(sessionManualModelBySession.value, sessionId, provider, model)
    if (next === sessionManualModelBySession.value) return
    sessionManualModelBySession.value = next
    persistSessionManualModelSoon()
  }

  function clearSessionManualModelPair(sessionId: string) {
    const next = removeSessionManualModelPair(sessionManualModelBySession.value, sessionId)
    if (next === sessionManualModelBySession.value) return
    sessionManualModelBySession.value = next
    persistSessionManualModelSoon()
  }

  function singletonAvailableModelPair(): { provider: string; model: string } {
    let onlyProvider = ''
    let onlyModel = ''
    let count = 0

    for (const provider of providers.value) {
      const providerId = String(provider.id || '').trim()
      if (!providerId) continue
      const ids = modelIdsFromProviderModels(provider.models)
      for (const modelIdRaw of ids) {
        const modelId = String(modelIdRaw || '').trim()
        if (!modelId) continue
        count += 1
        if (count > 1) return { provider: '', model: '' }
        onlyProvider = providerId
        onlyModel = modelId
      }
    }

    if (count === 1) return { provider: onlyProvider, model: onlyModel }
    return { provider: '', model: '' }
  }

  function readRunConfigSelection(): { agent: string; provider: string; model: string; variant: string } {
    return readSessionRunConfigSelection(chat.selectedSessionRunConfig)
  }

  function applyAgentSelection(opts: {
    includeSessionLayers: boolean
    runConfig: { agent: string }
    derived: { agent: string }
  }) {
    if (agentSource.value === 'manual') return

    const resolved = resolveAgentSelection({
      includeSessionLayers: opts.includeSessionLayers,
      runConfigAgent: opts.runConfig.agent,
      derivedAgent: opts.derived.agent,
      projectDefaultAgent: projectConfigDefaults.value.defaultAgent,
      userDefaultAgent: userConfigDefaults.value.defaultAgent,
      fallbackAgent: fallbackAgent.value,
    })
    setAgent(resolved.value, resolved.source)
  }

  function applyModelSelection(opts: {
    includeSessionLayers: boolean
    sessionId: string
    runConfig: { provider: string; model: string }
    derived: { provider: string; model: string }
  }) {
    if (providerSource.value === 'manual' || modelSource.value === 'manual') return

    const resolved = resolveModelSelection({
      includeSessionLayers: opts.includeSessionLayers,
      sessionManual: readSessionManualModelPairForSession(opts.sessionId),
      sessionRunConfig: opts.runConfig,
      sessionDerived: opts.derived,
      projectDefault: {
        provider: projectConfigDefaults.value.defaultProvider,
        model: projectConfigDefaults.value.defaultModel,
      },
      userDefault: {
        provider: userConfigDefaults.value.defaultProvider,
        model: userConfigDefaults.value.defaultModel,
      },
      opencodeDefault: fallbackProviderModel.value,
      singletonAvailable: singletonAvailableModelPair(),
    })

    if (resolved.provider && resolved.model) {
      setProvider(resolved.provider, resolved.source)
      setModel(resolved.model, resolved.source)
      return
    }

    setProvider('', 'empty')
    setModel('', 'empty')
  }

  function applyVariantSelection(opts: {
    includeSessionLayers: boolean
    runConfig: { variant: string }
    derived: { variant: string }
  }) {
    if (variantSource.value === 'manual') return

    const resolved = resolveVariantSelection({
      includeSessionLayers: opts.includeSessionLayers,
      runConfigVariant: opts.runConfig.variant,
      derivedVariant: opts.derived.variant,
    })
    if (resolved.source === 'session') {
      setVariant(resolved.value, 'session')
      return
    }

    variantSource.value = 'empty'
  }

  function applyResolvedSelection(includeSessionLayers: boolean) {
    const runConfig = readRunConfigSelection()
    const derived = includeSessionLayers
      ? deriveSessionSelection()
      : { agent: '', provider: '', model: '', variant: '' }
    const sessionId = includeSessionLayers ? activeSessionId() : ''

    applyAgentSelection({ includeSessionLayers, runConfig, derived })
    applyModelSelection({ includeSessionLayers, sessionId, runConfig, derived })
    applyVariantSelection({ includeSessionLayers, runConfig, derived })
  }

  function applyOpencodeDefaults() {
    applyResolvedSelection(false)
  }

  function chooseAgent(name: string) {
    setAgent(name, 'manual')
    closeComposerPicker()
  }

  function chooseAgentDefault() {
    setAgent('', 'empty')
    closeComposerPicker()
    applyOpencodeDefaults()
  }

  function chooseVariant(value: string) {
    setVariant(value, 'manual')
    closeComposerPicker()
  }

  function chooseVariantDefault() {
    setVariant('', 'empty')
    closeComposerPicker()
    applyOpencodeDefaults()
  }

  function chooseModelSlug(value: string) {
    const parsed = parseModelSlug(value)
    if (!parsed.provider || !parsed.model) return

    setProvider(parsed.provider, 'manual')
    setModel(parsed.model, 'manual')
    const sid = activeSessionId()
    if (sid) saveSessionManualModelPair(sid, parsed.provider, parsed.model)
    closeComposerPicker()
  }

  function chooseModelDefault() {
    setProvider('', 'empty')
    setModel('', 'empty')
    const sid = activeSessionId()
    if (sid) clearSessionManualModelPair(sid)
    closeComposerPicker()
    applyOpencodeDefaults()
  }

  function deriveSessionSelection(): { agent: string; provider: string; model: string; variant: string } {
    return deriveSessionSelectionFromMessages(chat.messages)
  }

  function applySessionSelection() {
    if (!chat.selectedSessionId) return
    applyResolvedSelection(true)
  }

  async function loadProvidersAndAgents() {
    await loadCatalogProvidersAndAgents()
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
    () => chat.selectedSessionRunConfig?.at ?? null,
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

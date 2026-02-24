import { computed, type Ref } from 'vue'

import {
  isSelectablePrimaryAgent,
  modelIdsFromProviderModels,
  type Agent,
  type ModelMetaRecord,
  type Provider,
} from './modelSelectionCatalog'
import type { SelectionSource } from './modelSelectionResolver'
import type { JsonValue as JsonLike } from '../../types/json'

export type ModelSlugOption = { value: string; label: string; providerId: string; modelId: string }

function isRecord(value: JsonLike | null | undefined): value is ModelMetaRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function useModelSelectionViewState(opts: {
  providers: Ref<Provider[]>
  agents: Ref<Agent[]>
  selectedProviderId: Ref<string>
  selectedModelId: Ref<string>
  selectedAgent: Ref<string>
  selectedVariant: Ref<string>
  modelPickerQuery: Ref<string>
  agentPickerQuery: Ref<string>
  effectiveDefaults: Ref<{ agent: string; provider: string; model: string }>
  agentSource: Ref<SelectionSource>
  modelSource: Ref<SelectionSource>
  variantSource: Ref<SelectionSource>
  modelMetaFor: (providerId: string, modelId: string) => ModelMetaRecord | null
}) {
  const selectedModelSlug = computed(() => {
    return opts.selectedProviderId.value && opts.selectedModelId.value
      ? `${opts.selectedProviderId.value}/${opts.selectedModelId.value}`
      : ''
  })

  const modelSlugOptions = computed<ModelSlugOption[]>(() => {
    const out: ModelSlugOption[] = []
    for (const provider of opts.providers.value) {
      const ids = modelIdsFromProviderModels(provider.models)
      for (const modelId of ids) {
        const value = `${provider.id}/${modelId}`
        const label = `${provider.name || provider.id} / ${modelId}`
        out.push({ value, label, providerId: provider.id, modelId })
      }
    }

    if (opts.selectedProviderId.value && opts.selectedModelId.value) {
      const value = `${opts.selectedProviderId.value}/${opts.selectedModelId.value}`
      if (!out.some((item) => item.value === value)) {
        out.push({
          value,
          label: value,
          providerId: opts.selectedProviderId.value,
          modelId: opts.selectedModelId.value,
        })
      }
    }

    out.sort((a, b) => a.label.localeCompare(b.label))
    return out
  })

  const filteredModelSlugOptions = computed<ModelSlugOption[]>(() => {
    const query = opts.modelPickerQuery.value.trim().toLowerCase()
    const list = modelSlugOptions.value
    if (!query) return list
    return list.filter((item) => {
      return item.label.toLowerCase().includes(query) || item.value.toLowerCase().includes(query)
    })
  })

  const filteredAgentsForPicker = computed<Agent[]>(() => {
    const query = opts.agentPickerQuery.value.trim().toLowerCase()
    const list = opts.agents.value.filter(isSelectablePrimaryAgent)
    if (!query) return list
    return list.filter((agent) => {
      const name = (agent.name || '').toLowerCase()
      const desc = (agent.description || '').toLowerCase()
      return name.includes(query) || desc.includes(query)
    })
  })

  const variantOptionsFromModel = computed<string[]>(() => {
    const meta = opts.modelMetaFor(opts.selectedProviderId.value, opts.selectedModelId.value)
    const variants = isRecord(meta?.variants) ? meta.variants : null
    const out: string[] = []
    if (isRecord(variants)) {
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
    const selected = opts.selectedVariant.value.trim()
    if (selected && !out.includes(selected)) out.push(selected)
    out.sort((a, b) => a.localeCompare(b))
    return out
  })

  const hasVariantsForSelection = computed(() => {
    return variantOptionsFromModel.value.length > 0
  })

  const agentChipLabel = computed(() => {
    const value = (opts.selectedAgent.value || opts.effectiveDefaults.value.agent || '').trim()
    return value || 'Agent'
  })

  const modelChipLabel = computed(() => {
    const provider = opts.selectedProviderId.value.trim()
    const model = opts.selectedModelId.value.trim()
    if (provider && model) return `${provider}/${model}`
    const defProvider = opts.effectiveDefaults.value.provider
    const defModel = opts.effectiveDefaults.value.model
    if (defProvider && defModel) return `${defProvider}/${defModel}`
    return 'Model'
  })

  const modelChipLabelMobile = computed(() => {
    const label = modelChipLabel.value.trim()
    const idx = label.indexOf('/')
    if (idx > 0 && idx < label.length - 1) return label.slice(idx + 1)
    return label
  })

  const variantChipLabel = computed(() => {
    const value = opts.selectedVariant.value.trim()
    if (value) return value
    return hasVariantsForSelection.value ? 'Variants' : 'Variant'
  })

  const agentHint = computed(() => {
    if (opts.agentSource.value === 'manual' || opts.agentSource.value === 'session') return ''
    if (opts.selectedAgent.value) {
      return opts.agentSource.value === 'auto'
        ? 'Auto-selected the only available agent'
        : `Using OpenCode agent: ${opts.selectedAgent.value}`
    }
    return opts.effectiveDefaults.value.agent
      ? `Using OpenCode agent: ${opts.effectiveDefaults.value.agent}`
      : 'No default agent configured'
  })

  const modelHint = computed(() => {
    if (opts.modelSource.value === 'manual' || opts.modelSource.value === 'session') return ''
    if (opts.selectedProviderId.value && opts.selectedModelId.value) {
      const slug = `${opts.selectedProviderId.value}/${opts.selectedModelId.value}`
      return opts.modelSource.value === 'auto'
        ? 'Auto-selected the only available model'
        : `Using OpenCode model: ${slug}`
    }
    return opts.effectiveDefaults.value.provider && opts.effectiveDefaults.value.model
      ? `Using OpenCode model: ${opts.effectiveDefaults.value.provider}/${opts.effectiveDefaults.value.model}`
      : 'No default model configured'
  })

  const variantHint = computed(() => {
    if (opts.variantSource.value === 'manual' || opts.variantSource.value === 'session') return ''
    if (opts.selectedVariant.value) return `Using variant: ${opts.selectedVariant.value}`
    return ''
  })

  return {
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
  }
}

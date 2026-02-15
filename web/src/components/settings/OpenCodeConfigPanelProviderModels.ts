import { ref, type Ref } from 'vue'
import type { JsonValue as JsonLike } from '@/types/json'

type JsonObject = Record<string, JsonLike>

type ProviderEntryGetter = (providerId: string, ensure: boolean) => JsonObject
type IsPlainObject = (v: JsonLike) => v is JsonObject
type IsEmptyValue = (v: JsonLike) => boolean
type ParseNumberInput = (raw: string) => number | null

export function useOpenCodeConfigPanelProviderModels(opts: {
  providerEntry: ProviderEntryGetter
  selectedProviderId: Ref<string | null>
  selectedModelId: Ref<string | null>
  isPlainObject: IsPlainObject
  isEmptyValue: IsEmptyValue
  parseNumberInput: ParseNumberInput
  markDirty: () => void
}) {
  const {
    providerEntry,
    selectedProviderId,
    selectedModelId,
    isPlainObject,
    isEmptyValue,
    parseNumberInput,
    markDirty,
  } = opts

  const newProviderModelName = ref<Record<string, string>>({})
  const newVariantName = ref<Record<string, Record<string, string>>>({})

  function providerModels(providerId: string, ensure = false): JsonObject {
    const entry = providerEntry(providerId, ensure)
    if (isPlainObject(entry.models)) return entry.models
    if (ensure) {
      const next: JsonObject = {}
      entry.models = next
      markDirty()
      return next
    }
    return {}
  }

  function providerModelIds(providerId: string): string[] {
    return Object.keys(providerModels(providerId, false)).sort((a, b) => a.localeCompare(b))
  }

  function addProviderModel(providerId: string) {
    const name = (newProviderModelName.value[providerId] || '').trim()
    if (!name) return
    const models = providerModels(providerId, true)
    if (!isPlainObject(models[name])) {
      models[name] = {}
    }
    markDirty()
    newProviderModelName.value[providerId] = ''
    selectedProviderId.value = providerId
    selectedModelId.value = name
  }

  function removeProviderModel(providerId: string, modelId: string) {
    const models = providerModels(providerId, false)
    if (models[modelId]) {
      delete models[modelId]
      markDirty()
    }
    if (selectedProviderId.value === providerId && selectedModelId.value === modelId) {
      selectedModelId.value = null
    }
    if (Object.keys(models).length === 0) {
      const entry = providerEntry(providerId, false)
      if (isPlainObject(entry) && entry.models) {
        delete entry.models
      }
    }
  }

  function getModel(providerId: string, modelId: string, ensure = false): JsonObject {
    const models = providerModels(providerId, ensure)
    const existing = models[modelId]
    if (isPlainObject(existing)) return existing
    if (ensure) {
      const next: JsonObject = {}
      models[modelId] = next
      markDirty()
      return next
    }
    return {}
  }

  function modelVariants(providerId: string, modelId: string, ensure = false): JsonObject {
    const model = getModel(providerId, modelId, ensure)
    if (isPlainObject(model.variants)) return model.variants
    if (ensure) {
      const next: JsonObject = {}
      model.variants = next
      markDirty()
      return next
    }
    return {}
  }

  function addVariant(providerId: string, modelId: string) {
    const next = newVariantName.value[providerId] || {}
    const name = (next[modelId] || '').trim()
    if (!name) return
    const variants = modelVariants(providerId, modelId, true)
    if (!isPlainObject(variants[name])) {
      variants[name] = {}
    }
    markDirty()
    newVariantName.value = {
      ...newVariantName.value,
      [providerId]: { ...next, [modelId]: '' },
    }
  }

  function getNewVariantName(providerId: string, modelId: string): string {
    return newVariantName.value[providerId]?.[modelId] || ''
  }

  function setNewVariantName(providerId: string, modelId: string, value: string) {
    const current = newVariantName.value[providerId] || {}
    newVariantName.value = {
      ...newVariantName.value,
      [providerId]: { ...current, [modelId]: value },
    }
  }

  function removeVariant(providerId: string, modelId: string, variantId: string) {
    const variants = modelVariants(providerId, modelId, false)
    if (variants[variantId]) {
      delete variants[variantId]
      markDirty()
    }
    if (Object.keys(variants).length === 0) {
      const models = providerModels(providerId, false)
      const model = models[modelId]
      if (isPlainObject(model)) {
        delete model.variants
      }
    }
  }

  function variantExtra(providerId: string, modelId: string, variantId: string): JsonObject {
    const variants = modelVariants(providerId, modelId, false)
    const config = isPlainObject(variants[variantId]) ? variants[variantId] : {}
    const out: JsonObject = {}
    for (const [k, v] of Object.entries(config)) {
      if (k !== 'disabled') out[k] = v
    }
    return out
  }

  function setVariantExtra(providerId: string, modelId: string, variantId: string, value: JsonLike) {
    const variants = modelVariants(providerId, modelId, true)
    const current = isPlainObject(variants[variantId]) ? variants[variantId] : {}
    const disabled = current.disabled
    const next: JsonObject = {}
    if (disabled !== undefined) next.disabled = disabled
    if (isPlainObject(value)) {
      for (const [k, v] of Object.entries(value)) {
        next[k] = v
      }
    }
    variants[variantId] = next
    markDirty()
  }

  function setModelField(providerId: string, modelId: string, field: string, value: JsonLike) {
    const model = getModel(providerId, modelId, true)
    if (isEmptyValue(value)) {
      delete model[field]
    } else {
      model[field] = value
    }
    if (Object.keys(model).length === 0) {
      delete providerModels(providerId, true)[modelId]
    }
    markDirty()
  }

  function updateModelCost(providerId: string, modelId: string, key: string, raw: string) {
    const model = getModel(providerId, modelId, true)
    const cost = isPlainObject(model.cost) ? { ...model.cost } : {}
    const value = parseNumberInput(raw)
    if (value === null) {
      delete cost[key]
    } else {
      cost[key] = value
    }
    if (Object.keys(cost).length === 0) {
      delete model.cost
    } else {
      model.cost = cost
    }
    markDirty()
  }

  function updateModelCostOver(providerId: string, modelId: string, key: string, raw: string) {
    const model = getModel(providerId, modelId, true)
    const cost = isPlainObject(model.cost) ? { ...model.cost } : {}
    const over = isPlainObject(cost.context_over_200k) ? { ...cost.context_over_200k } : {}
    const value = parseNumberInput(raw)
    if (value === null) {
      delete over[key]
    } else {
      over[key] = value
    }
    if (Object.keys(over).length === 0) {
      delete cost.context_over_200k
    } else {
      cost.context_over_200k = over
    }
    if (Object.keys(cost).length === 0) {
      delete model.cost
    } else {
      model.cost = cost
    }
    markDirty()
  }

  function updateModelLimit(providerId: string, modelId: string, key: string, raw: string) {
    const model = getModel(providerId, modelId, true)
    const limit = isPlainObject(model.limit) ? { ...model.limit } : {}
    const value = parseNumberInput(raw)
    if (value === null) {
      delete limit[key]
    } else {
      limit[key] = value
    }
    if (Object.keys(limit).length === 0) {
      delete model.limit
    } else {
      model.limit = limit
    }
    markDirty()
  }

  function getModelInterleaved(providerId: string, modelId: string): string {
    const model = getModel(providerId, modelId, false)
    const v = model.interleaved
    if (v === true) return 'true'
    if (isPlainObject(v) && typeof v.field === 'string') return v.field
    return 'default'
  }

  function setModelInterleaved(providerId: string, modelId: string, mode: string) {
    if (mode === 'default') {
      setModelField(providerId, modelId, 'interleaved', null)
    } else if (mode === 'true') {
      setModelField(providerId, modelId, 'interleaved', true)
    } else {
      setModelField(providerId, modelId, 'interleaved', { field: mode })
    }
  }

  function toggleModelModality(providerId: string, modelId: string, field: 'input' | 'output', value: string) {
    const model = getModel(providerId, modelId, true)
    const modalitiesValue = isPlainObject(model.modalities) ? model.modalities : {}
    const list = Array.isArray(modalitiesValue[field]) ? [...modalitiesValue[field]] : []
    const index = list.indexOf(value)
    if (index >= 0) {
      list.splice(index, 1)
    } else {
      list.push(value)
    }
    if (!list.length) {
      delete modalitiesValue[field]
    } else {
      modalitiesValue[field] = list
    }
    if (Object.keys(modalitiesValue).length === 0) {
      delete model.modalities
    } else {
      model.modalities = modalitiesValue
    }
    markDirty()
  }

  function modelModalities(providerId: string, modelId: string, field: 'input' | 'output'): string[] {
    const model = getModel(providerId, modelId, false)
    if (!isPlainObject(model.modalities)) return []
    const list = model.modalities[field]
    return Array.isArray(list) ? list : []
  }

  return {
    newProviderModelName,
    providerModels,
    providerModelIds,
    addProviderModel,
    removeProviderModel,
    modelVariants,
    addVariant,
    removeVariant,
    getNewVariantName,
    setNewVariantName,
    variantExtra,
    setVariantExtra,
    setModelField,
    updateModelCost,
    updateModelCostOver,
    updateModelLimit,
    getModelInterleaved,
    setModelInterleaved,
    toggleModelModality,
    modelModalities,
  }
}

import { computed, watch, type Ref } from 'vue'

import { normalizeStringList } from './OpenCodeConfigPanelListUtils'
import type { JsonObject, JsonValue } from '@/types/json'

type ProviderTuple = [string, JsonValue]

export function useOpenCodeConfigPanelProvidersDerived(opts: {
  draft: Ref<JsonObject>
  getPath: (obj: JsonValue, path: string) => JsonValue
  setStringList: (path: string, list: string[]) => void

  providersRemote: Ref<JsonValue[]>
  providersList: Ref<ProviderTuple[]>

  providerFilterDebounced: Ref<string>
  selectedProviderId: Ref<string | null>
  selectedModelId: Ref<string | null>
  providerListOpen: Ref<Record<string, boolean>>

  providerModels: (id: string, ensure?: boolean) => Record<string, JsonValue>
  providerModelIds: (id: string) => string[]
  isPlainObject: (value: JsonValue) => value is JsonObject
}) {
  const enabledProvidersArr = computed<string[]>({
    get: () => normalizeStringList(opts.getPath(opts.draft.value, 'enabled_providers')),
    set: (list: string[]) => opts.setStringList('enabled_providers', list),
  })

  const disabledProvidersArr = computed<string[]>({
    get: () => normalizeStringList(opts.getPath(opts.draft.value, 'disabled_providers')),
    set: (list: string[]) => opts.setStringList('disabled_providers', list),
  })

  const providerIdOptions = computed<string[]>(() => {
    const merged = new Set<string>()

    for (const p of opts.providersRemote.value) {
      const pid = opts.isPlainObject(p) ? String(p.id || '').trim() : ''
      if (pid) merged.add(pid)
    }

    // Also include providers defined in the config file.
    for (const [pid] of opts.providersList.value) {
      const id = String(pid || '').trim()
      if (id) merged.add(id)
    }

    // Preserve any currently selected values.
    for (const id of enabledProvidersArr.value) merged.add(id)
    for (const id of disabledProvidersArr.value) merged.add(id)

    return Array.from(merged.values()).sort((a, b) => a.localeCompare(b))
  })

  const filteredProviderIdOptions = computed(() => {
    const q = opts.providerFilterDebounced.value.trim().toLowerCase()
    if (!q) return providerIdOptions.value
    return providerIdOptions.value.filter((id) => id.toLowerCase().includes(q))
  })

  const visibleProviders = computed(() => {
    const id = opts.selectedProviderId.value
    if (!id) return [] as ProviderTuple[]
    const found = opts.providersList.value.find(([pid]) => pid === id)
    return found ? [found] : []
  })

  const selectedProviderModels = computed(() => {
    const id = opts.selectedProviderId.value
    if (!id) return [] as string[]
    return opts.providerModelIds(id)
  })

  const selectedModelPairs = computed<[string, JsonObject][]>(() => {
    const pid = opts.selectedProviderId.value
    const mid = opts.selectedModelId.value
    if (!pid || !mid) return []
    const models = opts.providerModels(pid, false)
    const entry = models[mid]
    if (!opts.isPlainObject(entry)) return []
    return [[mid, entry]]
  })

  watch(
    opts.providersList,
    (list) => {
      const current = opts.selectedProviderId.value
      if (current && list.some(([id]) => id === current)) return
      const next = list[0]?.[0] || null
      opts.selectedProviderId.value = next
      opts.selectedModelId.value = null
      if (next) opts.providerListOpen.value[next] = true
    },
    { immediate: true },
  )

  watch(
    selectedProviderModels,
    (models) => {
      const current = opts.selectedModelId.value
      if (current && models.includes(current)) return
      opts.selectedModelId.value = null
    },
    { immediate: true },
  )

  const providerListConflict = computed(() => {
    const enabled = new Set(enabledProvidersArr.value)
    return disabledProvidersArr.value.filter((id) => enabled.has(id))
  })

  return {
    disabledProvidersArr,
    enabledProvidersArr,
    filteredProviderIdOptions,
    providerIdOptions,
    providerListConflict,
    selectedModelPairs,
    selectedProviderModels,
    visibleProviders,
  }
}

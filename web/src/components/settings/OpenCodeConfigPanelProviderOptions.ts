import { ref } from 'vue'
import type { JsonValue } from '@/types/json'

type JsonObject = Record<string, JsonValue>
type JsonEntry = { k: string; v: JsonValue }

type ProviderEntryGetter = (providerId: string, ensure: boolean) => JsonObject
type IsPlainObject = (v: JsonValue) => v is JsonObject
type IsEmptyValue = (v: JsonValue) => boolean
type ParseNumberInput = (raw: string) => number | null

export function useOpenCodeConfigPanelProviderOptions(opts: {
  providerEntry: ProviderEntryGetter
  providerOptionKeys: readonly string[]
  isPlainObject: IsPlainObject
  isEmptyValue: IsEmptyValue
  parseNumberInput: ParseNumberInput
  markDirty: () => void
}) {
  const { providerEntry, providerOptionKeys, isPlainObject, isEmptyValue, parseNumberInput, markDirty } = opts

  const showProviderOptionsJson = ref<Record<string, boolean>>({})

  const providerHeaderNewKey = ref<Record<string, string>>({})
  const providerHeaderNewVal = ref<Record<string, string>>({})
  const providerFlagNewKey = ref<Record<string, string>>({})
  const providerFlagNewVal = ref<Record<string, string>>({})
  const providerExtraNewKey = ref<Record<string, string>>({})
  const providerExtraNewVal = ref<Record<string, string>>({})

  function getProviderOption(providerId: string, key: string): JsonValue {
    const entry = providerEntry(providerId, false)
    if (!isPlainObject(entry.options)) return undefined
    return entry.options[key]
  }

  function setProviderOption(providerId: string, key: string, value: JsonValue) {
    const entry = providerEntry(providerId, true)
    const options: JsonObject = isPlainObject(entry.options) ? entry.options : {}
    if (!isPlainObject(entry.options)) entry.options = options
    if (isEmptyValue(value)) {
      delete options[key]
    } else {
      options[key] = value
    }
    if (Object.keys(options).length === 0) {
      delete entry.options
    }
    markDirty()
  }

  function getProviderOptionsExtra(providerId: string): JsonObject {
    const entry = providerEntry(providerId, false)
    if (!isPlainObject(entry.options)) return {}
    const out: JsonObject = {}
    for (const [k, v] of Object.entries(entry.options)) {
      if (!providerOptionKeys.includes(k)) out[k] = v
    }
    return out
  }

  function setProviderOptionsExtra(providerId: string, value: JsonValue) {
    const entry = providerEntry(providerId, true)
    const options: JsonObject = isPlainObject(entry.options) ? { ...entry.options } : {}
    for (const key of Object.keys(options)) {
      if (!providerOptionKeys.includes(key)) delete options[key]
    }
    if (isPlainObject(value)) {
      for (const [k, v] of Object.entries(value)) {
        options[k] = v
      }
    }
    if (Object.keys(options).length === 0) {
      delete entry.options
    } else {
      entry.options = options
    }
    markDirty()
  }

  function toggleProviderOptionsJson(providerId: string) {
    const cur = Boolean(showProviderOptionsJson.value[providerId])
    showProviderOptionsJson.value = { ...showProviderOptionsJson.value, [providerId]: !cur }
  }

  function parseJsonish(raw: string): JsonValue {
    const s = String(raw ?? '').trim()
    if (!s) return ''
    try {
      return JSON.parse(s)
    } catch {
      return s
    }
  }

  function getObjectOption(providerId: string, key: 'headers' | 'featureFlags'): JsonObject {
    const v = getProviderOption(providerId, key)
    return isPlainObject(v) ? v : {}
  }

  function setObjectOption(providerId: string, key: 'headers' | 'featureFlags', next: JsonObject) {
    setProviderOption(providerId, key, isEmptyValue(next) ? null : next)
  }

  function sortedEntries(obj: JsonObject): JsonEntry[] {
    return Object.entries(obj)
      .map(([k, v]) => ({ k, v }))
      .sort((a, b) => a.k.localeCompare(b.k))
  }

  function providerHeadersEntries(providerId: string) {
    const obj = getObjectOption(providerId, 'headers')
    return sortedEntries(obj)
  }

  function providerFeatureFlagEntries(providerId: string) {
    const obj = getObjectOption(providerId, 'featureFlags')
    return sortedEntries(obj)
  }

  function providerExtraEntries(providerId: string) {
    const obj = getProviderOptionsExtra(providerId)
    return sortedEntries(obj)
  }

  function renameMapKey(obj: JsonObject, oldKey: string, newKey: string): JsonObject {
    const o = String(oldKey || '').trim()
    const n = String(newKey || '').trim()
    if (!o) return obj
    if (!n) return obj
    if (o === n) return obj
    const out: JsonObject = { ...obj }
    const val = out[o]
    delete out[o]
    out[n] = val
    return out
  }

  function setMapEntry(obj: JsonObject, key: string, value: JsonValue): JsonObject {
    const k = String(key || '').trim()
    const out: JsonObject = { ...obj }
    if (!k) return out
    if (isEmptyValue(value)) {
      delete out[k]
    } else {
      out[k] = value
    }
    return out
  }

  function removeMapEntry(obj: JsonObject, key: string): JsonObject {
    const k = String(key || '').trim()
    if (!k) return obj
    const out: JsonObject = { ...obj }
    delete out[k]
    return out
  }

  function updateProviderHeaderKey(providerId: string, oldKey: string, newKey: string) {
    const obj = getObjectOption(providerId, 'headers')
    setObjectOption(providerId, 'headers', renameMapKey(obj, oldKey, newKey))
  }

  function updateProviderHeaderValue(providerId: string, key: string, value: string) {
    const obj = getObjectOption(providerId, 'headers')
    setObjectOption(providerId, 'headers', setMapEntry(obj, key, String(value ?? '')))
  }

  function addProviderHeader(providerId: string) {
    const k = (providerHeaderNewKey.value[providerId] || '').trim()
    const v = providerHeaderNewVal.value[providerId] ?? ''
    if (!k) return
    const obj = getObjectOption(providerId, 'headers')
    setObjectOption(providerId, 'headers', setMapEntry(obj, k, String(v)))
    providerHeaderNewKey.value = { ...providerHeaderNewKey.value, [providerId]: '' }
    providerHeaderNewVal.value = { ...providerHeaderNewVal.value, [providerId]: '' }
  }

  function removeProviderHeader(providerId: string, key: string) {
    const obj = getObjectOption(providerId, 'headers')
    setObjectOption(providerId, 'headers', removeMapEntry(obj, key))
  }

  function updateProviderFlagKey(providerId: string, oldKey: string, newKey: string) {
    const obj = getObjectOption(providerId, 'featureFlags')
    setObjectOption(providerId, 'featureFlags', renameMapKey(obj, oldKey, newKey))
  }

  function updateProviderFlagValue(providerId: string, key: string, value: string) {
    const obj = getObjectOption(providerId, 'featureFlags')
    const parsed = parseJsonish(value)
    setObjectOption(providerId, 'featureFlags', setMapEntry(obj, key, parsed))
  }

  function addProviderFlag(providerId: string) {
    const k = (providerFlagNewKey.value[providerId] || '').trim()
    const v = providerFlagNewVal.value[providerId] ?? ''
    if (!k) return
    const obj = getObjectOption(providerId, 'featureFlags')
    setObjectOption(providerId, 'featureFlags', setMapEntry(obj, k, parseJsonish(v)))
    providerFlagNewKey.value = { ...providerFlagNewKey.value, [providerId]: '' }
    providerFlagNewVal.value = { ...providerFlagNewVal.value, [providerId]: '' }
  }

  function removeProviderFlag(providerId: string, key: string) {
    const obj = getObjectOption(providerId, 'featureFlags')
    setObjectOption(providerId, 'featureFlags', removeMapEntry(obj, key))
  }

  function updateProviderExtraKey(providerId: string, oldKey: string, newKey: string) {
    const obj = getProviderOptionsExtra(providerId)
    setProviderOptionsExtra(providerId, renameMapKey(obj, oldKey, newKey))
  }

  function updateProviderExtraValue(providerId: string, key: string, value: string) {
    const obj = getProviderOptionsExtra(providerId)
    const parsed = parseJsonish(value)
    setProviderOptionsExtra(providerId, setMapEntry(obj, key, parsed))
  }

  function addProviderExtra(providerId: string) {
    const k = (providerExtraNewKey.value[providerId] || '').trim()
    const v = providerExtraNewVal.value[providerId] ?? ''
    if (!k) return
    const obj = getProviderOptionsExtra(providerId)
    setProviderOptionsExtra(providerId, setMapEntry(obj, k, parseJsonish(v)))
    providerExtraNewKey.value = { ...providerExtraNewKey.value, [providerId]: '' }
    providerExtraNewVal.value = { ...providerExtraNewVal.value, [providerId]: '' }
  }

  function removeProviderExtra(providerId: string, key: string) {
    const obj = getProviderOptionsExtra(providerId)
    setProviderOptionsExtra(providerId, removeMapEntry(obj, key))
  }

  function getProviderTimeoutMode(providerId: string): string {
    const v = getProviderOption(providerId, 'timeout')
    if (v === false) return 'disabled'
    if (typeof v === 'number') return 'custom'
    return 'default'
  }

  function getProviderTimeoutValue(providerId: string): string {
    const v = getProviderOption(providerId, 'timeout')
    return typeof v === 'number' ? String(v) : ''
  }

  function setProviderTimeoutMode(providerId: string, mode: string) {
    if (mode === 'default') {
      setProviderOption(providerId, 'timeout', null)
      return
    }
    if (mode === 'disabled') {
      setProviderOption(providerId, 'timeout', false)
      return
    }
    const current = getProviderOption(providerId, 'timeout')
    if (typeof current !== 'number') {
      setProviderOption(providerId, 'timeout', 10000)
    }
  }

  function setProviderTimeoutValue(providerId: string, raw: string) {
    const n = parseNumberInput(raw)
    if (n === null) {
      setProviderOption(providerId, 'timeout', null)
      return
    }
    setProviderOption(providerId, 'timeout', n)
  }

  return {
    showProviderOptionsJson,
    providerHeaderNewKey,
    providerHeaderNewVal,
    providerFlagNewKey,
    providerFlagNewVal,
    providerExtraNewKey,
    providerExtraNewVal,
    getProviderOption,
    setProviderOption,
    getProviderOptionsExtra,
    setProviderOptionsExtra,
    toggleProviderOptionsJson,
    providerHeadersEntries,
    providerFeatureFlagEntries,
    providerExtraEntries,
    updateProviderHeaderKey,
    updateProviderHeaderValue,
    addProviderHeader,
    removeProviderHeader,
    updateProviderFlagKey,
    updateProviderFlagValue,
    addProviderFlag,
    removeProviderFlag,
    updateProviderExtraKey,
    updateProviderExtraValue,
    addProviderExtra,
    removeProviderExtra,
    getProviderTimeoutMode,
    getProviderTimeoutValue,
    setProviderTimeoutMode,
    setProviderTimeoutValue,
  }
}

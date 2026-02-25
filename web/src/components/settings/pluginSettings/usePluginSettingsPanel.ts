import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { usePluginHostStore } from '@/stores/pluginHost'
import { useToastsStore } from '@/stores/toasts'
import type { JsonValue as JsonLike } from '@/types/json'

type JsonObject = Record<string, JsonLike>

type SchemaProperty = {
  title?: string
  description?: string
  'x-title-i18n'?: JsonLike
  'x-description-i18n'?: JsonLike
  type?: string
  enum?: JsonLike[]
  default?: JsonLike
  minimum?: number
  properties?: Record<string, JsonLike>
  items?: JsonLike
  oneOf?: JsonLike[]
  anyOf?: JsonLike[]
  allOf?: JsonLike[]
  additionalProperties?: JsonLike | boolean
}

type SettingsSchema = {
  type?: string
  properties?: Record<string, JsonLike>
}

type SchemaEntry = {
  kind: 'group' | 'field'
  path: string[]
  key: string
  prop: SchemaProperty
  depth: number
}

type MapRow = { key: string; value: string }

export type PluginSettingsPanelProps = {
  pluginId?: string | null
  hidePluginSelector?: boolean
}

function asObject(value: JsonLike): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as JsonObject
}

function cloneObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value || {})) as JsonObject
}

function asSchemaProperty(value: JsonLike): SchemaProperty {
  return asObject(value) as SchemaProperty
}

function isObjectWithProperties(prop: SchemaProperty): boolean {
  const p = prop.properties
  return !!p && typeof p === 'object' && !Array.isArray(p) && Object.keys(p).length > 0
}

function isPrimitiveProperty(prop: SchemaProperty): boolean {
  if (Array.isArray(prop.enum) && prop.enum.length > 0) return true
  return prop.type === 'string' || prop.type === 'number' || prop.type === 'integer' || prop.type === 'boolean'
}

function isArrayWithPrimitiveItems(prop: SchemaProperty): boolean {
  if (prop.type !== 'array') return false
  const items = asSchemaProperty(prop.items as JsonLike)
  return isPrimitiveProperty(items)
}

function additionalPrimitiveProp(prop: SchemaProperty): SchemaProperty | null {
  if (prop.type !== 'object') return null
  const ap = prop.additionalProperties
  if (!ap || ap === true || ap === false) return null
  const apProp = asSchemaProperty(ap as JsonLike)
  return isPrimitiveProperty(apProp) ? apProp : null
}

function flattenSchema(properties: Record<string, SchemaProperty>, basePath: string[] = []): SchemaEntry[] {
  const out: SchemaEntry[] = []

  for (const [key, raw] of Object.entries(properties)) {
    const prop = asSchemaProperty(raw as unknown as JsonLike)
    const path = [...basePath, key]
    const depth = path.length

    if (isObjectWithProperties(prop)) {
      out.push({ kind: 'group', path, key, prop, depth })
      const childProps = asObject(prop.properties as unknown as JsonLike)
      out.push(...flattenSchema(childProps as unknown as Record<string, SchemaProperty>, path))
      continue
    }

    out.push({ kind: 'field', path, key, prop, depth })
  }

  return out
}

function normalizeConfigResponse(data: JsonLike): JsonObject {
  const obj = asObject(data)
  if (obj.config && typeof obj.config === 'object' && !Array.isArray(obj.config)) {
    return asObject(obj.config)
  }
  return obj
}

function pathKey(path: string[]): string {
  return path.join('.')
}

function jsonFallbackValue(prop: SchemaProperty): JsonLike {
  if (prop.type === 'array') return []
  if (prop.type === 'object') return {}
  if (prop.default !== undefined) return prop.default
  return null
}

function enumToken(value: JsonLike): string {
  return JSON.stringify(value)
}

function arrayItemProp(prop: SchemaProperty): SchemaProperty {
  return asSchemaProperty(prop.items as JsonLike)
}

export function usePluginSettingsPanel(props: PluginSettingsPanelProps) {
  const pluginHost = usePluginHostStore()
  const toasts = useToastsStore()
  const { t, locale } = useI18n()

  const selectedPluginId = ref('')
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const config = ref<JsonObject>({})
  const draft = ref<JsonObject>({})

  const jsonTextByPath = ref<Record<string, string>>({})
  const jsonErrorByPath = ref<Record<string, string>>({})

  const arrayRowsByPath = ref<Record<string, string[]>>({})
  const arrayErrorByPath = ref<Record<string, string>>({})

  const mapRowsByPath = ref<Record<string, MapRow[]>>({})
  const mapErrorByPath = ref<Record<string, string>>({})

  const pluginsWithSchema = computed(() =>
    pluginHost.readyPlugins.filter((item) => {
      const manifest = pluginHost.getManifest(item.id)
      const schema = asObject(manifest?.manifest).settingsSchema
      return !!schema && typeof schema === 'object' && !Array.isArray(schema)
    }),
  )

  const pluginPickerOptions = computed(() =>
    pluginsWithSchema.value.map((plugin) => ({
      value: plugin.id,
      label: plugin.displayName || plugin.id,
    })),
  )

  const forcedPluginId = computed(() => String(props.pluginId || '').trim())
  const hidePluginSelector = computed(() => props.hidePluginSelector === true)

  const selectedPluginLabel = computed(() => {
    const id = selectedPluginId.value
    if (!id) return ''
    const plugin = pluginsWithSchema.value.find((item) => item.id === id)
    return plugin?.displayName || plugin?.id || id
  })

  const selectedManifest = computed(() => {
    if (!selectedPluginId.value) return null
    return pluginHost.getManifest(selectedPluginId.value)
  })

  const selectedSchema = computed<SettingsSchema>(() => {
    const manifestObj = asObject(selectedManifest.value?.manifest)
    return asObject(manifestObj.settingsSchema) as SettingsSchema
  })

  const schemaEntries = computed<SchemaEntry[]>(() => {
    const schemaProps = asObject((selectedSchema.value.properties || {}) as JsonLike)
    return flattenSchema(schemaProps as unknown as Record<string, SchemaProperty>)
  })

  const dirty = computed(() => JSON.stringify(config.value) !== JSON.stringify(draft.value))

  function resetEditorState() {
    jsonTextByPath.value = {}
    jsonErrorByPath.value = {}
    arrayRowsByPath.value = {}
    arrayErrorByPath.value = {}
    mapRowsByPath.value = {}
    mapErrorByPath.value = {}
  }

  async function loadPluginConfig() {
    if (!selectedPluginId.value) {
      config.value = {}
      draft.value = {}
      resetEditorState()
      return
    }

    loading.value = true
    error.value = null
    try {
      const resp = await pluginHost.pluginConfigGet(selectedPluginId.value)
      if (!resp.ok) {
        throw new Error(resp.error?.message || String(t('settings.pluginSettings.errors.failedToLoadConfig')))
      }
      const next = normalizeConfigResponse(resp.data)
      config.value = cloneObject(next)
      draft.value = cloneObject(next)
      resetEditorState()
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      config.value = {}
      draft.value = {}
      resetEditorState()
    } finally {
      loading.value = false
    }
  }

  function draftValueAtPath(path: string[]): JsonLike | undefined {
    let current: JsonLike = draft.value as unknown as JsonLike
    for (const key of path) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
      const obj = current as Record<string, JsonLike>
      if (!Object.prototype.hasOwnProperty.call(obj, key)) return undefined
      current = obj[key]
    }
    return current
  }

  function setDraftPath(path: string[], value: JsonLike | undefined) {
    if (path.length === 0) return
    const next = cloneObject(draft.value)
    let cursor: any = next
    for (let i = 0; i < path.length - 1; i += 1) {
      const key = path[i]!
      const current = cursor[key]
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        cursor[key] = {}
      }
      cursor = cursor[key]
    }
    const lastKey = path[path.length - 1]!
    if (value === undefined) {
      delete cursor[lastKey]
    } else {
      cursor[lastKey] = value
    }
    draft.value = next
  }

  function commitJsonText(path: string[], prop?: SchemaProperty): boolean {
    const key = pathKey(path)
    const raw = Object.prototype.hasOwnProperty.call(jsonTextByPath.value, key)
      ? jsonTextByPath.value[key]
      : jsonTextValue(path, prop || ({} as SchemaProperty))

    const trimmed = String(raw || '').trim()
    if (!trimmed) {
      setDraftPath(path, undefined)
      const nextText = { ...jsonTextByPath.value }
      delete nextText[key]
      jsonTextByPath.value = nextText
      const nextErr = { ...jsonErrorByPath.value }
      delete nextErr[key]
      jsonErrorByPath.value = nextErr
      return true
    }

    try {
      const parsed = JSON.parse(trimmed) as JsonLike
      setDraftPath(path, parsed)
      const nextErr = { ...jsonErrorByPath.value }
      delete nextErr[key]
      jsonErrorByPath.value = nextErr
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(t('settings.pluginSettings.errors.invalidJson'))
      jsonErrorByPath.value = { ...jsonErrorByPath.value, [key]: message }
      return false
    }
  }

  function commitAllJsonDrafts(): boolean {
    const keys = Object.keys(jsonTextByPath.value)
    if (keys.length === 0) return true

    let ok = true
    for (const key of keys) {
      const path = key.split('.').filter(Boolean)
      if (path.length === 0) continue
      if (!commitJsonText(path)) ok = false
    }
    return ok
  }

  async function savePluginConfig() {
    if (!selectedPluginId.value || saving.value) return

    if (Object.keys(arrayErrorByPath.value).length > 0 || Object.keys(mapErrorByPath.value).length > 0) {
      error.value = String(t('settings.pluginSettings.errors.fixInvalidListFields'))
      toasts.push('error', error.value)
      return
    }

    if (!commitAllJsonDrafts()) {
      error.value = String(t('settings.pluginSettings.errors.fixInvalidJsonFields'))
      toasts.push('error', error.value)
      return
    }

    saving.value = true
    error.value = null
    try {
      const resp = await pluginHost.pluginConfigSet(selectedPluginId.value, draft.value)
      if (!resp.ok) {
        throw new Error(resp.error?.message || String(t('settings.pluginSettings.errors.failedToSaveConfig')))
      }
      await loadPluginConfig()
      toasts.push('success', t('settings.pluginSettings.toasts.saved'))
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      toasts.push('error', error.value || String(t('settings.pluginSettings.errors.failedToSaveConfig')))
    } finally {
      saving.value = false
    }
  }

  watch(
    () => [pluginsWithSchema.value.map((item) => item.id).join('|'), forcedPluginId.value],
    () => {
      const available = pluginsWithSchema.value.map((item) => item.id)
      if (available.length === 0) {
        selectedPluginId.value = ''
        config.value = {}
        draft.value = {}
        error.value = null
        return
      }
      if (forcedPluginId.value && available.includes(forcedPluginId.value)) {
        selectedPluginId.value = forcedPluginId.value
        return
      }
      if (!available.includes(selectedPluginId.value)) {
        selectedPluginId.value = available[0] || ''
      }
    },
    { immediate: true },
  )

  watch(
    () => selectedPluginId.value,
    () => {
      arrayRowsByPath.value = {}
      arrayErrorByPath.value = {}
      mapRowsByPath.value = {}
      mapErrorByPath.value = {}
      void loadPluginConfig()
    },
    { immediate: true },
  )

  function localizedSchemaText(value: unknown): string {
    if (typeof value === 'string') return value.trim()
    if (!value || typeof value !== 'object' || Array.isArray(value)) return ''

    const map = value as Record<string, unknown>
    const currentLocale = String(locale.value || '').trim()
    const language = currentLocale.split('-')[0]?.toLowerCase() || ''

    const candidates: string[] = []
    if (currentLocale) candidates.push(currentLocale)
    if (language) candidates.push(language)
    candidates.push('en-US', 'zh-CN', 'en', 'zh')

    for (const candidate of candidates) {
      if (!candidate) continue
      const direct = map[candidate]
      if (typeof direct === 'string' && direct.trim()) return direct.trim()

      if (candidate.length === 2) {
        const byLang = Object.entries(map).find(([key, raw]) => {
          if (typeof raw !== 'string' || !raw.trim()) return false
          return key.toLowerCase() === candidate.toLowerCase()
        })
        if (byLang && typeof byLang[1] === 'string') return byLang[1].trim()
      }
    }

    for (const raw of Object.values(map)) {
      if (typeof raw === 'string' && raw.trim()) return raw.trim()
    }

    return ''
  }

  function humanizeKey(key: string): string {
    const raw = String(key || '').trim()
    if (!raw) return ''
    const spaced = raw
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim()
    if (!spaced) return ''
    return spaced[0]!.toUpperCase() + spaced.slice(1)
  }

  function getLabel(key: string, prop: SchemaProperty): string {
    const fallback = humanizeKey(key) || key
    const fromI18n = localizedSchemaText(prop['x-title-i18n'])
    const fromTitle = localizedSchemaText(prop.title)
    return (fromI18n || fromTitle || fallback).trim()
  }

  function getDescription(prop: SchemaProperty): string {
    const fromI18n = localizedSchemaText(prop['x-description-i18n'])
    const fromDescription = localizedSchemaText(prop.description)
    return (fromI18n || fromDescription || '').trim()
  }

  function jsonTextValue(path: string[], prop: SchemaProperty): string {
    const key = pathKey(path)
    if (Object.prototype.hasOwnProperty.call(jsonTextByPath.value, key)) {
      return jsonTextByPath.value[key] || ''
    }
    const current = draftValueAtPath(path)
    const value = current !== undefined ? current : prop.default !== undefined ? prop.default : jsonFallbackValue(prop)
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }

  function jsonError(path: string[]): string {
    const key = pathKey(path)
    return String(jsonErrorByPath.value[key] || '').trim()
  }

  function onJsonTextInput(path: string[], event: Event) {
    const key = pathKey(path)
    const raw = (event.target as HTMLTextAreaElement).value
    jsonTextByPath.value = { ...jsonTextByPath.value, [key]: raw }
    if (jsonErrorByPath.value[key]) {
      const next = { ...jsonErrorByPath.value }
      delete next[key]
      jsonErrorByPath.value = next
    }
  }

  function stringValue(path: string[], prop: SchemaProperty): string {
    const value = draftValueAtPath(path)
    if (typeof value === 'string') return value
    return typeof prop.default === 'string' ? prop.default : ''
  }

  function numberValue(path: string[], prop: SchemaProperty): string {
    const value = draftValueAtPath(path)
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    if (typeof prop.default === 'number' && Number.isFinite(prop.default)) return String(prop.default)
    return ''
  }

  function booleanValue(path: string[], prop: SchemaProperty): boolean {
    const value = draftValueAtPath(path)
    if (typeof value === 'boolean') return value
    return prop.default === true
  }

  function enumPickerOptions(values: JsonLike[]): Array<{ value: string; label: string }> {
    const list = Array.isArray(values) ? values : []
    return list.map((item) => ({ value: enumToken(item), label: String(item) }))
  }

  function enumCurrentToken(path: string[], prop: SchemaProperty): string {
    const value = draftValueAtPath(path) !== undefined ? draftValueAtPath(path) : prop.default
    if (value === undefined) return ''
    return enumToken(value)
  }

  function onStringInput(path: string[], event: Event) {
    const raw = (event.target as HTMLInputElement).value
    const trimmed = raw.trim()
    setDraftPath(path, trimmed ? raw : undefined)
  }

  function onNumberInput(path: string[], prop: SchemaProperty, event: Event) {
    const raw = (event.target as HTMLInputElement).value.trim()
    if (!raw) {
      setDraftPath(path, undefined)
      return
    }
    const value = Number(raw)
    if (!Number.isFinite(value)) return
    if (prop.type === 'integer') {
      setDraftPath(path, Math.trunc(value))
      return
    }
    setDraftPath(path, value)
  }

  function onBooleanInput(path: string[], event: Event) {
    const checked = (event.target as HTMLInputElement).checked
    setDraftPath(path, checked)
  }

  function onEnumSelect(path: string[], raw: string) {
    const token = String(raw || '')
    if (!token) {
      setDraftPath(path, undefined)
      return
    }
    try {
      setDraftPath(path, JSON.parse(token) as JsonLike)
    } catch {
      setDraftPath(path, token)
    }
  }

  function arrayItemType(prop: SchemaProperty): string {
    return String(arrayItemProp(prop).type || '')
  }

  function arrayItemEnum(prop: SchemaProperty): JsonLike[] {
    const item = arrayItemProp(prop)
    return Array.isArray(item.enum) ? item.enum : []
  }

  function mapValueType(prop: SchemaProperty): string {
    return String(additionalPrimitiveProp(prop)?.type || '')
  }

  function mapValueEnum(prop: SchemaProperty): JsonLike[] {
    const ap = additionalPrimitiveProp(prop)
    return ap && Array.isArray(ap.enum) ? ap.enum : []
  }

  function parsePrimitiveMapRows(
    prop: SchemaProperty,
    rows: MapRow[],
  ): { ok: true; parsed: Record<string, JsonLike> } | { ok: false; error: string } {
    const ap = additionalPrimitiveProp(prop)
    if (!ap) return { ok: true, parsed: {} }

    const out: Record<string, JsonLike> = {}
    const seen = new Set<string>()

    for (let idx = 0; idx < rows.length; idx += 1) {
      const k = String(rows[idx]?.key || '').trim()
      const raw = String(rows[idx]?.value || '')
      const trimmed = raw.trim()
      if (!k) continue
      if (!trimmed) continue
      if (seen.has(k)) {
        return {
          ok: false,
          error: String(t('settings.pluginSettings.errors.row.duplicateKey', { row: idx + 1, key: k })),
        }
      }
      seen.add(k)

      if (Array.isArray(ap.enum) && ap.enum.length > 0) {
        try {
          out[k] = JSON.parse(trimmed) as JsonLike
          continue
        } catch {
          return { ok: false, error: String(t('settings.pluginSettings.errors.row.invalidEnum', { row: idx + 1 })) }
        }
      }

      if (ap.type === 'string') {
        out[k] = trimmed
        continue
      }

      if (ap.type === 'number') {
        const num = Number(trimmed)
        if (!Number.isFinite(num)) {
          return { ok: false, error: String(t('settings.pluginSettings.errors.row.invalidNumber', { row: idx + 1 })) }
        }
        out[k] = num
        continue
      }

      if (ap.type === 'integer') {
        const num = Number(trimmed)
        if (!Number.isFinite(num) || !Number.isInteger(num)) {
          return { ok: false, error: String(t('settings.pluginSettings.errors.row.invalidInteger', { row: idx + 1 })) }
        }
        out[k] = num
        continue
      }

      if (ap.type === 'boolean') {
        if (trimmed === 'true') {
          out[k] = true
          continue
        }
        if (trimmed === 'false') {
          out[k] = false
          continue
        }
        return { ok: false, error: String(t('settings.pluginSettings.errors.row.useTrueFalse', { row: idx + 1 })) }
      }
    }

    return { ok: true, parsed: out }
  }

  function ensureMapRows(path: string[], prop: SchemaProperty): MapRow[] {
    const key = pathKey(path)
    if (Object.prototype.hasOwnProperty.call(mapRowsByPath.value, key)) {
      return mapRowsByPath.value[key] || []
    }

    const current = draftValueAtPath(path)
    const fallback = typeof prop.default === 'object' && prop.default && !Array.isArray(prop.default) ? prop.default : {}
    const obj =
      typeof current === 'object' && current && !Array.isArray(current)
        ? (current as Record<string, JsonLike>)
        : (fallback as Record<string, JsonLike>)

    const ap = additionalPrimitiveProp(prop)
    const rows: MapRow[] = Object.entries(obj).map(([k, v]) => {
      if (ap && Array.isArray(ap.enum) && ap.enum.length > 0) return { key: k, value: enumToken(v) }
      if (ap && ap.type === 'boolean') return { key: k, value: v === true ? 'true' : v === false ? 'false' : '' }
      return { key: k, value: String(v ?? '') }
    })

    mapRowsByPath.value = { ...mapRowsByPath.value, [key]: rows }
    return rows
  }

  function mapError(path: string[]): string {
    const key = pathKey(path)
    return String(mapErrorByPath.value[key] || '').trim()
  }

  function setMapRows(path: string[], prop: SchemaProperty, nextRows: MapRow[]) {
    const key = pathKey(path)
    mapRowsByPath.value = { ...mapRowsByPath.value, [key]: nextRows }

    const result = parsePrimitiveMapRows(prop, nextRows)
    if (!result.ok) {
      mapErrorByPath.value = { ...mapErrorByPath.value, [key]: result.error }
      return
    }

    if (mapErrorByPath.value[key]) {
      const nextErr = { ...mapErrorByPath.value }
      delete nextErr[key]
      mapErrorByPath.value = nextErr
    }

    const keys = Object.keys(result.parsed)
    setDraftPath(path, keys.length > 0 ? (result.parsed as unknown as JsonLike) : undefined)
  }

  function onMapKeyInput(path: string[], prop: SchemaProperty, rowIdx: number, event: Event) {
    const raw = (event.target as HTMLInputElement).value
    const rows = [...ensureMapRows(path, prop)]
    rows[rowIdx] = { ...(rows[rowIdx] || { key: '', value: '' }), key: raw }
    setMapRows(path, prop, rows)
  }

  function onMapValueInput(path: string[], prop: SchemaProperty, rowIdx: number, event: Event) {
    const raw = (event.target as HTMLInputElement).value
    const rows = [...ensureMapRows(path, prop)]
    rows[rowIdx] = { ...(rows[rowIdx] || { key: '', value: '' }), value: raw }
    setMapRows(path, prop, rows)
  }

  function onMapValueSelect(path: string[], prop: SchemaProperty, rowIdx: number, raw: string) {
    const token = String(raw || '')
    const rows = [...ensureMapRows(path, prop)]
    rows[rowIdx] = { ...(rows[rowIdx] || { key: '', value: '' }), value: token }
    setMapRows(path, prop, rows)
  }

  function addMapRow(path: string[], prop: SchemaProperty) {
    const rows = [...ensureMapRows(path, prop), { key: '', value: '' }]
    setMapRows(path, prop, rows)
  }

  function removeMapRow(path: string[], prop: SchemaProperty, rowIdx: number) {
    const rows = [...ensureMapRows(path, prop)]
    rows.splice(rowIdx, 1)
    setMapRows(path, prop, rows)
  }

  function clearMapRows(path: string[], prop: SchemaProperty) {
    setMapRows(path, prop, [])
  }

  function parsePrimitiveArrayRows(
    prop: SchemaProperty,
    rows: string[],
  ): { ok: true; parsed: JsonLike[] } | { ok: false; error: string } {
    const item = arrayItemProp(prop)
    const out: JsonLike[] = []

    for (let idx = 0; idx < rows.length; idx += 1) {
      const raw = String(rows[idx] || '')
      const trimmed = raw.trim()
      if (!trimmed) continue

      if (Array.isArray(item.enum) && item.enum.length > 0) {
        try {
          out.push(JSON.parse(trimmed) as JsonLike)
          continue
        } catch {
          return { ok: false, error: String(t('settings.pluginSettings.errors.row.invalidEnum', { row: idx + 1 })) }
        }
      }

      if (item.type === 'string') {
        out.push(trimmed)
        continue
      }

      if (item.type === 'number') {
        const num = Number(trimmed)
        if (!Number.isFinite(num)) {
          return { ok: false, error: String(t('settings.pluginSettings.errors.row.invalidNumber', { row: idx + 1 })) }
        }
        out.push(num)
        continue
      }

      if (item.type === 'integer') {
        const num = Number(trimmed)
        if (!Number.isFinite(num) || !Number.isInteger(num)) {
          return { ok: false, error: String(t('settings.pluginSettings.errors.row.invalidInteger', { row: idx + 1 })) }
        }
        out.push(num)
        continue
      }

      if (item.type === 'boolean') {
        if (trimmed === 'true') {
          out.push(true)
          continue
        }
        if (trimmed === 'false') {
          out.push(false)
          continue
        }
        return { ok: false, error: String(t('settings.pluginSettings.errors.row.useTrueFalse', { row: idx + 1 })) }
      }
    }

    return { ok: true, parsed: out }
  }

  function ensureArrayRows(path: string[], prop: SchemaProperty): string[] {
    const key = pathKey(path)
    if (Object.prototype.hasOwnProperty.call(arrayRowsByPath.value, key)) {
      return arrayRowsByPath.value[key] || []
    }

    const current = draftValueAtPath(path)
    const fallback = Array.isArray(prop.default) ? prop.default : []
    const list = Array.isArray(current) ? current : fallback
    const item = arrayItemProp(prop)

    const rows = list.map((value) => {
      if (Array.isArray(item.enum) && item.enum.length > 0) return enumToken(value)
      if (item.type === 'boolean') return value === true ? 'true' : value === false ? 'false' : ''
      return String(value ?? '')
    })

    arrayRowsByPath.value = { ...arrayRowsByPath.value, [key]: rows }
    return rows
  }

  function arrayError(path: string[]): string {
    const key = pathKey(path)
    return String(arrayErrorByPath.value[key] || '').trim()
  }

  function setArrayRows(path: string[], prop: SchemaProperty, nextRows: string[]) {
    const key = pathKey(path)
    arrayRowsByPath.value = { ...arrayRowsByPath.value, [key]: nextRows }

    const result = parsePrimitiveArrayRows(prop, nextRows)
    if (!result.ok) {
      arrayErrorByPath.value = { ...arrayErrorByPath.value, [key]: result.error }
      return
    }

    if (arrayErrorByPath.value[key]) {
      const nextErr = { ...arrayErrorByPath.value }
      delete nextErr[key]
      arrayErrorByPath.value = nextErr
    }

    setDraftPath(path, result.parsed.length > 0 ? (result.parsed as unknown as JsonLike) : undefined)
  }

  function onArrayRowInput(path: string[], prop: SchemaProperty, rowIdx: number, event: Event) {
    const raw = (event.target as HTMLInputElement).value
    const rows = [...ensureArrayRows(path, prop)]
    rows[rowIdx] = raw
    setArrayRows(path, prop, rows)
  }

  function onArrayRowSelect(path: string[], prop: SchemaProperty, rowIdx: number, raw: string) {
    const token = String(raw || '')
    const rows = [...ensureArrayRows(path, prop)]
    rows[rowIdx] = token
    setArrayRows(path, prop, rows)
  }

  function addArrayRow(path: string[], prop: SchemaProperty) {
    const rows = [...ensureArrayRows(path, prop), '']
    setArrayRows(path, prop, rows)
  }

  function removeArrayRow(path: string[], prop: SchemaProperty, rowIdx: number) {
    const rows = [...ensureArrayRows(path, prop)]
    rows.splice(rowIdx, 1)
    setArrayRows(path, prop, rows)
  }

  function clearArrayRows(path: string[], prop: SchemaProperty) {
    setArrayRows(path, prop, [])
  }

  return {
    additionalPrimitiveProp,
    addArrayRow,
    addMapRow,
    arrayError,
    arrayItemEnum,
    arrayItemProp,
    arrayItemType,
    booleanValue,
    clearArrayRows,
    clearMapRows,
    commitJsonText,
    dirty,
    enumCurrentToken,
    enumPickerOptions,
    error,
    getDescription,
    getLabel,
    hidePluginSelector,
    isArrayWithPrimitiveItems,
    jsonError,
    jsonTextValue,
    loadPluginConfig,
    loading,
    mapError,
    mapValueEnum,
    mapValueType,
    numberValue,
    onArrayRowInput,
    onArrayRowSelect,
    onBooleanInput,
    onEnumSelect,
    onJsonTextInput,
    onMapKeyInput,
    onMapValueInput,
    onMapValueSelect,
    onNumberInput,
    onStringInput,
    pluginPickerOptions,
    pluginsWithSchema,
    removeArrayRow,
    removeMapRow,
    savePluginConfig,
    saving,
    schemaEntries,
    selectedPluginId,
    selectedPluginLabel,
    stringValue,
    t,
    ensureArrayRows,
    ensureMapRows,
  }
}

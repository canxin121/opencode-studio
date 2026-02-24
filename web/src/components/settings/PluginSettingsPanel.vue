<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/Button.vue'
import OptionPicker from '@/components/ui/OptionPicker.vue'
import { usePluginHostStore } from '@/stores/pluginHost'
import { useToastsStore } from '@/stores/toasts'
import type { JsonValue as JsonLike } from '@/types/json'

type JsonObject = Record<string, JsonLike>

type SchemaProperty = {
  title?: string
  description?: string
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

const props = withDefaults(
  defineProps<{
    pluginId?: string | null
    hidePluginSelector?: boolean
  }>(),
  {
    pluginId: '',
    hidePluginSelector: false,
  },
)

const pluginHost = usePluginHostStore()
const toasts = useToastsStore()
const { t } = useI18n()

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

type MapRow = { key: string; value: string }
const mapRowsByPath = ref<Record<string, MapRow[]>>({})
const mapErrorByPath = ref<Record<string, string>>({})

function asObject(value: JsonLike): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as JsonObject
}

function cloneObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value || {})) as JsonObject
}

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

type SchemaEntry = {
  kind: 'group' | 'field'
  path: string[]
  key: string
  prop: SchemaProperty
  depth: number
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

function mapValueType(prop: SchemaProperty): string {
  return String(additionalPrimitiveProp(prop)?.type || '')
}

function mapValueEnum(prop: SchemaProperty): JsonLike[] {
  const ap = additionalPrimitiveProp(prop)
  return ap && Array.isArray(ap.enum) ? ap.enum : []
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

const schemaEntries = computed<SchemaEntry[]>(() => {
  const props = asObject((selectedSchema.value.properties || {}) as JsonLike)
  return flattenSchema(props as unknown as Record<string, SchemaProperty>)
})

const dirty = computed(() => JSON.stringify(config.value) !== JSON.stringify(draft.value))

function normalizeConfigResponse(data: JsonLike): JsonObject {
  const obj = asObject(data)
  if (obj.config && typeof obj.config === 'object' && !Array.isArray(obj.config)) {
    return asObject(obj.config)
  }
  return obj
}

async function loadPluginConfig() {
  if (!selectedPluginId.value) {
    config.value = {}
    draft.value = {}
    jsonTextByPath.value = {}
    jsonErrorByPath.value = {}
    arrayRowsByPath.value = {}
    arrayErrorByPath.value = {}
    mapRowsByPath.value = {}
    mapErrorByPath.value = {}
    return
  }

  loading.value = true
  error.value = null
  try {
    const resp = await pluginHost.pluginConfigGet(selectedPluginId.value)
    if (!resp.ok) {
      throw new Error(resp.error?.message || 'Failed to load plugin config')
    }
    const next = normalizeConfigResponse(resp.data)
    config.value = cloneObject(next)
    draft.value = cloneObject(next)
    jsonTextByPath.value = {}
    jsonErrorByPath.value = {}
    arrayRowsByPath.value = {}
    arrayErrorByPath.value = {}
    mapRowsByPath.value = {}
    mapErrorByPath.value = {}
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    config.value = {}
    draft.value = {}
    jsonTextByPath.value = {}
    jsonErrorByPath.value = {}
    arrayRowsByPath.value = {}
    arrayErrorByPath.value = {}
    mapRowsByPath.value = {}
    mapErrorByPath.value = {}
  } finally {
    loading.value = false
  }
}

async function savePluginConfig() {
  if (!selectedPluginId.value || saving.value) return

  if (Object.keys(arrayErrorByPath.value).length > 0 || Object.keys(mapErrorByPath.value).length > 0) {
    error.value = 'Fix invalid list fields before saving.'
    toasts.push('error', error.value)
    return
  }

  if (!commitAllJsonDrafts()) {
    error.value = 'Fix invalid JSON fields before saving.'
    toasts.push('error', error.value)
    return
  }

  saving.value = true
  error.value = null
  try {
    const resp = await pluginHost.pluginConfigSet(selectedPluginId.value, draft.value)
    if (!resp.ok) {
      throw new Error(resp.error?.message || 'Failed to save plugin config')
    }
    await loadPluginConfig()
    toasts.push('success', t('settings.pluginSettings.toasts.saved'))
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    toasts.push('error', error.value || 'Failed to save plugin config')
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

function getLabel(key: string, prop: SchemaProperty): string {
  const fallback = humanizeKey(key) || key
  return (prop.title || fallback).trim()
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

function getDescription(prop: SchemaProperty): string {
  return String(prop.description || '').trim()
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
    const message = err instanceof Error ? err.message : 'Invalid JSON'
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

function enumToken(value: JsonLike): string {
  return JSON.stringify(value)
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

function arrayItemProp(prop: SchemaProperty): SchemaProperty {
  return asSchemaProperty(prop.items as JsonLike)
}

function arrayItemType(prop: SchemaProperty): string {
  return String(arrayItemProp(prop).type || '')
}

function arrayItemEnum(prop: SchemaProperty): JsonLike[] {
  const item = arrayItemProp(prop)
  return Array.isArray(item.enum) ? item.enum : []
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
    if (seen.has(k)) return { ok: false, error: `Row ${idx + 1}: duplicate key '${k}'.` }
    seen.add(k)

    if (Array.isArray(ap.enum) && ap.enum.length > 0) {
      try {
        out[k] = JSON.parse(trimmed) as JsonLike
        continue
      } catch {
        return { ok: false, error: `Row ${idx + 1}: invalid enum value.` }
      }
    }

    if (ap.type === 'string') {
      out[k] = trimmed
      continue
    }

    if (ap.type === 'number') {
      const num = Number(trimmed)
      if (!Number.isFinite(num)) return { ok: false, error: `Row ${idx + 1}: invalid number.` }
      out[k] = num
      continue
    }

    if (ap.type === 'integer') {
      const num = Number(trimmed)
      if (!Number.isFinite(num) || !Number.isInteger(num)) {
        return { ok: false, error: `Row ${idx + 1}: invalid integer.` }
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
      return { ok: false, error: `Row ${idx + 1}: use true or false.` }
    }
  }

  return { ok: true, parsed: out }
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
        return { ok: false, error: `Row ${idx + 1}: invalid enum value.` }
      }
    }

    if (item.type === 'string') {
      out.push(trimmed)
      continue
    }

    if (item.type === 'number') {
      const num = Number(trimmed)
      if (!Number.isFinite(num)) return { ok: false, error: `Row ${idx + 1}: invalid number.` }
      out.push(num)
      continue
    }

    if (item.type === 'integer') {
      const num = Number(trimmed)
      if (!Number.isFinite(num) || !Number.isInteger(num)) {
        return { ok: false, error: `Row ${idx + 1}: invalid integer.` }
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
      return { ok: false, error: `Row ${idx + 1}: use true or false.` }
    }
  }

  return { ok: true, parsed: out }
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
</script>

<template>
  <section class="rounded-lg border border-border bg-muted/10 p-4 space-y-4 min-w-0">
    <div class="flex flex-wrap items-center gap-2 min-w-0">
      <div class="text-sm font-medium">{{ t('settings.pluginSettings.title') }}</div>
      <div class="ml-auto text-xs text-muted-foreground">{{ t('settings.pluginSettings.subtitle') }}</div>
    </div>

    <div v-if="pluginsWithSchema.length === 0" class="text-xs text-muted-foreground">
      {{ t('settings.pluginSettings.noSchemaPublished') }}
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <div v-if="!hidePluginSelector" class="min-w-[220px] flex-1 max-w-[420px]">
          <OptionPicker
            v-model="selectedPluginId"
            :options="pluginPickerOptions"
            :title="t('settings.pluginSettings.fields.plugin')"
            :search-placeholder="t('settings.pluginSettings.searchPlugins')"
            :include-empty="false"
            :disabled="loading || saving"
          />
        </div>

        <div
          v-else
          class="h-9 inline-flex items-center rounded-md border border-input bg-transparent px-3 text-sm max-w-full min-w-0"
        >
          <span class="truncate">{{ selectedPluginLabel }}</span>
        </div>

        <Button variant="outline" size="sm" :disabled="loading || saving" @click="loadPluginConfig">{{ t('common.reload') }}</Button>
        <Button size="sm" :disabled="loading || saving || !dirty" @click="savePluginConfig">
          {{ saving ? t('common.saving') : t('common.save') }}
        </Button>
      </div>

      <div
        v-if="error"
        class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive break-words"
      >
        {{ error }}
      </div>

      <div v-if="loading" class="text-xs text-muted-foreground">{{ t('settings.pluginSettings.loadingConfig') }}</div>

      <div v-else class="grid gap-3">
        <div v-if="schemaEntries.length === 0" class="text-xs text-muted-foreground">
          {{ t('settings.pluginSettings.noFieldsDeclared') }}
        </div>

        <div
          v-for="entry in schemaEntries"
          :key="entry.path.join('.')"
          class="grid gap-1 min-w-0"
          :style="{ paddingLeft: `${Math.max(0, (entry.depth - 1) * 12)}px` }"
        >
          <template v-if="entry.kind === 'group'">
            <div class="pt-2 text-xs font-semibold text-muted-foreground break-words">
              {{ getLabel(entry.key, entry.prop) }}
            </div>
            <div v-if="getDescription(entry.prop)" class="text-xs text-muted-foreground break-words">
              {{ getDescription(entry.prop) }}
            </div>
          </template>

          <template v-else>
            <label class="text-sm font-medium leading-none break-words">{{ getLabel(entry.key, entry.prop) }}</label>
            <div v-if="getDescription(entry.prop)" class="text-xs text-muted-foreground break-words">
              {{ getDescription(entry.prop) }}
            </div>

            <OptionPicker
              v-if="Array.isArray(entry.prop.enum) && entry.prop.enum.length > 0"
              :model-value="enumCurrentToken(entry.path, entry.prop)"
              @update:model-value="(v) => onEnumSelect(entry.path, String(v || ''))"
              :options="enumPickerOptions(entry.prop.enum)"
              :title="t('common.select')"
              :search-placeholder="t('common.searchOptions')"
              :empty-label="`(${t('common.default')})`"
            />

            <input
              v-else-if="entry.prop.type === 'string'"
              type="text"
              :value="stringValue(entry.path, entry.prop)"
              class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              @input="onStringInput(entry.path, $event)"
            />

            <input
              v-else-if="entry.prop.type === 'number' || entry.prop.type === 'integer'"
              type="number"
              :step="entry.prop.type === 'integer' ? '1' : 'any'"
              :min="typeof entry.prop.minimum === 'number' ? entry.prop.minimum : undefined"
              :value="numberValue(entry.path, entry.prop)"
              class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              @input="onNumberInput(entry.path, entry.prop, $event)"
            />

            <label v-else-if="entry.prop.type === 'boolean'" class="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                :checked="booleanValue(entry.path, entry.prop)"
                @change="onBooleanInput(entry.path, $event)"
              />
              <span class="text-muted-foreground">{{ t('common.on') }}</span>
            </label>

            <div v-else-if="entry.prop.type === 'array' && isArrayWithPrimitiveItems(entry.prop)" class="grid gap-2">
              <div class="rounded-md border border-input bg-transparent p-2 grid gap-2">
                <div
                  v-for="(row, rowIdx) in ensureArrayRows(entry.path, entry.prop)"
                  :key="`arr:${entry.path.join('.')}:${rowIdx}`"
                  class="flex flex-col gap-2 sm:flex-row sm:items-center min-w-0"
                >
                  <div v-if="arrayItemEnum(entry.prop).length > 0" class="w-full sm:flex-1 sm:min-w-0">
                    <OptionPicker
                      :model-value="row"
                      @update:model-value="(v) => onArrayRowSelect(entry.path, entry.prop, rowIdx, String(v || ''))"
                      :options="enumPickerOptions(arrayItemEnum(entry.prop))"
                      :title="t('common.select')"
                      :search-placeholder="t('common.searchOptions')"
                      :empty-label="`(${t('common.empty')})`"
                    />
                  </div>

                  <div v-else-if="arrayItemProp(entry.prop).type === 'boolean'" class="w-full sm:flex-1 sm:min-w-0">
                    <OptionPicker
                      :model-value="row"
                      @update:model-value="(v) => onArrayRowSelect(entry.path, entry.prop, rowIdx, String(v || ''))"
                      :options="[
                        { value: 'true', label: 'true' },
                        { value: 'false', label: 'false' },
                      ]"
                      :title="t('common.select')"
                      :search-placeholder="t('common.searchOptions')"
                      :empty-label="`(${t('common.empty')})`"
                    />
                  </div>

                  <input
                    v-else
                    type="text"
                    :inputmode="
                      arrayItemType(entry.prop) === 'integer'
                        ? 'numeric'
                        : arrayItemType(entry.prop) === 'number'
                          ? 'decimal'
                          : 'text'
                    "
                    :placeholder="
                      arrayItemType(entry.prop) === 'integer'
                        ? String(t('common.integer'))
                        : arrayItemType(entry.prop) === 'number'
                          ? String(t('common.number'))
                          : String(t('common.value'))
                    "
                    :value="row"
                    class="h-9 w-full sm:flex-1 sm:min-w-0 rounded-md border border-input bg-transparent px-3 text-sm"
                    @input="onArrayRowInput(entry.path, entry.prop, rowIdx, $event)"
                  />

                  <Button
                    variant="outline"
                    size="sm"
                    class="w-full sm:w-auto"
                    @click="removeArrayRow(entry.path, entry.prop, rowIdx)"
                  >
                    {{ t('common.remove') }}
                  </Button>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" @click="addArrayRow(entry.path, entry.prop)">{{ t('common.add') }}</Button>
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="ensureArrayRows(entry.path, entry.prop).length === 0"
                    @click="clearArrayRows(entry.path, entry.prop)"
                  >
                    {{ t('common.clear') }}
                  </Button>
                </div>
              </div>

              <div v-if="arrayError(entry.path)" class="text-xs text-destructive">{{ arrayError(entry.path) }}</div>
            </div>

            <div v-else-if="entry.prop.type === 'object' && additionalPrimitiveProp(entry.prop)" class="grid gap-2">
              <div class="rounded-md border border-input bg-transparent p-2 grid gap-2">
                <div
                  v-for="(row, rowIdx) in ensureMapRows(entry.path, entry.prop)"
                  :key="`map:${entry.path.join('.')}:${rowIdx}`"
                  class="flex flex-col gap-2 sm:flex-row sm:items-center min-w-0"
                >
                  <input
                    type="text"
                    :placeholder="t('common.key')"
                    :value="row.key"
                    class="h-9 w-full sm:w-[40%] sm:min-w-[160px] sm:max-w-[320px] rounded-md border border-input bg-transparent px-3 text-sm"
                    @input="onMapKeyInput(entry.path, entry.prop, rowIdx, $event)"
                  />

                  <div v-if="mapValueEnum(entry.prop).length > 0" class="w-full sm:flex-1 sm:min-w-0">
                    <OptionPicker
                      :model-value="row.value"
                      @update:model-value="(v) => onMapValueSelect(entry.path, entry.prop, rowIdx, String(v || ''))"
                      :options="enumPickerOptions(mapValueEnum(entry.prop))"
                      :title="t('common.select')"
                      :search-placeholder="t('common.searchOptions')"
                      :empty-label="`(${t('common.empty')})`"
                    />
                  </div>

                  <div v-else-if="mapValueType(entry.prop) === 'boolean'" class="w-full sm:flex-1 sm:min-w-0">
                    <OptionPicker
                      :model-value="row.value"
                      @update:model-value="(v) => onMapValueSelect(entry.path, entry.prop, rowIdx, String(v || ''))"
                      :options="[
                        { value: 'true', label: 'true' },
                        { value: 'false', label: 'false' },
                      ]"
                      :title="t('common.select')"
                      :search-placeholder="t('common.searchOptions')"
                      :empty-label="`(${t('common.empty')})`"
                    />
                  </div>

                  <input
                    v-else
                    type="text"
                    :inputmode="
                      mapValueType(entry.prop) === 'integer'
                        ? 'numeric'
                        : mapValueType(entry.prop) === 'number'
                          ? 'decimal'
                          : 'text'
                    "
                    :placeholder="
                      mapValueType(entry.prop) === 'integer'
                        ? String(t('common.integer'))
                        : mapValueType(entry.prop) === 'number'
                          ? String(t('common.number'))
                          : String(t('common.value'))
                    "
                    :value="row.value"
                    class="h-9 w-full sm:flex-1 sm:min-w-0 rounded-md border border-input bg-transparent px-3 text-sm"
                    @input="onMapValueInput(entry.path, entry.prop, rowIdx, $event)"
                  />

                  <Button
                    variant="outline"
                    size="sm"
                    class="w-full sm:w-auto"
                    @click="removeMapRow(entry.path, entry.prop, rowIdx)"
                  >
                    {{ t('common.remove') }}
                  </Button>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" @click="addMapRow(entry.path, entry.prop)">{{ t('common.add') }}</Button>
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="ensureMapRows(entry.path, entry.prop).length === 0"
                    @click="clearMapRows(entry.path, entry.prop)"
                  >
                    {{ t('common.clear') }}
                  </Button>
                </div>
              </div>

              <div v-if="mapError(entry.path)" class="text-xs text-destructive">{{ mapError(entry.path) }}</div>
            </div>

            <textarea
              v-else
              :value="jsonTextValue(entry.path, entry.prop)"
              class="min-h-[120px] w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
              spellcheck="false"
              @input="onJsonTextInput(entry.path, $event)"
              @blur="commitJsonText(entry.path, entry.prop)"
            />

            <div v-if="jsonError(entry.path)" class="text-xs text-destructive">{{ jsonError(entry.path) }}</div>
            <div
              v-else-if="entry.prop.type === 'object' || entry.prop.type === 'array'"
              class="text-xs text-muted-foreground"
            >
              Edit as JSON.
            </div>
          </template>
        </div>
      </div>
    </template>
  </section>
</template>

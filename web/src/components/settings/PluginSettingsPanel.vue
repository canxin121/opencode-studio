<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import Button from '@/components/ui/Button.vue'
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

const selectedPluginId = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const config = ref<JsonObject>({})
const draft = ref<JsonObject>({})

const jsonTextByPath = ref<Record<string, string>>({})
const jsonErrorByPath = ref<Record<string, string>>({})

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

function flattenSchema(
  properties: Record<string, SchemaProperty>,
  basePath: string[] = [],
): SchemaEntry[] {
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
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    config.value = {}
    draft.value = {}
    jsonTextByPath.value = {}
    jsonErrorByPath.value = {}
  } finally {
    loading.value = false
  }
}

async function savePluginConfig() {
  if (!selectedPluginId.value || saving.value) return

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
    toasts.push('success', 'Plugin config saved')
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

function onEnumInput(path: string[], event: Event) {
  const raw = (event.target as HTMLSelectElement).value
  if (!raw) {
    setDraftPath(path, undefined)
    return
  }
  try {
    setDraftPath(path, JSON.parse(raw) as JsonLike)
  } catch {
    setDraftPath(path, raw)
  }
}

function arrayValue(path: string[], prop: SchemaProperty): string {
  const value = draftValueAtPath(path)
  const fallback = Array.isArray(prop.default) ? prop.default : []
  const list = Array.isArray(value) ? value : fallback
  return list.map((item) => String(item)).join('\n')
}

function parseArrayInput(raw: string): string[] {
  return raw
    .split(/\r?\n|,/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

function onArrayInput(path: string[], prop: SchemaProperty, event: Event) {
  const raw = (event.target as HTMLTextAreaElement).value
  const trimmed = raw.trim()
  if (!trimmed) {
    setDraftPath(path, undefined)
    return
  }

  // Accept JSON arrays too.
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      const items = asSchemaProperty(prop.items as JsonLike)
      if (items.type === 'integer' || items.type === 'number') {
        const nums = parsed
          .map((item) => {
            if (typeof item === 'number') return item
            if (typeof item === 'string' && item.trim()) return Number(item.trim())
            return Number.NaN
          })
          .filter((num) => Number.isFinite(num))
          .map((num) => (items.type === 'integer' ? Math.trunc(num) : num))
        setDraftPath(path, nums as unknown as JsonLike)
        return
      }

      if (items.type === 'string') {
        const strs = parsed
          .map((item) => String(item).trim())
          .filter((item) => item.length > 0)
        setDraftPath(path, strs as unknown as JsonLike)
        return
      }

      setDraftPath(path, parsed as unknown as JsonLike)
      return
    }
  } catch {
    // fall through
  }

  const items = asSchemaProperty(prop.items as JsonLike)
  const parts = parseArrayInput(trimmed)
  if (items.type === 'integer' || items.type === 'number') {
    const nums = parts
      .map((part) => Number(part))
      .filter((num) => Number.isFinite(num))
      .map((num) => (items.type === 'integer' ? Math.trunc(num) : num))
    setDraftPath(path, nums as unknown as JsonLike)
    return
  }

  setDraftPath(path, parts as unknown as JsonLike)
}
</script>

<template>
  <section class="rounded-lg border border-border bg-muted/10 p-4 space-y-4">
    <div class="flex items-center gap-2">
      <div class="text-sm font-medium">Plugin settings</div>
      <div class="ml-auto text-xs text-muted-foreground">Config is persisted by each plugin</div>
    </div>

    <div v-if="pluginsWithSchema.length === 0" class="text-xs text-muted-foreground">
      No plugin published a `settingsSchema` yet.
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <select
          v-if="!hidePluginSelector"
          v-model="selectedPluginId"
          class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          <option v-for="plugin in pluginsWithSchema" :key="plugin.id" :value="plugin.id">
            {{ plugin.displayName || plugin.id }}
          </option>
        </select>

        <div v-else class="h-9 inline-flex items-center rounded-md border border-input bg-transparent px-3 text-sm">
          {{ selectedPluginLabel }}
        </div>

        <Button variant="outline" size="sm" :disabled="loading || saving" @click="loadPluginConfig">Reload</Button>
        <Button size="sm" :disabled="loading || saving || !dirty" @click="savePluginConfig">
          {{ saving ? 'Saving…' : 'Save' }}
        </Button>
      </div>

      <div v-if="error" class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {{ error }}
      </div>

      <div v-if="loading" class="text-xs text-muted-foreground">Loading plugin config…</div>

      <div v-else class="grid gap-3">
        <div v-if="schemaEntries.length === 0" class="text-xs text-muted-foreground">
          This plugin did not declare any settings fields.
        </div>

        <div
          v-for="entry in schemaEntries"
          :key="entry.path.join('.')"
          class="grid gap-1"
          :style="{ paddingLeft: `${Math.max(0, (entry.depth - 1) * 12)}px` }"
        >
          <template v-if="entry.kind === 'group'">
            <div class="pt-2 text-xs font-semibold text-muted-foreground">
              {{ getLabel(entry.key, entry.prop) }}
            </div>
            <div v-if="getDescription(entry.prop)" class="text-xs text-muted-foreground">
              {{ getDescription(entry.prop) }}
            </div>
          </template>

          <template v-else>
            <label class="text-sm font-medium leading-none">{{ getLabel(entry.key, entry.prop) }}</label>
            <div v-if="getDescription(entry.prop)" class="text-xs text-muted-foreground">{{ getDescription(entry.prop) }}</div>

            <select
              v-if="Array.isArray(entry.prop.enum) && entry.prop.enum.length > 0"
              :value="enumCurrentToken(entry.path, entry.prop)"
              class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              @change="onEnumInput(entry.path, $event)"
            >
              <option value="">(default)</option>
              <option
                v-for="(item, itemIdx) in entry.prop.enum"
                :key="`enum:${entry.path.join('.')}:${itemIdx}`"
                :value="enumToken(item)"
              >
                {{ String(item) }}
              </option>
            </select>

            <input
              v-else-if="entry.prop.type === 'string'"
              type="text"
              :value="stringValue(entry.path, entry.prop)"
              class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              @input="onStringInput(entry.path, $event)"
            />

            <input
              v-else-if="entry.prop.type === 'number' || entry.prop.type === 'integer'"
              type="number"
              :step="entry.prop.type === 'integer' ? '1' : 'any'"
              :min="typeof entry.prop.minimum === 'number' ? entry.prop.minimum : undefined"
              :value="numberValue(entry.path, entry.prop)"
              class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              @input="onNumberInput(entry.path, entry.prop, $event)"
            />

            <label v-else-if="entry.prop.type === 'boolean'" class="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                :checked="booleanValue(entry.path, entry.prop)"
                @change="onBooleanInput(entry.path, $event)"
              />
              <span class="text-muted-foreground">On</span>
            </label>

            <textarea
              v-else-if="entry.prop.type === 'array' && isArrayWithPrimitiveItems(entry.prop)"
              :value="arrayValue(entry.path, entry.prop)"
              class="min-h-[92px] rounded-md border border-input bg-transparent px-3 py-2 text-sm"
              @input="onArrayInput(entry.path, entry.prop, $event)"
            />

            <textarea
              v-else
              :value="jsonTextValue(entry.path, entry.prop)"
              class="min-h-[120px] rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
              spellcheck="false"
              @input="onJsonTextInput(entry.path, $event)"
              @blur="commitJsonText(entry.path, entry.prop)"
            />

            <div v-if="jsonError(entry.path)" class="text-xs text-destructive">{{ jsonError(entry.path) }}</div>
            <div v-else-if="entry.prop.type === 'object' || entry.prop.type === 'array'" class="text-xs text-muted-foreground">
              Edit as JSON.
            </div>
          </template>
        </div>
      </div>
    </template>
  </section>
</template>

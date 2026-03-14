<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import {
  RiCheckLine,
  RiClipboardLine,
  RiDeleteBinLine,
  RiFileUploadLine,
  RiRestartLine,
  RiSettings3Line,
  RiStackLine,
} from '@remixicon/vue'

import IconButton from '@/components/ui/IconButton.vue'
import Input from '@/components/ui/Input.vue'
import OptionPicker from '@/components/ui/OptionPicker.vue'
import type { PickerOption } from '@/components/ui/pickerOption.types'
import MonacoCodeEditor from '@/components/MonacoCodeEditor.vue'
import type { JsonValue } from '@/types/json'
import { i18n } from '@/i18n'

import CrudStringListEditor from '../CrudStringListEditor.vue'
import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

type AnyRecord = Record<string, unknown>
type LocalJsonBuffer = {
  text: string
  error: string | null
  get: () => JsonValue
  set: (value: JsonValue) => void
  fallback: JsonValue
}

function isPlainObject(value: unknown): value is AnyRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

export default defineComponent({
  components: {
    CrudStringListEditor,
    IconButton,
    Input,
    OptionPicker,
    MonacoCodeEditor,
    RiCheckLine,
    RiClipboardLine,
    RiDeleteBinLine,
    RiFileUploadLine,
    RiRestartLine,
    RiSettings3Line,
    RiStackLine,
  },
  setup() {
    const ctx = useOpencodeConfigPanelContext()

    const tt = (key: string, params?: Record<string, unknown>) => {
      const t = ctx.t
      if (typeof t === 'function') return t(key, params)
      return i18n.global.t(key, params as never)
    }

    const modelPickerOptions = computed<PickerOption[]>(() => {
      const list = Array.isArray(ctx.modelSlugOptions) ? ctx.modelSlugOptions : []
      return list.map((slug: string) => ({ value: slug, label: slug }))
    })

    const agentModePickerOptions = computed<PickerOption[]>(() => [
      { value: 'default', label: tt('settings.opencodeConfig.sections.agents.editor.modeOptions.default') },
      { value: 'primary', label: tt('settings.opencodeConfig.sections.agents.editor.modeOptions.primary') },
      { value: 'subagent', label: tt('settings.opencodeConfig.sections.agents.editor.modeOptions.subagent') },
      { value: 'all', label: tt('settings.opencodeConfig.sections.agents.editor.modeOptions.all') },
    ])

    const selectedAgentId = computed(() => String(ctx.effectiveSelectedAgentId || '').trim() || null)

    const agentMeta = computed(() => {
      const id = selectedAgentId.value
      if (!id) return null
      const list = Array.isArray(ctx.agentOptions) ? ctx.agentOptions : []
      return list.find((a: any) => String(a?.name || '').trim() === id) || null
    })

    const agentEntry = computed<AnyRecord>(() => {
      const id = selectedAgentId.value
      if (!id) return {}
      const rows = Array.isArray(ctx.selectedAgentRows) ? ctx.selectedAgentRows : []
      const hit = rows.find((r: any) => Array.isArray(r) && String(r[0] || '') === id)
      const raw = hit?.[1]
      return isPlainObject(raw) ? raw : {}
    })

    const isConfigured = computed(() => {
      const id = selectedAgentId.value
      if (!id) return false
      try {
        return typeof ctx.isAgentConfigured === 'function' ? Boolean(ctx.isAgentConfigured(id)) : false
      } catch {
        return false
      }
    })

    const stringListFields = computed(() => {
      const id = selectedAgentId.value
      if (!id) return [] as Array<{ key: string; label: string; kind: 'root' | 'options' }>

      const out: Array<{ key: string; label: string; kind: 'root' | 'options' }> = []
      const entry = agentEntry.value

      const blocked = new Set([
        'model',
        'variant',
        'temperature',
        'top_p',
        'prompt',
        'disable',
        'description',
        'mode',
        'hidden',
        'options',
        'color',
        'steps',
        'permission',
      ])

      for (const [k, v] of Object.entries(entry)) {
        if (blocked.has(k)) continue
        if (isStringArray(v)) {
          out.push({ key: k, label: k, kind: 'root' })
        }
      }

      const opt = entry.options
      if (isPlainObject(opt)) {
        for (const [k, v] of Object.entries(opt)) {
          if (isStringArray(v)) {
            out.push({ key: k, label: `options.${k}`, kind: 'options' })
          }
        }
      }

      return out.sort((a, b) => a.label.localeCompare(b.label))
    })

    function setAgentField(agentId: string, field: string, value: unknown) {
      try {
        ctx.setEntryField?.('agent', agentId, field, value)
      } catch {
        // ignore
      }
    }

    function setAgentOptionsField(agentId: string, key: string, value: JsonValue) {
      try {
        ctx.setOrClear?.(`agent.${agentId}.options.${key}`, value)
      } catch {
        // ignore
      }
    }

    function asString(value: unknown): string {
      return typeof value === 'string' ? value : ''
    }

    function agentStringListValue(fieldKey: string, kind: 'root' | 'options'): string[] {
      const entry = agentEntry.value
      if (kind === 'options') {
        const opt = isPlainObject(entry.options) ? entry.options : null
        const v = opt ? (opt as AnyRecord)[fieldKey] : undefined
        return isStringArray(v) ? v : []
      }
      const v = entry[fieldKey]
      return isStringArray(v) ? v : []
    }

    function updateAgentStringList(agentId: string, fieldKey: string, kind: 'root' | 'options', next: string[] | null) {
      const normalized = next ?? []
      if (kind === 'options') {
        setAgentOptionsField(agentId, fieldKey, normalized)
        return
      }
      setAgentField(agentId, fieldKey, normalized)
    }

    const showDebug = Boolean(import.meta.env.DEV)

    const localJsonBuffers = ref<Record<string, LocalJsonBuffer>>({})

    function stringifyJson(value: unknown, fallback: JsonValue): string {
      try {
        return JSON.stringify((value as JsonValue) ?? fallback, null, 2)
      } catch {
        return JSON.stringify(fallback, null, 2)
      }
    }

    function ensureLocalJsonBuffer(
      id: string,
      get: () => JsonValue,
      set: (value: JsonValue) => void,
      fallback: JsonValue,
    ): LocalJsonBuffer {
      const current = localJsonBuffers.value[id]
      if (!current) {
        const next: LocalJsonBuffer = {
          text: stringifyJson(get(), fallback),
          error: null,
          get,
          set,
          fallback,
        }
        localJsonBuffers.value = { ...localJsonBuffers.value, [id]: next }
        return next
      }
      current.get = get
      current.set = set
      current.fallback = fallback
      return current
    }

    function updateLocalJsonText(id: string, text: string) {
      const buf = localJsonBuffers.value[id]
      if (!buf) return
      buf.text = text
    }

    function applyLocalJsonBuffer(id: string): boolean {
      const buf = localJsonBuffers.value[id]
      if (!buf) return true
      const raw = buf.text.trim()
      if (!raw) {
        try {
          buf.set(null)
          buf.error = null
          return true
        } catch {
          buf.error = 'Failed to apply'
          return false
        }
      }
      try {
        const parsed = JSON.parse(raw)
        buf.set(parsed)
        buf.error = null
        return true
      } catch (err) {
        buf.error = err instanceof Error ? err.message : String(err)
        return false
      }
    }

    function resetLocalJsonBuffer(id: string) {
      const buf = localJsonBuffers.value[id]
      if (!buf) return
      buf.text = stringifyJson(buf.get(), buf.fallback)
      buf.error = null
    }

    watch(
      () => selectedAgentId.value,
      () => {
        localJsonBuffers.value = {}
      },
    )

    return Object.assign(ctx, {
      tt,
      showDebug,
      selectedAgentId,
      agentMeta,
      agentEntry,
      isConfigured,
      stringListFields,
      modelPickerOptions,
      agentModePickerOptions,
      agentStringListValue,
      updateAgentStringList,
      setAgentField,
      localJsonBuffers,
      ensureLocalJsonBuffer,
      updateLocalJsonText,
      applyLocalJsonBuffer,
      resetLocalJsonBuffer,
    })
  },
})
</script>

<template>
  <div class="rounded-md border border-border p-3 lg:p-4 space-y-4 min-h-[360px]">
    <div v-if="!selectedAgentId" class="space-y-2">
      <div class="text-sm text-muted-foreground">
        {{ tt('settings.opencodeConfig.sections.agents.editor.empty') }}
      </div>
      <div v-if="optionsLoading" class="text-xs text-muted-foreground">{{ tt('common.loading') }}</div>
      <div v-else-if="optionsError" class="text-xs text-amber-700 break-words">{{ String(optionsError) }}</div>
    </div>

    <div v-else class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0 space-y-1">
          <div class="font-mono text-sm break-all">@{{ selectedAgentId }}</div>
          <div v-if="agentMeta?.description" class="text-[11px] text-muted-foreground break-words">
            {{ agentMeta.description }}
          </div>
          <div v-else-if="!isConfigured" class="text-[11px] text-muted-foreground">
            {{ tt('settings.opencodeConfig.sections.common.none') }}
          </div>
        </div>
        <div class="flex items-center gap-2">
          <IconButton
            variant="ghost"
            class="h-8 w-8"
            :title="tt('settings.opencodeConfig.sections.agents.editor.actions.copyJson')"
            :aria-label="tt('settings.opencodeConfig.sections.agents.editor.actions.copyJson')"
            @click="copyEntryJson?.('agent', selectedAgentId)"
            :tooltip="tt('settings.opencodeConfig.sections.agents.editor.actions.copyJson')"
          >
            <RiClipboardLine class="h-4 w-4" />
          </IconButton>
          <IconButton
            variant="ghost"
            class="h-8 w-8"
            :title="tt('settings.opencodeConfig.sections.agents.editor.actions.importJson')"
            :aria-label="tt('settings.opencodeConfig.sections.agents.editor.actions.importJson')"
            @click="importEntryJson?.('agent', selectedAgentId)"
            :tooltip="tt('settings.opencodeConfig.sections.agents.editor.actions.importJson')"
          >
            <RiFileUploadLine class="h-4 w-4" />
          </IconButton>
          <IconButton
            variant="ghost-destructive"
            class="h-8 w-8"
            :disabled="!isConfigured"
            :title="tt('common.remove')"
            :aria-label="tt('settings.opencodeConfig.sections.agents.editor.actions.removeAgentAria')"
            :tooltip="tt('common.remove')"
            @click="() => (removeEntry?.('agent', selectedAgentId), selectAgent?.(null))"
          >
            <RiDeleteBinLine class="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-1 rounded-md border border-border/60 bg-muted/20 p-1">
        <button
          type="button"
          class="px-3 py-1.5 text-xs font-medium rounded-full transition-colors border"
          :class="
            agentEditorTab === 'basics'
              ? 'bg-muted/70 text-foreground border-border'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/40 border-transparent'
          "
          @click="agentEditorTab = 'basics'"
        >
          {{ tt('settings.opencodeConfig.sections.agents.editor.tabs.basics') }}
        </button>
        <button
          type="button"
          class="px-3 py-1.5 text-xs font-medium rounded-full transition-colors border"
          :class="
            agentEditorTab === 'prompt'
              ? 'bg-muted/70 text-foreground border-border'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/40 border-transparent'
          "
          @click="agentEditorTab = 'prompt'"
        >
          {{ tt('settings.opencodeConfig.sections.agents.editor.tabs.prompt') }}
        </button>
        <button
          type="button"
          class="px-3 py-1.5 text-xs font-medium rounded-full transition-colors border"
          :class="
            agentEditorTab === 'permissions'
              ? 'bg-muted/70 text-foreground border-border'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/40 border-transparent'
          "
          @click="agentEditorTab = 'permissions'"
        >
          {{ tt('settings.opencodeConfig.sections.agents.editor.tabs.permissions') }}
        </button>
        <button
          type="button"
          class="px-3 py-1.5 text-xs font-medium rounded-full transition-colors border"
          :class="
            agentEditorTab === 'json'
              ? 'bg-muted/70 text-foreground border-border'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/40 border-transparent'
          "
          @click="agentEditorTab = 'json'"
        >
          {{ tt('settings.opencodeConfig.sections.agents.editor.tabs.json') }}
        </button>
      </div>

      <div v-if="agentEditorTab === 'basics'" class="space-y-4">
        <div v-if="!isConfigured" class="text-xs text-muted-foreground">
          {{ tt('settings.opencodeConfig.sections.common.none') }} ·
          {{ tt('settings.opencodeConfig.sections.agents.title') }}
        </div>

        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{
              tt('settings.opencodeConfig.sections.agents.editor.fields.model')
            }}</span>
            <OptionPicker
              :model-value="asString(agentEntry.model)"
              @update:model-value="(v) => setEntryField?.('agent', selectedAgentId, 'model', String(v || '').trim())"
              :options="modelPickerOptions"
              :title="tt('settings.opencodeConfig.sections.agents.editor.fields.model')"
              :search-placeholder="tt('settings.opencodeConfig.sections.agents.editor.search.searchModels')"
              :empty-label="tt('settings.opencodeConfig.sections.agents.editor.defaults.modelInherit')"
              :icon="RiStackLine"
              allow-custom
              monospace
            />
          </label>

          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{
              tt('settings.opencodeConfig.sections.agents.editor.fields.variant')
            }}</span>
            <Input
              :model-value="asString(agentEntry.variant)"
              @update:model-value="(v) => setEntryField?.('agent', selectedAgentId, 'variant', String(v || '').trim())"
              :placeholder="tt('settings.opencodeConfig.sections.agents.editor.placeholders.variant')"
            />
          </label>

          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{
              tt('settings.opencodeConfig.sections.agents.editor.fields.temperature')
            }}</span>
            <input
              :value="agentEntry.temperature ?? ''"
              @input="
                (e) =>
                  setEntryField?.(
                    'agent',
                    selectedAgentId,
                    'temperature',
                    parseNumberInput?.((e.target as HTMLInputElement).value),
                  )
              "
              type="number"
              step="0.01"
              class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            />
          </label>

          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{
              tt('settings.opencodeConfig.sections.agents.editor.fields.topP')
            }}</span>
            <input
              :value="agentEntry.top_p ?? ''"
              @input="
                (e) =>
                  setEntryField?.(
                    'agent',
                    selectedAgentId,
                    'top_p',
                    parseNumberInput?.((e.target as HTMLInputElement).value),
                  )
              "
              type="number"
              step="0.01"
              class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            />
          </label>

          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{
              tt('settings.opencodeConfig.sections.agents.editor.fields.description')
            }}</span>
            <Input
              :model-value="asString(agentEntry.description)"
              @update:model-value="
                (v) => setEntryField?.('agent', selectedAgentId, 'description', String(v || '').trim())
              "
            />
          </label>

          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{
              tt('settings.opencodeConfig.sections.agents.editor.fields.mode')
            }}</span>
            <OptionPicker
              :model-value="asString(agentEntry.mode) || 'default'"
              @update:model-value="
                (v) =>
                  setEntryField?.(
                    'agent',
                    selectedAgentId,
                    'mode',
                    String(v || '') === 'default' ? null : String(v || ''),
                  )
              "
              :options="agentModePickerOptions"
              :title="tt('settings.opencodeConfig.sections.agents.editor.fields.mode')"
              :search-placeholder="tt('settings.opencodeConfig.sections.agents.editor.search.searchModes')"
              :include-empty="false"
            />
          </label>

          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{
              tt('settings.opencodeConfig.sections.agents.editor.fields.color')
            }}</span>
            <Input
              :model-value="asString(agentEntry.color)"
              @update:model-value="(v) => setEntryField?.('agent', selectedAgentId, 'color', String(v || '').trim())"
              :placeholder="tt('settings.opencodeConfig.sections.agents.editor.placeholders.color')"
            />
          </label>

          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{
              tt('settings.opencodeConfig.sections.agents.editor.fields.steps')
            }}</span>
            <input
              :value="agentEntry.steps ?? ''"
              @input="
                (e) =>
                  setEntryField?.(
                    'agent',
                    selectedAgentId,
                    'steps',
                    parseNumberInput?.((e.target as HTMLInputElement).value),
                  )
              "
              type="number"
              min="1"
              class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            />
          </label>
        </div>

        <div class="flex flex-wrap gap-4">
          <label class="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              :checked="agentEntry.disable === true"
              @change="
                (e) => setEntryField?.('agent', selectedAgentId, 'disable', (e.target as HTMLInputElement).checked)
              "
            />
            {{ tt('settings.opencodeConfig.sections.agents.editor.toggles.disabled') }}
          </label>
          <label class="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              :checked="agentEntry.hidden === true"
              @change="
                (e) => setEntryField?.('agent', selectedAgentId, 'hidden', (e.target as HTMLInputElement).checked)
              "
            />
            {{ tt('settings.opencodeConfig.sections.agents.editor.toggles.hidden') }}
          </label>
        </div>

        <div v-if="stringListFields.length" class="rounded-md border border-border/60 bg-muted/10 p-3 space-y-3">
          <div class="flex items-center justify-between">
            <div class="text-sm font-semibold inline-flex items-center gap-2">
              <RiSettings3Line class="h-4 w-4" />
              <span>String lists</span>
            </div>
            <div class="text-[11px] text-muted-foreground">{{ stringListFields.length }}</div>
          </div>
          <div class="grid gap-4">
            <div v-for="f in stringListFields" :key="`sl:${f.kind}:${f.key}`" class="grid gap-2">
              <div class="text-xs text-muted-foreground font-mono break-all">{{ f.label }}</div>
              <CrudStringListEditor
                :model-value="agentStringListValue(f.key, f.kind)"
                @update:model-value="(v) => updateAgentStringList(selectedAgentId, f.key, f.kind, v)"
                :empty-text="tt('settings.opencodeConfig.sections.common.none')"
                show-filter
              />
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="agentEditorTab === 'prompt'" class="space-y-2">
        <div class="text-xs text-muted-foreground">
          {{ tt('settings.opencodeConfig.sections.agents.editor.tabs.prompt') }}
        </div>
        <div class="h-72 rounded-md border border-input overflow-hidden">
          <MonacoCodeEditor
            :model-value="String(agentEntry.prompt || '')"
            @update:model-value="(v) => setEntryField?.('agent', selectedAgentId, 'prompt', v)"
            :path="`agent/${selectedAgentId}.md`"
            :use-files-theme="true"
            :wrap="true"
          />
        </div>
      </div>

      <div v-else-if="agentEditorTab === 'permissions'" class="space-y-2">
        <div class="text-xs text-muted-foreground">
          {{ tt('settings.opencodeConfig.sections.agents.editor.tabs.permissions') }}
        </div>
        <div class="text-[11px] text-muted-foreground">
          Permission overrides are edited as JSON to avoid relying on internal rule structure.
        </div>
        <textarea
          :value="
            ensureLocalJsonBuffer(
              `agent:${selectedAgentId}:permission`,
              () => agentEntry.permission as JsonValue,
              (val: JsonValue) => setEntryField?.('agent', selectedAgentId, 'permission', val),
              {},
            ).text
          "
          @input="
            (e) => updateLocalJsonText(`agent:${selectedAgentId}:permission`, (e.target as HTMLTextAreaElement).value)
          "
          rows="8"
          class="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
        />
        <div class="flex items-center gap-2">
          <IconButton
            variant="outline"
            class="h-8 w-8"
            :title="tt('common.apply')"
            :aria-label="tt('settings.opencodeConfig.sections.common.applyJson')"
            @click="applyLocalJsonBuffer(`agent:${selectedAgentId}:permission`)"
            :tooltip="tt('common.apply')"
          >
            <RiCheckLine class="h-4 w-4" />
          </IconButton>
          <IconButton
            variant="ghost"
            class="h-8 w-8"
            :title="tt('common.reset')"
            :aria-label="tt('common.reset')"
            @click="resetLocalJsonBuffer(`agent:${selectedAgentId}:permission`)"
            :tooltip="tt('common.reset')"
          >
            <RiRestartLine class="h-4 w-4" />
          </IconButton>
          <span
            v-if="localJsonBuffers[`agent:${selectedAgentId}:permission`]?.error"
            class="text-xs text-destructive"
            >{{ localJsonBuffers[`agent:${selectedAgentId}:permission`]?.error }}</span
          >
        </div>
      </div>

      <div v-else-if="agentEditorTab === 'json'" class="space-y-4">
        <div class="grid gap-2">
          <span class="text-xs text-muted-foreground">Agent JSON</span>
          <textarea
            :value="
              ensureLocalJsonBuffer(
                `agent:${selectedAgentId}:full`,
                () => agentEntry as unknown as JsonValue,
                (val: JsonValue) => setOrClear?.(`agent.${selectedAgentId}`, val),
                {},
              ).text
            "
            @input="
              (e) => updateLocalJsonText(`agent:${selectedAgentId}:full`, (e.target as HTMLTextAreaElement).value)
            "
            rows="10"
            class="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
          />
          <div class="flex items-center gap-2">
            <IconButton
              variant="outline"
              class="h-8 w-8"
              :title="tt('common.apply')"
              :aria-label="tt('settings.opencodeConfig.sections.common.applyJson')"
              @click="applyLocalJsonBuffer(`agent:${selectedAgentId}:full`)"
              :tooltip="tt('common.apply')"
            >
              <RiCheckLine class="h-4 w-4" />
            </IconButton>
            <IconButton
              variant="ghost"
              class="h-8 w-8"
              :title="tt('common.reset')"
              :aria-label="tt('common.reset')"
              @click="resetLocalJsonBuffer(`agent:${selectedAgentId}:full`)"
              :tooltip="tt('common.reset')"
            >
              <RiRestartLine class="h-4 w-4" />
            </IconButton>
            <span v-if="localJsonBuffers[`agent:${selectedAgentId}:full`]?.error" class="text-xs text-destructive">{{
              localJsonBuffers[`agent:${selectedAgentId}:full`]?.error
            }}</span>
          </div>
        </div>

        <div class="grid gap-2">
          <span class="text-xs text-muted-foreground">Options JSON</span>
          <textarea
            :value="
              ensureLocalJsonBuffer(
                `agent:${selectedAgentId}:options`,
                () => agentEntry.options as JsonValue,
                (val: JsonValue) => setEntryField?.('agent', selectedAgentId, 'options', val),
                {},
              ).text
            "
            @input="
              (e) => updateLocalJsonText(`agent:${selectedAgentId}:options`, (e.target as HTMLTextAreaElement).value)
            "
            rows="6"
            class="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
          />
          <div class="flex items-center gap-2">
            <IconButton
              variant="outline"
              class="h-8 w-8"
              :title="tt('common.apply')"
              :aria-label="tt('settings.opencodeConfig.sections.common.applyJson')"
              @click="applyLocalJsonBuffer(`agent:${selectedAgentId}:options`)"
              :tooltip="tt('common.apply')"
            >
              <RiCheckLine class="h-4 w-4" />
            </IconButton>
            <IconButton
              variant="ghost"
              class="h-8 w-8"
              :title="tt('common.reset')"
              :aria-label="tt('common.reset')"
              @click="resetLocalJsonBuffer(`agent:${selectedAgentId}:options`)"
              :tooltip="tt('common.reset')"
            >
              <RiRestartLine class="h-4 w-4" />
            </IconButton>
            <span v-if="localJsonBuffers[`agent:${selectedAgentId}:options`]?.error" class="text-xs text-destructive">{{
              localJsonBuffers[`agent:${selectedAgentId}:options`]?.error
            }}</span>
          </div>
        </div>

        <div v-if="showDebug" class="rounded-md border border-border/60 bg-muted/10 p-3 space-y-2">
          <div class="text-xs text-muted-foreground">Debug (dev only)</div>
          <pre class="text-[11px] overflow-auto whitespace-pre-wrap break-words">{{
            JSON.stringify(agentEntry, null, 2)
          }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

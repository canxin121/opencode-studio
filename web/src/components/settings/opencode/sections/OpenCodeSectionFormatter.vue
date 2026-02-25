<script lang="ts">
import { computed, defineComponent, onMounted, ref } from 'vue'
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiCheckLine,
  RiDeleteBinLine,
  RiLoader4Line,
  RiRefreshLine,
  RiRestartLine,
} from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import OptionPicker from '@/components/ui/OptionPicker.vue'
import type { PickerOption } from '@/components/ui/pickerOption.types'
import Tooltip from '@/components/ui/Tooltip.vue'
import VirtualList from '@/components/ui/VirtualList.vue'
import CodeMirrorEditor from '@/components/CodeMirrorEditor.vue'
import StringListEditor from '../StringListEditor.vue'
import { apiJson } from '@/lib/api'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

type LspRuntimeListResponse =
  | unknown[]
  | {
      items?: unknown[]
      servers?: unknown[]
      list?: unknown[]
    }

type LspRuntimeItem = {
  id: string
  name: string
  status: string
  rootDir: string
  transport: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function pickStatus(obj: Record<string, unknown>): string {
  const explicit = pickString(obj, ['status', 'state'])
  if (explicit) return explicit
  if (obj.connected === true) return 'connected'
  if (obj.connected === false) return 'disconnected'
  return 'unknown'
}

function normalizeLspRuntimeList(payload: LspRuntimeListResponse): LspRuntimeItem[] {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.servers)
        ? payload.servers
        : Array.isArray(payload?.list)
          ? payload.list
          : []

  return list
    .map((raw) => {
      const rec = asRecord(raw)
      if (!rec) return null
      const id = pickString(rec, ['id', 'lspId', 'serverId', 'name', 'label'])
      const name = pickString(rec, ['name', 'label', 'server', 'serverName']) || id
      if (!id && !name) return null
      return {
        id: id || name,
        name,
        status: pickStatus(rec),
        rootDir: pickString(rec, ['rootDir', 'root', 'workspaceRoot', 'workspace', 'directory']),
        transport: pickString(rec, ['transport', 'connection', 'mode']),
      }
    })
    .filter((item): item is LspRuntimeItem => Boolean(item))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function runtimeStatusTone(status: string): 'ok' | 'warn' | 'idle' {
  const value = String(status || '')
    .trim()
    .toLowerCase()
  if (value === 'connected' || value === 'running' || value === 'ready') return 'ok'
  if (value === 'error' || value === 'failed' || value === 'disconnected' || value === 'stopped') return 'warn'
  return 'idle'
}

export default defineComponent({
  components: {
    Button,
    Input,
    OptionPicker,
    Tooltip,
    VirtualList,
    CodeMirrorEditor,
    StringListEditor,
    RiAddLine,
    RiArrowDownSLine,
    RiArrowUpSLine,
    RiCheckLine,
    RiDeleteBinLine,
    RiLoader4Line,
    RiRefreshLine,
    RiRestartLine,
  },
  setup() {
    const ctx = useOpencodeConfigPanelContext()
    const t = ctx.t as unknown as (key: string, params?: Record<string, unknown>) => string
    const formatterCommandSuggestions = ['prettier', 'eslint', 'biome', 'ruff', 'black', 'shfmt', 'clang-format']
    const lspCommandSuggestions = [
      'typescript-language-server',
      'pyright-langserver',
      'rust-analyzer',
      'gopls',
      'jdtls',
    ]
    const extensionSuggestions = [
      '.js',
      '.ts',
      '.jsx',
      '.tsx',
      '.json',
      '.md',
      '.py',
      '.rs',
      '.go',
      '.java',
      '.kt',
      '.sh',
      '.yaml',
      '.yml',
    ]

    const lspModePickerOptions = computed<PickerOption[]>(() => [
      { value: 'config', label: t('settings.opencodeConfig.sections.formatter.lsp.options.mode.config') },
      { value: 'disabled', label: t('settings.opencodeConfig.sections.formatter.lsp.options.mode.disabled') },
    ])

    const lspRuntimeLoading = ref(false)
    const lspRuntimeError = ref('')
    const lspRuntimeItems = ref<LspRuntimeItem[]>([])

    async function refreshLspRuntimeStatus() {
      lspRuntimeLoading.value = true
      lspRuntimeError.value = ''
      try {
        const payload = await apiJson<LspRuntimeListResponse>('/api/lsp')
        lspRuntimeItems.value = normalizeLspRuntimeList(payload)
      } catch (err) {
        lspRuntimeError.value = err instanceof Error ? err.message : String(err)
        lspRuntimeItems.value = []
      } finally {
        lspRuntimeLoading.value = false
      }
    }

    onMounted(() => {
      void refreshLspRuntimeStatus()
    })

    return Object.assign(ctx, {
      formatterCommandSuggestions,
      lspCommandSuggestions,
      extensionSuggestions,
      lspModePickerOptions,
      lspRuntimeLoading,
      lspRuntimeError,
      lspRuntimeItems,
      refreshLspRuntimeStatus,
      runtimeStatusTone,
    })
  },
})
</script>

<template>
  <section id="formatter" class="scroll-mt-24 rounded-lg border border-border bg-background p-4 space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-base font-semibold leading-snug">
          {{ t('settings.opencodeConfig.sections.formatter.title') }}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <Tooltip>
          <Button
            size="icon"
            variant="ghost"
            class="h-8 w-8"
            :title="t('settings.opencodeConfig.sections.common.resetSection')"
            @click="resetSection('formatter')"
          >
            <RiRestartLine class="h-4 w-4" />
          </Button>
          <template #content>{{ t('settings.opencodeConfig.sections.common.resetSection') }}</template>
        </Tooltip>
        <Tooltip>
          <Button
            size="icon"
            variant="outline"
            class="h-8 w-8"
            :title="
              isSectionOpen('formatter')
                ? t('settings.opencodeConfig.sections.common.collapse')
                : t('settings.opencodeConfig.sections.common.expand')
            "
            @click="toggleSection('formatter')"
          >
            <RiArrowUpSLine v-if="isSectionOpen('formatter')" class="h-4 w-4" />
            <RiArrowDownSLine v-else class="h-4 w-4" />
          </Button>
          <template #content>{{
            isSectionOpen('formatter')
              ? t('settings.opencodeConfig.sections.common.collapse')
              : t('settings.opencodeConfig.sections.common.expand')
          }}</template>
        </Tooltip>
      </div>
    </div>

    <div v-if="isSectionOpen('formatter')" class="space-y-4">
      <div class="grid gap-3">
        <label class="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" v-model="formatterDisabled" />
          {{ t('settings.opencodeConfig.sections.formatter.formatters.disableAll') }}
        </label>
        <div class="flex flex-wrap items-center gap-2" v-if="!formatterDisabled">
          <Input
            v-model="newFormatterId"
            :placeholder="t('settings.opencodeConfig.sections.formatter.formatters.placeholders.formatterId')"
            class="max-w-xs"
          />
          <Tooltip>
            <Button
              size="icon"
              variant="outline"
              class="h-9 w-9"
              :title="t('settings.opencodeConfig.sections.formatter.formatters.actions.add')"
              :aria-label="t('settings.opencodeConfig.sections.formatter.formatters.actions.addAria')"
              @click="addFormatter"
            >
              <RiAddLine class="h-4 w-4" />
            </Button>
            <template #content>{{ t('settings.opencodeConfig.sections.formatter.formatters.actions.add') }}</template>
          </Tooltip>
        </div>
        <div v-if="!formatterDisabled && formatterList.length === 0" class="text-xs text-muted-foreground">
          {{ t('settings.opencodeConfig.sections.formatter.formatters.empty') }}
        </div>
        <div
          v-if="!formatterDisabled"
          v-for="[fmtId, fmt] in formatterList"
          :key="fmtId"
          class="rounded-md border border-border p-3 space-y-3"
        >
          <div class="flex items-center justify-between">
            <div class="font-mono text-sm break-all">{{ fmtId }}</div>
            <Tooltip>
              <Button
                size="icon"
                variant="ghost-destructive"
                class="h-8 w-8"
                :title="t('common.remove')"
                :aria-label="t('settings.opencodeConfig.sections.formatter.formatters.actions.removeAria')"
                @click="removeEntry('formatter', fmtId)"
              >
                <RiDeleteBinLine class="h-4 w-4" />
              </Button>
              <template #content>{{ t('common.remove') }}</template>
            </Tooltip>
          </div>
          <label class="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              :checked="fmt.disabled === true"
              @change="(e) => setEntryField('formatter', fmtId, 'disabled', (e.target as HTMLInputElement).checked)"
            />
            {{ t('settings.opencodeConfig.sections.common.disabled') }}
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{
              t('settings.opencodeConfig.sections.formatter.fields.command')
            }}</span>
            <StringListEditor
              :model-value="fmt.command || []"
              :suggestions="formatterCommandSuggestions"
              :panel-title="t('settings.opencodeConfig.sections.formatter.formatters.command.panelTitle')"
              :placeholder="t('settings.opencodeConfig.sections.formatter.formatters.command.placeholder')"
              split-mode="lines"
              :advanced-rows="3"
              :advanced-placeholder="
                t('settings.opencodeConfig.sections.formatter.formatters.command.advancedPlaceholder')
              "
              @update:model-value="(v) => setEntryField('formatter', fmtId, 'command', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{
              t('settings.opencodeConfig.sections.formatter.fields.extensions')
            }}</span>
            <StringListEditor
              :model-value="fmt.extensions || []"
              :suggestions="extensionSuggestions"
              :panel-title="t('settings.opencodeConfig.sections.formatter.fields.extensions')"
              :placeholder="t('settings.opencodeConfig.sections.formatter.formatters.extensions.placeholder')"
              split-mode="tags"
              :advanced-rows="3"
              :advanced-placeholder="
                t('settings.opencodeConfig.sections.formatter.formatters.extensions.advancedPlaceholder')
              "
              @update:model-value="(v) => setEntryField('formatter', fmtId, 'extensions', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{
              t('settings.opencodeConfig.sections.formatter.fields.environmentJson')
            }}</span>
            <textarea
              v-model="
                ensureJsonBuffer(
                  `formatter:${fmtId}:env`,
                  () => fmt.environment,
                  (val) => setEntryField('formatter', fmtId, 'environment', val),
                  {},
                ).text
              "
              rows="4"
              class="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
            />
            <div class="flex items-center gap-2">
              <Tooltip>
                <Button
                  size="icon"
                  variant="outline"
                  class="h-8 w-8"
                  :title="t('common.apply')"
                  :aria-label="t('settings.opencodeConfig.sections.common.applyJson')"
                  @click="applyJsonBuffer(`formatter:${fmtId}:env`)"
                >
                  <RiCheckLine class="h-4 w-4" />
                </Button>
                <template #content>{{ t('common.apply') }}</template>
              </Tooltip>
              <span
                v-if="
                  ensureJsonBuffer(
                    `formatter:${fmtId}:env`,
                    () => fmt.environment,
                    (val) => setEntryField('formatter', fmtId, 'environment', val),
                    {},
                  ).error
                "
                class="text-xs text-destructive"
              >
                {{
                  ensureJsonBuffer(
                    `formatter:${fmtId}:env`,
                    () => fmt.environment,
                    (val) => setEntryField('formatter', fmtId, 'environment', val),
                    {},
                  ).error
                }}
              </span>
            </div>
          </label>
        </div>
      </div>

      <div class="grid gap-3">
        <label class="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" v-model="lspDisabled" />
          {{ t('settings.opencodeConfig.sections.formatter.lsp.disableAll') }}
        </label>
        <div class="flex flex-wrap items-center gap-2" v-if="!lspDisabled">
          <Input
            v-model="newLspId"
            :placeholder="t('settings.opencodeConfig.sections.formatter.lsp.placeholders.lspId')"
            class="max-w-xs"
          />
          <Tooltip>
            <Button
              size="icon"
              variant="outline"
              class="h-9 w-9"
              :title="t('settings.opencodeConfig.sections.formatter.lsp.actions.add')"
              :aria-label="t('settings.opencodeConfig.sections.formatter.lsp.actions.addAria')"
              @click="addLsp"
            >
              <RiAddLine class="h-4 w-4" />
            </Button>
            <template #content>{{ t('settings.opencodeConfig.sections.formatter.lsp.actions.add') }}</template>
          </Tooltip>
        </div>
        <div v-if="!lspDisabled && lspList.length === 0" class="text-xs text-muted-foreground">
          {{ t('settings.opencodeConfig.sections.formatter.lsp.empty') }}
        </div>
        <div
          v-if="!lspDisabled"
          v-for="[lspId, lsp] in lspList"
          :key="lspId"
          class="rounded-md border border-border p-3 space-y-3"
        >
          <div class="flex items-center justify-between">
            <div class="font-mono text-sm break-all">{{ lspId }}</div>
            <Tooltip>
              <Button
                size="icon"
                variant="ghost-destructive"
                class="h-8 w-8"
                :title="t('common.remove')"
                :aria-label="t('settings.opencodeConfig.sections.formatter.lsp.actions.removeAria')"
                @click="removeEntry('lsp', lspId)"
              >
                <RiDeleteBinLine class="h-4 w-4" />
              </Button>
              <template #content>{{ t('common.remove') }}</template>
            </Tooltip>
          </div>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{
              t('settings.opencodeConfig.sections.formatter.lsp.fields.mode')
            }}</span>
            <OptionPicker
              :model-value="lspMode(lsp)"
              @update:model-value="(v) => setLspMode(lspId, String(v || ''))"
              :options="lspModePickerOptions"
              :title="t('settings.opencodeConfig.sections.formatter.lsp.fields.mode')"
              :search-placeholder="t('settings.opencodeConfig.sections.formatter.lsp.search.searchModes')"
              :include-empty="false"
            />
          </label>
          <div v-if="lspMode(lsp) === 'config'" class="grid gap-3">
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">{{
                t('settings.opencodeConfig.sections.formatter.fields.command')
              }}</span>
              <StringListEditor
                :model-value="lsp.command || []"
                :suggestions="lspCommandSuggestions"
                :panel-title="t('settings.opencodeConfig.sections.formatter.lsp.command.panelTitle')"
                :placeholder="t('settings.opencodeConfig.sections.formatter.lsp.command.placeholder')"
                split-mode="lines"
                :advanced-rows="3"
                :advanced-placeholder="t('settings.opencodeConfig.sections.formatter.lsp.command.advancedPlaceholder')"
                @update:model-value="(v) => setEntryField('lsp', lspId, 'command', v)"
              />
            </label>
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">{{
                t('settings.opencodeConfig.sections.formatter.fields.extensions')
              }}</span>
              <StringListEditor
                :model-value="lsp.extensions || []"
                :suggestions="extensionSuggestions"
                :panel-title="t('settings.opencodeConfig.sections.formatter.fields.extensions')"
                :placeholder="t('settings.opencodeConfig.sections.formatter.formatters.extensions.placeholder')"
                split-mode="tags"
                :advanced-rows="3"
                :advanced-placeholder="
                  t('settings.opencodeConfig.sections.formatter.formatters.extensions.advancedPlaceholder')
                "
                @update:model-value="(v) => setEntryField('lsp', lspId, 'extensions', v)"
              />
            </label>
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">{{
                t('settings.opencodeConfig.sections.formatter.fields.environmentJson')
              }}</span>
              <textarea
                v-model="
                  ensureJsonBuffer(
                    `lsp:${lspId}:env`,
                    () => lsp.env,
                    (val) => setEntryField('lsp', lspId, 'env', val),
                    {},
                  ).text
                "
                rows="4"
                class="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
              />
              <div class="flex items-center gap-2">
                <Tooltip>
                  <Button
                    size="icon"
                    variant="outline"
                    class="h-8 w-8"
                    :title="t('common.apply')"
                    :aria-label="t('settings.opencodeConfig.sections.common.applyJson')"
                    @click="applyJsonBuffer(`lsp:${lspId}:env`)"
                  >
                    <RiCheckLine class="h-4 w-4" />
                  </Button>
                  <template #content>{{ t('common.apply') }}</template>
                </Tooltip>
                <span
                  v-if="
                    ensureJsonBuffer(
                      `lsp:${lspId}:env`,
                      () => lsp.env,
                      (val) => setEntryField('lsp', lspId, 'env', val),
                      {},
                    ).error
                  "
                  class="text-xs text-destructive"
                >
                  {{
                    ensureJsonBuffer(
                      `lsp:${lspId}:env`,
                      () => lsp.env,
                      (val) => setEntryField('lsp', lspId, 'env', val),
                      {},
                    ).error
                  }}
                </span>
              </div>
            </label>
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">{{
                t('settings.opencodeConfig.sections.formatter.lsp.fields.initializationJson')
              }}</span>
              <textarea
                v-model="
                  ensureJsonBuffer(
                    `lsp:${lspId}:init`,
                    () => lsp.initialization,
                    (val) => setEntryField('lsp', lspId, 'initialization', val),
                    {},
                  ).text
                "
                rows="4"
                class="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
              />
              <div class="flex items-center gap-2">
                <Tooltip>
                  <Button
                    size="icon"
                    variant="outline"
                    class="h-8 w-8"
                    :title="t('common.apply')"
                    :aria-label="t('settings.opencodeConfig.sections.common.applyJson')"
                    @click="applyJsonBuffer(`lsp:${lspId}:init`)"
                  >
                    <RiCheckLine class="h-4 w-4" />
                  </Button>
                  <template #content>{{ t('common.apply') }}</template>
                </Tooltip>
                <span
                  v-if="
                    ensureJsonBuffer(
                      `lsp:${lspId}:init`,
                      () => lsp.initialization,
                      (val) => setEntryField('lsp', lspId, 'initialization', val),
                      {},
                    ).error
                  "
                  class="text-xs text-destructive"
                >
                  {{
                    ensureJsonBuffer(
                      `lsp:${lspId}:init`,
                      () => lsp.initialization,
                      (val) => setEntryField('lsp', lspId, 'initialization', val),
                      {},
                    ).error
                  }}
                </span>
              </div>
            </label>
          </div>
          <label class="inline-flex items-center gap-2 text-sm" v-if="lspMode(lsp) === 'config'">
            <input
              type="checkbox"
              :checked="lsp.disabled === true"
              @change="(e) => setEntryField('lsp', lspId, 'disabled', (e.target as HTMLInputElement).checked)"
            />
            {{ t('settings.opencodeConfig.sections.common.disabled') }}
          </label>
        </div>
      </div>

      <div class="grid gap-3 rounded-md border border-border/70 p-3">
        <div class="flex items-center justify-between gap-2">
          <div>
            <div class="text-sm font-medium">
              {{ t('settings.opencodeConfig.sections.formatter.lsp.runtime.title') }}
            </div>
            <div class="text-xs text-muted-foreground">
              {{ t('settings.opencodeConfig.sections.formatter.lsp.runtime.description') }}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            class="gap-1"
            :disabled="lspRuntimeLoading"
            @click="refreshLspRuntimeStatus"
          >
            <RiLoader4Line v-if="lspRuntimeLoading" class="h-3.5 w-3.5 animate-spin" />
            <RiRefreshLine v-else class="h-3.5 w-3.5" />
            <span>{{ t('common.refresh') }}</span>
          </Button>
        </div>

        <div v-if="lspRuntimeLoading" class="text-xs text-muted-foreground">
          {{ t('common.loading') }}
        </div>
        <div
          v-else-if="lspRuntimeError"
          class="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
        >
          {{ lspRuntimeError }}
        </div>
        <div v-else-if="lspRuntimeItems.length === 0" class="text-xs text-muted-foreground">
          {{ t('settings.opencodeConfig.sections.formatter.lsp.runtime.empty') }}
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="runtime in lspRuntimeItems"
            :key="runtime.id"
            class="rounded-md border border-border/70 bg-muted/10 p-2.5 text-xs"
          >
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="font-mono text-foreground break-all">{{ runtime.name }}</span>
              <span
                class="inline-flex rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                :class="
                  runtimeStatusTone(runtime.status) === 'ok'
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : runtimeStatusTone(runtime.status) === 'warn'
                      ? 'bg-red-500/15 text-red-700 dark:text-red-300'
                      : 'bg-muted text-muted-foreground'
                "
              >
                {{ runtime.status || t('common.unknown') }}
              </span>
            </div>

            <div class="mt-1 grid gap-1 text-muted-foreground">
              <div v-if="runtime.rootDir" class="break-all">
                {{ t('settings.opencodeConfig.sections.formatter.lsp.runtime.fields.root') }}: {{ runtime.rootDir }}
              </div>
              <div v-if="runtime.transport">
                {{ t('settings.opencodeConfig.sections.formatter.lsp.runtime.fields.transport') }}:
                {{ runtime.transport }}
              </div>
              <div>{{ t('settings.opencodeConfig.sections.formatter.lsp.runtime.fields.id') }}: {{ runtime.id }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

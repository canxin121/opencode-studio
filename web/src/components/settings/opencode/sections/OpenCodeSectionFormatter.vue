<script lang="ts">
import { computed, defineComponent } from 'vue'
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiCheckLine,
  RiDeleteBinLine,
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

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

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

    return Object.assign(ctx, {
      formatterCommandSuggestions,
      lspCommandSuggestions,
      extensionSuggestions,
      lspModePickerOptions,
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
    </div>
  </section>
</template>

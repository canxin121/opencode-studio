<script lang="ts">
import { computed, defineComponent } from 'vue'
import {
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiCloseLine,
  RiRefreshLine,
  RiRestartLine,
  RiSparkling2Line,
  RiStackLine,
  RiUserLine,
} from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import OptionPicker, { type PickerOption } from '@/components/ui/OptionPicker.vue'
import Tooltip from '@/components/ui/Tooltip.vue'
import VirtualList from '@/components/ui/VirtualList.vue'
import CodeMirrorEditor from '@/components/CodeMirrorEditor.vue'
import type { JsonValue } from '@/types/json'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

export default defineComponent({
  components: {
    Button,
    Input,
    OptionPicker,
    Tooltip,
    VirtualList,
    CodeMirrorEditor,
    RiArrowDownSLine,
    RiArrowUpSLine,
    RiCloseLine,
    RiRefreshLine,
    RiRestartLine,
    RiSparkling2Line,
    RiStackLine,
    RiUserLine,
  },
  setup() {
    const ctx = useOpencodeConfigPanelContext()

    const t = ctx.t as unknown as (key: string, params?: Record<string, unknown>) => string

    function normalizeAgentName(raw: string): string {
      let v = String(raw || '').trim()
      if (v.startsWith('@')) v = v.slice(1).trim()
      return v
    }

    const defaultAgentPickerOptions = computed<PickerOption[]>(() => {
      const list = Array.isArray(ctx.agentOptions) ? ctx.agentOptions : []
      return list
        .map((a) => {
          const agent = a && typeof a === 'object' ? (a as Record<string, JsonValue>) : null
          const name = String(agent?.name || '').trim()
          if (!name) return null
          if (ctx.isValidDefaultAgent && !ctx.isValidDefaultAgent(agent)) return null
          const mode = typeof agent?.mode === 'string' ? agent.mode : ''
          const hidden = agent?.hidden === true
          const label = `${name}${
            mode === 'subagent' ? t('settings.opencodeConfig.sections.general.defaultAgent.options.subagentSuffix') : ''
          }${hidden ? t('settings.opencodeConfig.sections.general.defaultAgent.options.hiddenSuffix') : ''}`
          return {
            value: name,
            label,
            description: typeof agent?.description === 'string' ? agent.description : undefined,
          } satisfies PickerOption
        })
        .filter(Boolean) as PickerOption[]
    })

    const modelPickerOptions = computed<PickerOption[]>(() => {
      const list = Array.isArray(ctx.modelSlugOptions) ? ctx.modelSlugOptions : []
      return list.map((slug: string) => ({ value: slug, label: slug }))
    })

    const modelProviderFilterPickerOptions = computed<PickerOption[]>(() => {
      const list = Array.isArray(ctx.modelProviderOptions) ? ctx.modelProviderOptions : []
      return list.map((pid: string) => ({ value: pid, label: pid }))
    })

    const modelFamilyFilterPickerOptions = computed<PickerOption[]>(() => {
      const list = Array.isArray(ctx.modelFamilyOptions) ? ctx.modelFamilyOptions : []
      return list.map((f: string) => ({ value: f, label: f }))
    })

    const modelStatusFilterPickerOptions = computed<PickerOption[]>(() => [
      { value: 'active', label: t('settings.opencodeConfig.sections.general.options.modelStatusFilter.active') },
      { value: 'beta', label: t('settings.opencodeConfig.sections.general.options.modelStatusFilter.beta') },
      { value: 'alpha', label: t('settings.opencodeConfig.sections.general.options.modelStatusFilter.alpha') },
      {
        value: 'deprecated',
        label: t('settings.opencodeConfig.sections.general.options.modelStatusFilter.deprecated'),
      },
    ])

    const modelSortPickerOptions = computed<PickerOption[]>(() => [
      { value: 'alpha', label: t('settings.opencodeConfig.sections.general.modelBrowser.sortOptions.alpha') },
      {
        value: 'context_desc',
        label: t('settings.opencodeConfig.sections.general.modelBrowser.sortOptions.contextDesc'),
      },
      {
        value: 'output_desc',
        label: t('settings.opencodeConfig.sections.general.modelBrowser.sortOptions.outputDesc'),
      },
      {
        value: 'cost_total_asc',
        label: t('settings.opencodeConfig.sections.general.modelBrowser.sortOptions.costTotalAsc'),
      },
      {
        value: 'cost_input_asc',
        label: t('settings.opencodeConfig.sections.general.modelBrowser.sortOptions.costInputAsc'),
      },
      {
        value: 'cost_output_asc',
        label: t('settings.opencodeConfig.sections.general.modelBrowser.sortOptions.costOutputAsc'),
      },
      {
        value: 'release_desc',
        label: t('settings.opencodeConfig.sections.general.modelBrowser.sortOptions.releaseDesc'),
      },
    ])

    const logLevelPickerOptions = computed<PickerOption[]>(() => [
      { value: 'default', label: t('settings.opencodeConfig.sections.general.options.logLevel.default') },
      { value: 'DEBUG', label: t('settings.opencodeConfig.sections.general.options.logLevel.DEBUG') },
      { value: 'INFO', label: t('settings.opencodeConfig.sections.general.options.logLevel.INFO') },
      { value: 'WARN', label: t('settings.opencodeConfig.sections.general.options.logLevel.WARN') },
      { value: 'ERROR', label: t('settings.opencodeConfig.sections.general.options.logLevel.ERROR') },
    ])

    const shareModePickerOptions = computed<PickerOption[]>(() => [
      { value: 'default', label: t('settings.opencodeConfig.sections.general.options.shareMode.default') },
      { value: 'manual', label: t('settings.opencodeConfig.sections.general.options.shareMode.manual') },
      { value: 'auto', label: t('settings.opencodeConfig.sections.general.options.shareMode.auto') },
      { value: 'disabled', label: t('settings.opencodeConfig.sections.general.options.shareMode.disabled') },
    ])

    const autoUpdateModePickerOptions = computed<PickerOption[]>(() => [
      { value: 'default', label: t('settings.opencodeConfig.sections.general.options.autoUpdate.default') },
      { value: 'notify', label: t('settings.opencodeConfig.sections.general.options.autoUpdate.notify') },
      { value: 'true', label: t('settings.opencodeConfig.sections.general.options.autoUpdate.true') },
      { value: 'false', label: t('settings.opencodeConfig.sections.general.options.autoUpdate.false') },
    ])

    const snapshotModePickerOptions = computed<PickerOption[]>(() => [
      { value: 'default', label: t('settings.opencodeConfig.sections.general.options.snapshotTracking.default') },
      { value: 'true', label: t('settings.opencodeConfig.sections.general.options.snapshotTracking.true') },
      { value: 'false', label: t('settings.opencodeConfig.sections.general.options.snapshotTracking.false') },
    ])

    return Object.assign(ctx, {
      normalizeAgentName,
      defaultAgentPickerOptions,
      modelPickerOptions,
      modelProviderFilterPickerOptions,
      modelFamilyFilterPickerOptions,
      modelStatusFilterPickerOptions,
      modelSortPickerOptions,
      logLevelPickerOptions,
      shareModePickerOptions,
      autoUpdateModePickerOptions,
      snapshotModePickerOptions,
    })
  },
})
</script>

<template>
  <section id="general" class="scroll-mt-24 rounded-lg border border-border bg-background p-4 space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-base font-semibold leading-snug">
          {{ t('settings.opencodeConfig.sections.general.title') }}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <Tooltip>
          <Button
            size="icon"
            variant="ghost"
            class="h-8 w-8"
            :title="t('settings.opencodeConfig.sections.common.resetSection')"
            @click="resetSection('general')"
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
              isSectionOpen('general')
                ? t('settings.opencodeConfig.sections.common.collapse')
                : t('settings.opencodeConfig.sections.common.expand')
            "
            @click="toggleSection('general')"
          >
            <RiArrowUpSLine v-if="isSectionOpen('general')" class="h-4 w-4" />
            <RiArrowDownSLine v-else class="h-4 w-4" />
          </Button>
          <template #content>{{
            isSectionOpen('general')
              ? t('settings.opencodeConfig.sections.common.collapse')
              : t('settings.opencodeConfig.sections.common.expand')
          }}</template>
        </Tooltip>
      </div>
    </div>

    <div v-if="isSectionOpen('general')" class="space-y-4">
      <div v-if="optionsError" class="text-xs text-destructive break-all">{{ optionsError }}</div>
      <div v-else class="text-xs text-muted-foreground">
        {{ t('settings.opencodeConfig.sections.general.help.discovery') }}
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{
            t('settings.opencodeConfig.sections.general.fields.schemaUrl')
          }}</span>
          <Input
            v-model="schemaUrl"
            :placeholder="t('settings.opencodeConfig.sections.general.placeholders.schemaUrl')"
          />
          <span class="text-[11px] text-muted-foreground">{{
            t('settings.opencodeConfig.sections.general.help.schemaUrl')
          }}</span>
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{
            t('settings.opencodeConfig.sections.general.fields.theme')
          }}</span>
          <Input v-model="theme" :placeholder="t('settings.opencodeConfig.sections.general.placeholders.theme')" />
          <span class="text-[11px] text-muted-foreground">{{
            t('settings.opencodeConfig.sections.general.help.theme')
          }}</span>
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{
            t('settings.opencodeConfig.sections.general.fields.username')
          }}</span>
          <Input
            v-model="username"
            :placeholder="t('settings.opencodeConfig.sections.general.placeholders.username')"
          />
          <span class="text-[11px] text-muted-foreground">{{
            t('settings.opencodeConfig.sections.general.help.username')
          }}</span>
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{
            t('settings.opencodeConfig.sections.general.fields.defaultAgent')
          }}</span>
          <div class="flex items-center gap-2">
            <div class="flex-1 min-w-0">
              <OptionPicker
                :model-value="defaultAgent"
                @update:model-value="(v) => (defaultAgent = normalizeAgentName(v))"
                :options="defaultAgentPickerOptions"
                :title="t('settings.opencodeConfig.sections.general.fields.defaultAgent')"
                :search-placeholder="t('settings.opencodeConfig.sections.general.search.searchAgents')"
                :icon="RiUserLine"
                allow-custom
              />
            </div>
            <Tooltip>
              <Button
                size="icon"
                variant="outline"
                class="h-9 w-9"
                :title="t('settings.opencodeConfig.sections.general.actions.refreshOptionLists')"
                :aria-label="t('settings.opencodeConfig.sections.general.actions.refreshOptionLists')"
                @click="refreshOptionLists({ toast: true })"
                :disabled="optionsLoading"
              >
                <RiRefreshLine class="h-4 w-4" :class="optionsLoading ? 'animate-spin' : ''" />
              </Button>
              <template #content>{{
                t('settings.opencodeConfig.sections.general.actions.refreshOptionLists')
              }}</template>
            </Tooltip>
          </div>
          <span class="text-[11px] text-muted-foreground">{{
            t('settings.opencodeConfig.sections.general.help.defaultAgentRequirement')
          }}</span>
          <span v-if="defaultAgentWarning" class="text-xs text-destructive">{{ defaultAgentWarning }}</span>
          <span v-else-if="issueText('default_agent')" class="text-xs text-destructive">{{
            issueText('default_agent')
          }}</span>
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{
            t('settings.opencodeConfig.sections.general.fields.defaultModel')
          }}</span>
          <div class="flex items-center gap-2">
            <div class="flex-1 min-w-0">
              <OptionPicker
                :model-value="model"
                @update:model-value="(v) => (model = String(v || '').trim())"
                :options="modelPickerOptions"
                :title="t('settings.opencodeConfig.sections.general.fields.defaultModel')"
                :search-placeholder="t('settings.opencodeConfig.sections.general.search.searchModels')"
                :icon="RiStackLine"
                allow-custom
                monospace
              />
            </div>
            <Tooltip>
              <Button
                size="icon"
                variant="outline"
                class="h-9 w-9"
                :title="t('settings.opencodeConfig.sections.general.actions.refreshOptionLists')"
                :aria-label="t('settings.opencodeConfig.sections.general.actions.refreshOptionLists')"
                @click="refreshOptionLists({ toast: true })"
                :disabled="optionsLoading"
              >
                <RiRefreshLine class="h-4 w-4" :class="optionsLoading ? 'animate-spin' : ''" />
              </Button>
              <template #content>{{
                t('settings.opencodeConfig.sections.general.actions.refreshOptionLists')
              }}</template>
            </Tooltip>
          </div>
          <button
            type="button"
            class="text-[11px] text-muted-foreground hover:text-foreground text-left"
            @click="showModelBrowse = !showModelBrowse"
          >
            {{
              showModelBrowse
                ? t('settings.opencodeConfig.sections.general.actions.hideModelBrowser')
                : t('settings.opencodeConfig.sections.general.actions.browseModels')
            }}
          </button>
          <span v-if="modelWarning" class="text-xs text-amber-600">{{ modelWarning }}</span>
          <span v-else-if="modelUnknownWarning" class="text-xs text-amber-600">{{ modelUnknownWarning }}</span>
          <span v-else-if="issueText('model')" class="text-xs text-destructive">{{ issueText('model') }}</span>
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{
            t('settings.opencodeConfig.sections.general.fields.smallModel')
          }}</span>
          <div class="flex items-center gap-2">
            <div class="flex-1 min-w-0">
              <OptionPicker
                :model-value="smallModel"
                @update:model-value="(v) => (smallModel = String(v || '').trim())"
                :options="modelPickerOptions"
                :title="t('settings.opencodeConfig.sections.general.fields.smallModel')"
                :search-placeholder="t('settings.opencodeConfig.sections.general.search.searchModels')"
                :icon="RiSparkling2Line"
                allow-custom
                monospace
              />
            </div>
            <Tooltip>
              <Button
                size="icon"
                variant="outline"
                class="h-9 w-9"
                :title="t('settings.opencodeConfig.sections.general.actions.refreshOptionLists')"
                :aria-label="t('settings.opencodeConfig.sections.general.actions.refreshOptionLists')"
                @click="refreshOptionLists({ toast: true })"
                :disabled="optionsLoading"
              >
                <RiRefreshLine class="h-4 w-4" :class="optionsLoading ? 'animate-spin' : ''" />
              </Button>
              <template #content>{{
                t('settings.opencodeConfig.sections.general.actions.refreshOptionLists')
              }}</template>
            </Tooltip>
          </div>
          <span class="text-[11px] text-muted-foreground">{{
            t('settings.opencodeConfig.sections.general.help.smallModel')
          }}</span>
          <span v-if="smallModelWarning" class="text-xs text-amber-600">{{ smallModelWarning }}</span>
          <span v-else-if="smallModelUnknownWarning" class="text-xs text-amber-600">{{
            smallModelUnknownWarning
          }}</span>
          <span v-else-if="issueText('small_model')" class="text-xs text-destructive">{{
            issueText('small_model')
          }}</span>
        </label>

        <div v-if="showModelBrowse" class="lg:col-span-2 rounded-md border border-border p-3 space-y-2">
          <div class="flex items-center justify-between">
            <div class="text-sm font-semibold">
              {{ t('settings.opencodeConfig.sections.general.modelBrowser.title') }}
            </div>
            <Tooltip>
              <Button
                size="icon"
                variant="ghost"
                class="h-8 w-8"
                :title="t('settings.opencodeConfig.sections.general.modelBrowser.actions.closeAria')"
                :aria-label="t('settings.opencodeConfig.sections.general.modelBrowser.actions.closeAria')"
                @click="showModelBrowse = false"
              >
                <RiCloseLine class="h-4 w-4" />
              </Button>
              <template #content>{{ t('common.close') }}</template>
            </Tooltip>
          </div>
          <div class="grid gap-3 lg:grid-cols-3">
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">{{
                t('settings.opencodeConfig.sections.general.modelBrowser.fields.search')
              }}</span>
              <Input
                v-model="modelSlugFilter"
                :placeholder="t('settings.opencodeConfig.sections.general.modelBrowser.placeholders.search')"
              />
            </label>
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">{{
                t('settings.opencodeConfig.sections.general.modelBrowser.fields.provider')
              }}</span>
              <OptionPicker
                v-model="modelProviderFilter"
                :options="modelProviderFilterPickerOptions"
                :title="t('settings.opencodeConfig.sections.general.modelBrowser.fields.provider')"
                :search-placeholder="t('settings.opencodeConfig.sections.general.search.searchProviders')"
                :empty-label="t('settings.opencodeConfig.sections.general.common.all')"
              />
            </label>
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">{{
                t('settings.opencodeConfig.sections.general.modelBrowser.fields.status')
              }}</span>
              <OptionPicker
                v-model="modelStatusFilter"
                :options="modelStatusFilterPickerOptions"
                :title="t('settings.opencodeConfig.sections.general.modelBrowser.fields.status')"
                :search-placeholder="t('settings.opencodeConfig.sections.general.search.searchStatuses')"
                :empty-label="t('settings.opencodeConfig.sections.general.common.all')"
              />
            </label>
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">{{
                t('settings.opencodeConfig.sections.general.modelBrowser.fields.family')
              }}</span>
              <OptionPicker
                v-model="modelFamilyFilter"
                :options="modelFamilyFilterPickerOptions"
                :title="t('settings.opencodeConfig.sections.general.modelBrowser.fields.family')"
                :search-placeholder="t('settings.opencodeConfig.sections.general.search.searchFamilies')"
                :empty-label="t('settings.opencodeConfig.sections.general.common.all')"
              />
            </label>
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">{{
                t('settings.opencodeConfig.sections.general.modelBrowser.fields.minContext')
              }}</span>
              <input
                v-model="modelMinContext"
                type="number"
                min="0"
                class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                placeholder="0"
              />
            </label>
            <label class="grid gap-1">
              <span class="text-xs text-muted-foreground">{{
                t('settings.opencodeConfig.sections.general.modelBrowser.fields.minOutput')
              }}</span>
              <input
                v-model="modelMinOutput"
                type="number"
                min="0"
                class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                placeholder="0"
              />
            </label>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <label class="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" v-model="modelRequireTools" />
              {{ t('settings.opencodeConfig.sections.general.modelBrowser.filters.tools') }}
            </label>
            <label class="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" v-model="modelRequireReasoning" />
              {{ t('settings.opencodeConfig.sections.general.modelBrowser.filters.reasoning') }}
            </label>
            <label class="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" v-model="modelRequireImage" />
              {{ t('settings.opencodeConfig.sections.general.modelBrowser.filters.imageInput') }}
            </label>
            <label class="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" v-model="modelRequirePdf" />
              {{ t('settings.opencodeConfig.sections.general.modelBrowser.filters.pdfInput') }}
            </label>
            <div class="flex-1" />
            <label class="inline-flex items-center gap-2 text-sm">
              <span class="text-xs text-muted-foreground">{{
                t('settings.opencodeConfig.sections.general.modelBrowser.fields.sort')
              }}</span>
              <div class="w-[190px]">
                <OptionPicker
                  v-model="modelSort"
                  :options="modelSortPickerOptions"
                  :title="t('settings.opencodeConfig.sections.general.modelBrowser.fields.sort')"
                  :search-placeholder="t('settings.opencodeConfig.sections.general.search.searchSorts')"
                  :include-empty="false"
                />
              </div>
            </label>
          </div>

          <div class="text-[11px] text-muted-foreground">
            {{
              t('settings.opencodeConfig.sections.general.modelBrowser.help.countLine', {
                count: sortedModelEntries.length,
              })
            }}
          </div>
          <VirtualList
            v-if="modelBrowserRows.length"
            :items="modelBrowserRows"
            :get-key="(row) => modelBrowserRowKey(row)"
            :get-height="(row) => modelBrowserRowHeight(row)"
            class="max-h-64 pr-1 rounded-md border border-border bg-muted/10"
          >
            <template #default="{ item: row }">
              <div
                v-if="row.kind === 'provider'"
                class="h-7 px-2 flex items-center justify-between border-b border-border/60 bg-background/70"
              >
                <div class="font-mono text-xs font-semibold break-all">{{ row.providerId }}</div>
                <div class="text-[11px] text-muted-foreground">
                  {{ providerRemoteInfo(row.providerId)?.name || ''
                  }}{{ providerRemoteInfo(row.providerId)?.name ? ' · ' : ''
                  }}{{ providerRemoteInfo(row.providerId)?.source || '' }} · {{ row.count }}
                </div>
              </div>
              <div
                v-else
                class="h-[72px] px-2 py-2 flex items-start justify-between gap-2 border-b border-border/40 overflow-hidden"
              >
                <div class="min-w-0">
                  <div class="font-mono text-xs break-all truncate">{{ row.entry.slug }}</div>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                  <Tooltip>
                    <Button
                      size="icon"
                      variant="outline"
                      class="h-8 w-8"
                      :title="t('settings.opencodeConfig.sections.general.modelBrowser.actions.setDefaultModel')"
                      :aria-label="t('settings.opencodeConfig.sections.general.modelBrowser.actions.setDefaultModel')"
                      @click="model = row.entry.slug"
                    >
                      <RiStackLine class="h-4 w-4" />
                    </Button>
                    <template #content>{{
                      t('settings.opencodeConfig.sections.general.modelBrowser.actions.defaultLabel')
                    }}</template>
                  </Tooltip>
                  <Tooltip>
                    <Button
                      size="icon"
                      variant="outline"
                      class="h-8 w-8"
                      :title="t('settings.opencodeConfig.sections.general.modelBrowser.actions.setSmallModel')"
                      :aria-label="t('settings.opencodeConfig.sections.general.modelBrowser.actions.setSmallModel')"
                      @click="smallModel = row.entry.slug"
                    >
                      <RiSparkling2Line class="h-4 w-4" />
                    </Button>
                    <template #content>{{
                      t('settings.opencodeConfig.sections.general.modelBrowser.actions.smallLabel')
                    }}</template>
                  </Tooltip>
                </div>
              </div>
            </template>
          </VirtualList>
          <div v-else class="text-xs text-muted-foreground">
            {{ t('settings.opencodeConfig.sections.general.modelBrowser.empty') }}
          </div>
        </div>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{
            t('settings.opencodeConfig.sections.general.fields.logLevel')
          }}</span>
          <OptionPicker
            v-model="logLevel"
            :options="logLevelPickerOptions"
            :title="t('settings.opencodeConfig.sections.general.fields.logLevel')"
            :search-placeholder="t('settings.opencodeConfig.sections.general.search.searchLogLevels')"
            :include-empty="false"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{
            t('settings.opencodeConfig.sections.general.fields.shareMode')
          }}</span>
          <OptionPicker
            v-model="shareMode"
            :options="shareModePickerOptions"
            :title="t('settings.opencodeConfig.sections.general.fields.shareMode')"
            :search-placeholder="t('settings.opencodeConfig.sections.general.search.searchShareModes')"
            :include-empty="false"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{
            t('settings.opencodeConfig.sections.general.fields.autoUpdate')
          }}</span>
          <OptionPicker
            v-model="autoUpdateMode"
            :options="autoUpdateModePickerOptions"
            :title="t('settings.opencodeConfig.sections.general.fields.autoUpdate')"
            :search-placeholder="t('settings.opencodeConfig.sections.general.search.searchUpdateModes')"
            :include-empty="false"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{
            t('settings.opencodeConfig.sections.general.fields.snapshotTracking')
          }}</span>
          <OptionPicker
            v-model="snapshotMode"
            :options="snapshotModePickerOptions"
            :title="t('settings.opencodeConfig.sections.general.fields.snapshotTracking')"
            :search-placeholder="t('settings.opencodeConfig.sections.general.search.searchSnapshotModes')"
            :include-empty="false"
          />
        </label>
      </div>
    </div>
  </section>
</template>

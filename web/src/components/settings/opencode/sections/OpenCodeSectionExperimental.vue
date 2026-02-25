<script lang="ts">
import { computed, defineComponent, ref } from 'vue'
import { RiArrowDownSLine, RiArrowUpSLine, RiRestartLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import OptionPicker from '@/components/ui/OptionPicker.vue'
import type { PickerOption } from '@/components/ui/pickerOption.types'
import Tooltip from '@/components/ui/Tooltip.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

export default defineComponent({
  components: {
    Button,
    Input,
    OptionPicker,
    Tooltip,
    RiArrowDownSLine,
    RiArrowUpSLine,
    RiRestartLine,
  },
  setup() {
    const ctx = useOpencodeConfigPanelContext()
    const t = ctx.t as unknown as (key: string, params?: Record<string, unknown>) => string
    const showAdvancedPrimaryTools = ref(false)

    const triStatePickerOptions = computed<PickerOption[]>(() => [
      { value: 'default', label: t('settings.opencodeConfig.sections.common.options.triState.default') },
      { value: 'true', label: t('settings.opencodeConfig.sections.common.options.triState.true') },
      { value: 'false', label: t('settings.opencodeConfig.sections.common.options.triState.false') },
    ])

    return Object.assign(ctx, { showAdvancedPrimaryTools, triStatePickerOptions })
  },
})
</script>

<template>
  <section id="experimental" class="scroll-mt-24 rounded-lg border border-border bg-background p-4 space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-base font-semibold leading-snug">
          {{ t('settings.opencodeConfig.sections.experimental.title') }}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <Tooltip>
          <Button
            size="icon"
            variant="ghost"
            class="h-8 w-8"
            :title="t('settings.opencodeConfig.sections.common.resetSection')"
            @click="resetSection('experimental')"
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
              isSectionOpen('experimental')
                ? t('settings.opencodeConfig.sections.common.collapse')
                : t('settings.opencodeConfig.sections.common.expand')
            "
            @click="toggleSection('experimental')"
          >
            <RiArrowUpSLine v-if="isSectionOpen('experimental')" class="h-4 w-4" />
            <RiArrowDownSLine v-else class="h-4 w-4" />
          </Button>
          <template #content>{{
            isSectionOpen('experimental')
              ? t('settings.opencodeConfig.sections.common.collapse')
              : t('settings.opencodeConfig.sections.common.expand')
          }}</template>
        </Tooltip>
      </div>
    </div>

    <div v-if="isSectionOpen('experimental')" class="space-y-4">
      <div class="grid gap-4 lg:grid-cols-3">
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{
            t('settings.opencodeConfig.sections.experimental.fields.disablePasteSummary')
          }}</span>
          <OptionPicker
            v-model="experimentalDisablePasteSummary"
            :options="triStatePickerOptions"
            :title="t('settings.opencodeConfig.sections.experimental.fields.disablePasteSummary')"
            :search-placeholder="t('common.search')"
            :include-empty="false"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{
            t('settings.opencodeConfig.sections.experimental.fields.batchTool')
          }}</span>
          <OptionPicker
            v-model="experimentalBatchTool"
            :options="triStatePickerOptions"
            :title="t('settings.opencodeConfig.sections.experimental.fields.batchTool')"
            :search-placeholder="t('common.search')"
            :include-empty="false"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{
            t('settings.opencodeConfig.sections.experimental.fields.openTelemetry')
          }}</span>
          <OptionPicker
            v-model="experimentalOpenTelemetry"
            :options="triStatePickerOptions"
            :title="t('settings.opencodeConfig.sections.experimental.fields.openTelemetry')"
            :search-placeholder="t('common.search')"
            :include-empty="false"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{
            t('settings.opencodeConfig.sections.experimental.fields.continueLoopOnDeny')
          }}</span>
          <OptionPicker
            v-model="experimentalContinueLoop"
            :options="triStatePickerOptions"
            :title="t('settings.opencodeConfig.sections.experimental.fields.continueLoopOnDeny')"
            :search-placeholder="t('common.search')"
            :include-empty="false"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{
            t('settings.opencodeConfig.sections.experimental.fields.mcpTimeoutMs')
          }}</span>
          <input
            v-model="experimentalMcpTimeout"
            type="number"
            min="0"
            class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          />
        </label>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <div class="grid gap-2">
          <div class="flex items-center justify-between">
            <span class="text-xs text-muted-foreground">{{
              t('settings.opencodeConfig.sections.experimental.primaryTools.title')
            }}</span>
            <button
              type="button"
              class="text-[11px] text-muted-foreground hover:text-foreground"
              @click="showAdvancedPrimaryTools = !showAdvancedPrimaryTools"
            >
              {{
                showAdvancedPrimaryTools
                  ? t('settings.opencodeConfig.sections.common.hideAdvancedText')
                  : t('settings.opencodeConfig.sections.common.showAdvancedText')
              }}
            </button>
          </div>
          <Input
            v-model="toolFilter"
            :placeholder="t('settings.opencodeConfig.sections.experimental.primaryTools.placeholders.filterTools')"
            class="max-w-sm"
          />
          <div class="rounded-md border border-border p-3">
            <div class="grid gap-2 max-h-44 overflow-auto pr-1">
              <label v-for="id in filteredToolIdOptions" :key="`primary:${id}`" class="flex items-center gap-2 text-sm">
                <input type="checkbox" v-model="experimentalPrimaryToolsArr" :value="id" />
                <span class="font-mono text-xs break-all">{{ id }}</span>
              </label>
              <div v-if="filteredToolIdOptions.length === 0" class="text-xs text-muted-foreground">
                {{ t('settings.opencodeConfig.sections.experimental.primaryTools.empty') }}
              </div>
            </div>
          </div>
          <div class="text-[11px] text-muted-foreground">
            {{ t('settings.opencodeConfig.sections.experimental.primaryTools.help') }}
          </div>
          <div v-if="toolIdsError" class="text-[11px] text-muted-foreground break-all">
            {{
              t('settings.opencodeConfig.sections.experimental.primaryTools.toolIdsUnavailable', {
                error: toolIdsError,
              })
            }}
          </div>
          <textarea
            v-if="showAdvancedPrimaryTools"
            v-model="experimentalPrimaryTools"
            rows="4"
            class="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
            :placeholder="t('settings.opencodeConfig.sections.experimental.primaryTools.placeholders.advanced')"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { RiCloseLine, RiListCheck3 } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/Button.vue'
import OptionPicker from '@/components/ui/OptionPicker.vue'
import type { PickerOption } from '@/components/ui/pickerOption.types'
import Tooltip from '@/components/ui/Tooltip.vue'
import StringListEditor from '../StringListEditor.vue'

type OptionPickerOption = PickerOption

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'
import { asStringArray } from '../utils'

const ctx = useOpencodeConfigPanelContext()

const { t } = useI18n()

const {
  providerConflictPolicy,
  bulkProviderSelection,
  providerIdOptions,
  providerEnvError,
  applyBulkEnableOnly,
  applyBulkDisableAllExcept,
} = ctx

const providerPickerOptions = computed<PickerOption[]>(() => {
  const list = asStringArray(ctx.providerIdOptions)
  return list.map((id) => ({ value: id, label: id }))
})

const conflictPolicyPickerOptions = computed<OptionPickerOption[]>(() => [
  {
    value: 'last-change-wins',
    label: t('settings.opencodeConfig.sections.providers.bulkActions.options.lastChangeWins'),
  },
  { value: 'enabled-wins', label: t('settings.opencodeConfig.sections.providers.bulkActions.options.enabledWins') },
  {
    value: 'disabled-wins',
    label: t('settings.opencodeConfig.sections.providers.bulkActions.options.disabledWins'),
  },
  { value: 'keep-conflict', label: t('settings.opencodeConfig.sections.providers.bulkActions.options.keepConflict') },
])
</script>

<template>
  <div class="rounded-md border border-border p-3 space-y-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="text-sm font-semibold">{{ t('settings.opencodeConfig.sections.providers.bulkActions.title') }}</div>
      <div class="text-[11px] text-muted-foreground">
        {{ t('settings.opencodeConfig.sections.providers.bulkActions.help') }}
      </div>
    </div>
    <div class="grid gap-3 lg:grid-cols-2">
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">{{
          t('settings.opencodeConfig.sections.providers.bulkActions.fields.conflictPolicy')
        }}</span>
        <OptionPicker
          v-model="providerConflictPolicy"
          :options="conflictPolicyPickerOptions"
          :title="t('settings.opencodeConfig.sections.providers.bulkActions.fields.conflictPolicy')"
          :search-placeholder="t('settings.opencodeConfig.sections.providers.bulkActions.search.searchPolicies')"
          :include-empty="false"
        />
      </label>
      <div class="lg:col-span-2 grid gap-1">
        <span class="text-xs text-muted-foreground">{{
          t('settings.opencodeConfig.sections.providers.bulkActions.fields.selection')
        }}</span>
        <StringListEditor
          v-model="bulkProviderSelection"
          :suggestions="providerPickerOptions"
          :panel-title="t('settings.opencodeConfig.sections.providers.bulkActions.picker.panelTitle')"
          :placeholder="t('settings.opencodeConfig.sections.providers.bulkActions.picker.placeholder')"
          :show-advanced-toggle="false"
          :advanced-always-visible="false"
        >
          <template #adder-actions>
            <Tooltip>
              <Button
                size="icon"
                variant="ghost"
                class="h-9 w-9"
                :title="t('common.selectAll')"
                :aria-label="t('common.selectAll')"
                @click="bulkProviderSelection = providerIdOptions"
              >
                <RiListCheck3 class="h-4 w-4" />
              </Button>
              <template #content>{{ t('common.all') }}</template>
            </Tooltip>
          </template>
        </StringListEditor>
      </div>
    </div>
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <Button size="sm" variant="outline" @click="applyBulkEnableOnly" :disabled="bulkProviderSelection.length === 0">
      {{ t('settings.opencodeConfig.sections.providers.bulkActions.actions.enableOnly') }}
    </Button>
    <Button
      size="sm"
      variant="outline"
      @click="applyBulkDisableAllExcept"
      :disabled="bulkProviderSelection.length === 0"
    >
      {{ t('settings.opencodeConfig.sections.providers.bulkActions.actions.disableAllExcept') }}
    </Button>
    <span v-if="providerEnvError" class="text-xs text-amber-600 break-all">{{
      t('settings.opencodeConfig.sections.providers.bulkActions.errors.envCheck', { error: providerEnvError })
    }}</span>
  </div>
</template>

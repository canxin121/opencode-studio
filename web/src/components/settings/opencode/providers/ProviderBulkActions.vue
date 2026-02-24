<script setup lang="ts">
import { computed } from 'vue'
import { RiCloseLine, RiListCheck3 } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/Button.vue'
import InlineSearchAdd, { type PickerOption } from '@/components/ui/InlineSearchAdd.vue'
import OptionPicker, { type PickerOption as OptionPickerOption } from '@/components/ui/OptionPicker.vue'
import Tooltip from '@/components/ui/Tooltip.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'
import { asStringArray } from '../utils'

const ctx = useOpencodeConfigPanelContext()

const { t } = useI18n()

const {
  providerConflictPolicy,
  bulkProviderSelection,
  providerIdOptions,
  providerEnvError,
  removeFromList,
  addBulkProviderTags,
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
        <div class="flex flex-wrap gap-2">
          <span
            v-for="id in bulkProviderSelection"
            :key="`bulk:${id}`"
            class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/20 px-2 py-1 text-xs"
          >
            <span class="font-mono break-all">{{ id }}</span>
            <button
              type="button"
              class="text-muted-foreground hover:text-foreground"
              @click="bulkProviderSelection = removeFromList(bulkProviderSelection, id)"
            >
              ×
            </button>
          </span>
          <span v-if="bulkProviderSelection.length === 0" class="text-xs text-muted-foreground">{{
            t('settings.opencodeConfig.sections.common.none')
          }}</span>
        </div>
        <div class="flex items-center gap-2">
          <InlineSearchAdd
            :options="providerPickerOptions"
            :panel-title="t('settings.opencodeConfig.sections.providers.bulkActions.picker.panelTitle')"
            :placeholder="t('settings.opencodeConfig.sections.providers.bulkActions.picker.placeholder')"
            monospace
            :selected-values="bulkProviderSelection"
            @add="addBulkProviderTags"
            @remove="(v: string) => (bulkProviderSelection = removeFromList(bulkProviderSelection, v))"
            @backspace-empty="
              () => {
                if (bulkProviderSelection.length) bulkProviderSelection = bulkProviderSelection.slice(0, -1)
              }
            "
          />
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
          <Tooltip>
            <Button
              size="icon"
              variant="ghost"
              class="h-9 w-9"
              :title="t('common.clear')"
              :aria-label="t('settings.opencodeConfig.sections.providers.bulkActions.actions.clearSelectionAria')"
              @click="bulkProviderSelection = []"
              :disabled="bulkProviderSelection.length === 0"
            >
              <RiCloseLine class="h-4 w-4" />
            </Button>
            <template #content>{{ t('common.clear') }}</template>
          </Tooltip>
        </div>
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

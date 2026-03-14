<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import Input from '@/components/ui/Input.vue'
import type { PickerOption } from '@/components/ui/pickerOption.types'
import VirtualList from '@/components/ui/VirtualList.vue'
import CrudStringListEditor from '../CrudStringListEditor.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'
import { asStringArray } from '../utils'

const ctx = useOpencodeConfigPanelContext()

const { t } = useI18n()

const {
  showProviderBrowse,
  enabledProvidersArr,
  disabledProvidersArr,
  providerFilter,
  filteredProviderIdOptions,
  providerListConflict,
  isKnownProviderId,
  reconcileProviderLists,
} = ctx

const providerPickerOptions = computed<PickerOption[]>(() => {
  const list = asStringArray(ctx.providerIdOptions)
  return list.map((id) => ({ value: id, label: id }))
})
</script>

<template>
  <div class="grid gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="text-xs text-muted-foreground">
        {{ t('settings.opencodeConfig.sections.providers.allowDeny.title') }}
      </div>
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="text-[11px] text-muted-foreground hover:text-foreground"
          @click="showProviderBrowse = !showProviderBrowse"
        >
          {{
            showProviderBrowse
              ? t('settings.opencodeConfig.sections.providers.allowDeny.actions.hideBrowse')
              : t('settings.opencodeConfig.sections.providers.allowDeny.actions.showBrowse')
          }}
        </button>
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <div class="rounded-md border border-border p-3 space-y-2">
        <div class="text-sm font-semibold">
          {{ t('settings.opencodeConfig.sections.providers.allowDeny.enabled.title') }}
        </div>
        <div class="text-[11px] text-muted-foreground">
          {{ t('settings.opencodeConfig.sections.providers.allowDeny.enabled.help') }}
        </div>

        <CrudStringListEditor
          v-model="enabledProvidersArr"
          :suggestions="providerPickerOptions"
          :panel-title="t('settings.opencodeConfig.sections.providers.allowDeny.picker.panelTitle')"
          :placeholder="t('settings.opencodeConfig.sections.providers.allowDeny.picker.placeholder')"
        >
          <template #item="{ value }">
            <span class="font-mono break-all" :class="isKnownProviderId(value) ? '' : 'text-amber-600'">{{
              value
            }}</span>
          </template>
        </CrudStringListEditor>
      </div>

      <div class="rounded-md border border-border p-3 space-y-2">
        <div class="text-sm font-semibold">
          {{ t('settings.opencodeConfig.sections.providers.allowDeny.disabled.title') }}
        </div>
        <div class="text-[11px] text-muted-foreground">
          {{ t('settings.opencodeConfig.sections.providers.allowDeny.disabled.help') }}
        </div>

        <CrudStringListEditor
          v-model="disabledProvidersArr"
          :suggestions="providerPickerOptions"
          :panel-title="t('settings.opencodeConfig.sections.providers.allowDeny.picker.panelTitle')"
          :placeholder="t('settings.opencodeConfig.sections.providers.allowDeny.picker.placeholder')"
        >
          <template #item="{ value }">
            <span class="font-mono break-all" :class="isKnownProviderId(value) ? '' : 'text-amber-600'">{{
              value
            }}</span>
          </template>
        </CrudStringListEditor>
      </div>
    </div>

    <div v-if="showProviderBrowse" class="grid gap-2">
      <Input
        v-model="providerFilter"
        :placeholder="t('settings.opencodeConfig.sections.providers.allowDeny.placeholders.filterProviders')"
        class="max-w-sm"
      />
      <div class="grid gap-4 lg:grid-cols-2">
        <div class="rounded-md border border-border p-3">
          <div class="text-xs text-muted-foreground">
            {{ t('settings.opencodeConfig.sections.providers.allowDeny.enabled.toggleTitle') }}
          </div>
          <VirtualList
            v-if="filteredProviderIdOptions.length"
            :items="filteredProviderIdOptions"
            :get-key="(id) => `enabled-browse:${id}`"
            :get-height="() => 28"
            class="mt-2 max-h-44 pr-1"
          >
            <template #default="{ item: id }">
              <label class="h-7 flex items-center gap-2 text-sm px-1">
                <input
                  type="checkbox"
                  v-model="enabledProvidersArr"
                  :value="id"
                  @change="() => reconcileProviderLists('enabled')"
                />
                <span class="font-mono text-xs break-all">{{ id }}</span>
              </label>
            </template>
          </VirtualList>
          <div v-else class="mt-2 text-xs text-muted-foreground">
            {{ t('settings.opencodeConfig.sections.providers.allowDeny.empty.noMatchingProviders') }}
          </div>
        </div>

        <div class="rounded-md border border-border p-3">
          <div class="text-xs text-muted-foreground">
            {{ t('settings.opencodeConfig.sections.providers.allowDeny.disabled.toggleTitle') }}
          </div>
          <VirtualList
            v-if="filteredProviderIdOptions.length"
            :items="filteredProviderIdOptions"
            :get-key="(id) => `disabled-browse:${id}`"
            :get-height="() => 28"
            class="mt-2 max-h-44 pr-1"
          >
            <template #default="{ item: id }">
              <label class="h-7 flex items-center gap-2 text-sm px-1">
                <input
                  type="checkbox"
                  v-model="disabledProvidersArr"
                  :value="id"
                  @change="() => reconcileProviderLists('disabled')"
                />
                <span class="font-mono text-xs break-all">{{ id }}</span>
              </label>
            </template>
          </VirtualList>
          <div v-else class="mt-2 text-xs text-muted-foreground">
            {{ t('settings.opencodeConfig.sections.providers.allowDeny.empty.noMatchingProviders') }}
          </div>
        </div>
      </div>
    </div>

    <div v-if="providerListConflict.length > 0" class="text-xs text-destructive">
      {{
        t('settings.opencodeConfig.sections.providers.allowDeny.errors.conflicts', {
          conflicts: providerListConflict.join(', '),
        })
      }}
    </div>
  </div>
</template>

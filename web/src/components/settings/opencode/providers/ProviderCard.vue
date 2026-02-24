<script setup lang="ts">
import { computed } from 'vue'
import { RiArrowDownSLine, RiArrowUpSLine, RiDeleteBinLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import OptionPicker, { type PickerOption } from '@/components/ui/OptionPicker.vue'
import Tooltip from '@/components/ui/Tooltip.vue'
import type { JsonValue as JsonLike } from '@/types/json'

import ProviderStatusChips from './ProviderStatusChips.vue'
import ProviderMapsEditor from './ProviderMapsEditor.vue'
import ProviderModelsEditor from './ProviderModelsEditor.vue'
import StringListEditor from '../StringListEditor.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

type ProviderViewModel = {
  name?: string
  api?: string
  id?: string
  npm?: string
  env?: string[]
  whitelist?: string[]
  blacklist?: string[]
}

type ProviderCardContext = {
  isProviderExpanded: (providerId: string) => boolean
  toggleProviderExpanded: (providerId: string) => void
  removeEntry: (kind: 'provider', id: string) => void
  setEntryField: (kind: 'provider', id: string, field: string, value: JsonLike) => void
  providerApiKeyReveal: Record<string, boolean>
  getProviderOption: (providerId: string, key: string) => string | number | boolean | null | undefined
  setProviderOption: (providerId: string, key: string, value: JsonLike) => void
  toggleProviderApiKey: (providerId: string) => void
  copyProviderApiKey: (providerId: string) => void
  getProviderTimeoutMode: (providerId: string) => string
  setProviderTimeoutMode: (providerId: string, mode: string) => void
  getProviderTimeoutValue: (providerId: string) => string
  setProviderTimeoutValue: (providerId: string, value: string) => void
  providerRequiredEnv?: (providerId: string) => string[]
  modelSlugOptions?: string[]
}

const props = defineProps<{ providerId: string; provider: ProviderViewModel }>()
const ctx = useOpencodeConfigPanelContext<ProviderCardContext>()

const { t } = useI18n()

const {
  isProviderExpanded,
  toggleProviderExpanded,
  removeEntry,
  setEntryField,
  providerApiKeyReveal,
  getProviderOption,
  setProviderOption,
  toggleProviderApiKey,
  copyProviderApiKey,
  getProviderTimeoutMode,
  setProviderTimeoutMode,
  getProviderTimeoutValue,
  setProviderTimeoutValue,
} = ctx

const providerId = props.providerId
const provider = props.provider

const timeoutModePickerOptions = computed<PickerOption[]>(() => [
  { value: 'default', label: t('settings.opencodeConfig.sections.providers.providerCard.timeoutModes.default') },
  { value: 'disabled', label: t('settings.opencodeConfig.sections.providers.providerCard.timeoutModes.disabled') },
  { value: 'custom', label: t('settings.opencodeConfig.sections.providers.providerCard.timeoutModes.custom') },
])

const providerEnvSuggestions = computed(() => {
  const out = new Set<string>()
  const required = typeof ctx.providerRequiredEnv === 'function' ? ctx.providerRequiredEnv(providerId) : []
  if (Array.isArray(required)) {
    for (const item of required) {
      const value = String(item || '').trim()
      if (value) out.add(value)
    }
  }
  const local = Array.isArray(provider?.env) ? provider.env : []
  for (const item of local) {
    const value = String(item || '').trim()
    if (value) out.add(value)
  }
  return Array.from(out)
})

const providerModelSuggestions = computed(() => {
  const list = Array.isArray(ctx.modelSlugOptions) ? ctx.modelSlugOptions : []
  return list.map((item) => String(item || '').trim()).filter(Boolean)
})
</script>

<template>
  <div class="rounded-md border border-border p-3 space-y-4">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-1 min-w-0">
        <Tooltip>
          <Button
            size="icon"
            variant="ghost"
            class="h-8 w-8"
            :title="
              isProviderExpanded(providerId)
                ? t('settings.opencodeConfig.sections.common.collapse')
                : t('settings.opencodeConfig.sections.common.expand')
            "
            :aria-label="
              isProviderExpanded(providerId)
                ? t('settings.opencodeConfig.sections.providers.providerCard.actions.collapseProviderAria')
                : t('settings.opencodeConfig.sections.providers.providerCard.actions.expandProviderAria')
            "
            @click="toggleProviderExpanded(providerId)"
          >
            <RiArrowUpSLine v-if="isProviderExpanded(providerId)" class="h-4 w-4" />
            <RiArrowDownSLine v-else class="h-4 w-4" />
          </Button>
          <template #content>{{
            isProviderExpanded(providerId)
              ? t('settings.opencodeConfig.sections.common.collapse')
              : t('settings.opencodeConfig.sections.common.expand')
          }}</template>
        </Tooltip>
        <div class="font-mono text-sm font-semibold break-all">{{ providerId }}</div>
      </div>
      <Tooltip>
        <Button
          size="icon"
          variant="ghost-destructive"
          class="h-8 w-8"
          :title="t('common.remove')"
          :aria-label="t('settings.opencodeConfig.sections.providers.providerCard.actions.removeProviderAria')"
          @click="removeEntry('provider', providerId)"
        >
          <RiDeleteBinLine class="h-4 w-4" />
        </Button>
        <template #content>{{ t('common.remove') }}</template>
      </Tooltip>
    </div>

    <div v-if="isProviderExpanded(providerId)" class="space-y-4">
      <ProviderStatusChips :provider-id="providerId" />

      <div class="grid gap-4 lg:grid-cols-3">
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.providerCard.fields.displayName') }}</span>
          <Input
            :model-value="provider.name || ''"
            @update:model-value="(v) => setEntryField('provider', providerId, 'name', v)"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.providerCard.fields.apiBaseUrl') }}</span>
          <Input
            :model-value="provider.api || ''"
            @update:model-value="(v) => setEntryField('provider', providerId, 'api', v)"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.providerCard.fields.idOverride') }}</span>
          <Input
            :model-value="provider.id || ''"
            @update:model-value="(v) => setEntryField('provider', providerId, 'id', v)"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.providerCard.fields.npmPackage') }}</span>
          <Input
            :model-value="provider.npm || ''"
            @update:model-value="(v) => setEntryField('provider', providerId, 'npm', v)"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.providerCard.fields.environmentVariables') }}</span>
          <StringListEditor
            :model-value="provider.env || []"
            :suggestions="providerEnvSuggestions"
            :panel-title="t('settings.opencodeConfig.sections.providers.providerCard.fields.environmentVariables')"
            :placeholder="t('settings.opencodeConfig.sections.providers.providerCard.placeholders.envVar')"
            split-mode="lines"
            :advanced-rows="3"
            :advanced-placeholder="t('settings.opencodeConfig.sections.providers.providerCard.placeholders.envVar')"
            @update:model-value="(v) => setEntryField('provider', providerId, 'env', v)"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.providerCard.fields.whitelistModels') }}</span>
          <StringListEditor
            :model-value="provider.whitelist || []"
            :suggestions="providerModelSuggestions"
            :panel-title="t('settings.opencodeConfig.sections.providers.providerCard.fields.modelSlugs')"
            :placeholder="t('settings.opencodeConfig.sections.providers.providerCard.placeholders.modelSlugExampleA')"
            split-mode="tags"
            :advanced-rows="3"
            :advanced-placeholder="t('settings.opencodeConfig.sections.providers.providerCard.placeholders.modelSlugExampleA')"
            @update:model-value="(v) => setEntryField('provider', providerId, 'whitelist', v)"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.providerCard.fields.blacklistModels') }}</span>
          <StringListEditor
            :model-value="provider.blacklist || []"
            :suggestions="providerModelSuggestions"
            :panel-title="t('settings.opencodeConfig.sections.providers.providerCard.fields.modelSlugs')"
            :placeholder="t('settings.opencodeConfig.sections.providers.providerCard.placeholders.modelSlugExampleB')"
            split-mode="tags"
            :advanced-rows="3"
            :advanced-placeholder="t('settings.opencodeConfig.sections.providers.providerCard.placeholders.modelSlugExampleB')"
            @update:model-value="(v) => setEntryField('provider', providerId, 'blacklist', v)"
          />
        </label>
      </div>

      <div class="grid gap-3">
        <div class="text-sm font-semibold">{{ t('settings.opencodeConfig.sections.providers.providerCard.sections.optionsTitle') }}</div>
        <div class="grid gap-4 lg:grid-cols-3">
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.providerCard.fields.apiKey') }}</span>
            <div class="flex items-center gap-2">
              <Input
                :type="providerApiKeyReveal[providerId] ? 'text' : 'password'"
                :model-value="String(getProviderOption(providerId, 'apiKey') || '')"
                @update:model-value="(v) => setProviderOption(providerId, 'apiKey', v)"
                :placeholder="t('common.notSet')"
              />
              <Button size="sm" variant="ghost" @click="toggleProviderApiKey(providerId)">
                {{ providerApiKeyReveal[providerId] ? t('common.hide') : t('common.reveal') }}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                @click="copyProviderApiKey(providerId)"
                :disabled="!String(getProviderOption(providerId, 'apiKey') || '').trim()"
              >
                {{ t('common.copy') }}
              </Button>
            </div>
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.providerCard.fields.baseUrl') }}</span>
            <Input
              :model-value="String(getProviderOption(providerId, 'baseURL') || '')"
              @update:model-value="(v) => setProviderOption(providerId, 'baseURL', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.providerCard.fields.enterpriseUrl') }}</span>
            <Input
              :model-value="String(getProviderOption(providerId, 'enterpriseUrl') || '')"
              @update:model-value="(v) => setProviderOption(providerId, 'enterpriseUrl', v)"
            />
          </label>
          <label class="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              :checked="getProviderOption(providerId, 'setCacheKey') === true"
              @change="(e) => setProviderOption(providerId, 'setCacheKey', (e.target as HTMLInputElement).checked)"
            />
            {{ t('settings.opencodeConfig.sections.providers.providerCard.fields.setCacheKey') }}
          </label>
          <label class="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              :checked="getProviderOption(providerId, 'includeUsage') === true"
              @change="(e) => setProviderOption(providerId, 'includeUsage', (e.target as HTMLInputElement).checked)"
            />
            {{ t('settings.opencodeConfig.sections.providers.providerCard.fields.includeUsage') }}
          </label>
          <label class="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              :checked="getProviderOption(providerId, 'useCompletionUrls') === true"
              @change="
                (e) => setProviderOption(providerId, 'useCompletionUrls', (e.target as HTMLInputElement).checked)
              "
            />
            {{ t('settings.opencodeConfig.sections.providers.providerCard.fields.useCompletionUrls') }}
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.providerCard.fields.timeout') }}</span>
            <OptionPicker
              :model-value="getProviderTimeoutMode(providerId)"
              @update:model-value="(v) => setProviderTimeoutMode(providerId, String(v || ''))"
              :options="timeoutModePickerOptions"
              :title="t('settings.opencodeConfig.sections.providers.providerCard.fields.timeout')"
              :search-placeholder="t('settings.opencodeConfig.sections.providers.providerCard.search.searchTimeoutModes')"
              :include-empty="false"
            />
          </label>
          <label v-if="getProviderTimeoutMode(providerId) === 'custom'" class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.providerCard.fields.timeoutMs') }}</span>
            <input
              :value="getProviderTimeoutValue(providerId)"
              @input="(e) => setProviderTimeoutValue(providerId, (e.target as HTMLInputElement).value)"
              type="number"
              min="1"
              class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            />
          </label>
        </div>

        <div class="grid gap-4 lg:grid-cols-3">
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.providerCard.fields.region') }}</span>
            <Input
              :model-value="String(getProviderOption(providerId, 'region') || '')"
              @update:model-value="(v) => setProviderOption(providerId, 'region', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.providerCard.fields.profile') }}</span>
            <Input
              :model-value="String(getProviderOption(providerId, 'profile') || '')"
              @update:model-value="(v) => setProviderOption(providerId, 'profile', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.providerCard.fields.endpoint') }}</span>
            <Input
              :model-value="String(getProviderOption(providerId, 'endpoint') || '')"
              @update:model-value="(v) => setProviderOption(providerId, 'endpoint', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.providerCard.fields.project') }}</span>
            <Input
              :model-value="String(getProviderOption(providerId, 'project') || '')"
              @update:model-value="(v) => setProviderOption(providerId, 'project', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.providerCard.fields.location') }}</span>
            <Input
              :model-value="String(getProviderOption(providerId, 'location') || '')"
              @update:model-value="(v) => setProviderOption(providerId, 'location', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.providerCard.fields.deploymentId') }}</span>
            <Input
              :model-value="String(getProviderOption(providerId, 'deploymentId') || '')"
              @update:model-value="(v) => setProviderOption(providerId, 'deploymentId', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.providerCard.fields.resourceGroup') }}</span>
            <Input
              :model-value="String(getProviderOption(providerId, 'resourceGroup') || '')"
              @update:model-value="(v) => setProviderOption(providerId, 'resourceGroup', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.providerCard.fields.gitlabInstanceUrl') }}</span>
            <Input
              :model-value="String(getProviderOption(providerId, 'instanceUrl') || '')"
              @update:model-value="(v) => setProviderOption(providerId, 'instanceUrl', v)"
            />
          </label>
        </div>

        <ProviderMapsEditor :provider-id="providerId" />
      </div>
    </div>

    <ProviderModelsEditor :provider-id="providerId" />
  </div>
</template>

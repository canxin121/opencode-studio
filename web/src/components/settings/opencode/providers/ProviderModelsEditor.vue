<script setup lang="ts">
import { computed } from 'vue'
import { RiAddLine, RiArrowDownSLine, RiArrowUpSLine, RiCheckLine, RiDeleteBinLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import OptionPicker, { type PickerOption } from '@/components/ui/OptionPicker.vue'
import Tooltip from '@/components/ui/Tooltip.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

const props = defineProps<{ providerId: string }>()

const { t } = useI18n()

const modelStatusPickerOptions = computed<PickerOption[]>(() => [
  { value: 'default', label: t('settings.opencodeConfig.sections.providers.modelsEditor.options.status.default') },
  { value: 'alpha', label: t('settings.opencodeConfig.sections.providers.modelsEditor.options.status.alpha') },
  { value: 'beta', label: t('settings.opencodeConfig.sections.providers.modelsEditor.options.status.beta') },
  { value: 'deprecated', label: t('settings.opencodeConfig.sections.providers.modelsEditor.options.status.deprecated') },
])

const modelInterleavedPickerOptions = computed<PickerOption[]>(() => [
  {
    value: 'default',
    label: t('settings.opencodeConfig.sections.providers.modelsEditor.options.interleaved.default'),
  },
  { value: 'true', label: t('settings.opencodeConfig.sections.providers.modelsEditor.options.interleaved.true') },
  {
    value: 'reasoning_content',
    label: t('settings.opencodeConfig.sections.providers.modelsEditor.options.interleaved.reasoningContent'),
  },
  {
    value: 'reasoning_details',
    label: t('settings.opencodeConfig.sections.providers.modelsEditor.options.interleaved.reasoningDetails'),
  },
])

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue } | undefined
type JsonMap = Record<string, JsonValue>
type VariantConfig = JsonMap & {
  disabled?: boolean
}
type ModelConfig = JsonMap & {
  id?: string
  name?: string
  family?: string
  release_date?: string
  status?: string
  attachment?: boolean
  reasoning?: boolean
  temperature?: boolean
  tool_call?: boolean
  experimental?: boolean
  cost?: {
    input?: JsonValue
    output?: JsonValue
    cache_read?: JsonValue
    cache_write?: JsonValue
    context_over_200k?: {
      input?: JsonValue
      output?: JsonValue
      cache_read?: JsonValue
      cache_write?: JsonValue
    }
  }
  limit?: {
    context?: JsonValue
    input?: JsonValue
    output?: JsonValue
  }
  provider?: { npm?: string }
  options?: JsonValue
  headers?: JsonValue
  variants?: Record<string, VariantConfig>
}

type ProviderModelsContext = {
  modalities: string[]
  newProviderModelName: Record<string, string>
  addProviderModel: (providerId: string) => void
  providerModels: (providerId: string, ensure?: boolean) => Record<string, ModelConfig>
  isModelExpanded: (providerId: string, modelId: string) => boolean
  toggleModelExpanded: (providerId: string, modelId: string) => void
  removeProviderModel: (providerId: string, modelId: string) => void
  setModelField: (providerId: string, modelId: string, field: string, value: JsonValue) => void
  getModelInterleaved: (providerId: string, modelId: string) => string
  setModelInterleaved: (providerId: string, modelId: string, value: string) => void
  updateModelCost: (providerId: string, modelId: string, key: string, value: string) => void
  updateModelCostOver: (providerId: string, modelId: string, key: string, value: string) => void
  updateModelLimit: (providerId: string, modelId: string, key: string, value: string) => void
  modelModalities: (providerId: string, modelId: string, side: 'input' | 'output') => string[]
  toggleModelModality: (providerId: string, modelId: string, side: 'input' | 'output', modality: string) => void
  ensureJsonBuffer: (
    id: string,
    get: () => JsonValue,
    set: (value: JsonValue) => void,
    fallback: JsonValue,
  ) => { text: string; error: string | null }
  applyJsonBuffer: (id: string) => void
  modelVariants: (providerId: string, modelId: string, ensure?: boolean) => Record<string, VariantConfig>
  getNewVariantName: (providerId: string, modelId: string) => string
  setNewVariantName: (providerId: string, modelId: string, value: string) => void
  addVariant: (providerId: string, modelId: string) => void
  removeVariant: (providerId: string, modelId: string, variantId: string) => void
  variantExtra: (providerId: string, modelId: string, variantId: string) => JsonMap
  setVariantExtra: (providerId: string, modelId: string, variantId: string, value: JsonValue) => void
}
const ctx = useOpencodeConfigPanelContext<ProviderModelsContext>()

const {
  modalities,
  newProviderModelName,
  addProviderModel,
  providerModels,
  isModelExpanded,
  toggleModelExpanded,
  removeProviderModel,
  setModelField,
  getModelInterleaved,
  setModelInterleaved,
  updateModelCost,
  updateModelCostOver,
  updateModelLimit,
  modelModalities,
  toggleModelModality,
  ensureJsonBuffer,
  applyJsonBuffer,
  modelVariants,
  getNewVariantName,
  setNewVariantName,
  addVariant,
  removeVariant,
  variantExtra,
  setVariantExtra,
} = ctx

// Keep `providerId` local so the template stays close to the original.
const providerId = props.providerId
</script>

<template>
  <div class="grid gap-3">
    <div class="flex items-center justify-between">
      <div class="text-sm font-semibold">{{ t('settings.opencodeConfig.sections.providers.modelsEditor.title') }}</div>
      <div class="flex items-center gap-2">
        <Input
          v-model="newProviderModelName[providerId]"
          :placeholder="t('settings.opencodeConfig.sections.providers.modelsEditor.placeholders.modelId')"
          class="max-w-xs"
        />
        <Tooltip>
          <Button
            size="icon"
            variant="outline"
            class="h-9 w-9"
            :title="t('settings.opencodeConfig.sections.providers.modelsEditor.actions.addModel')"
            :aria-label="t('settings.opencodeConfig.sections.providers.modelsEditor.actions.addModel')"
            @click="addProviderModel(providerId)"
          >
            <RiAddLine class="h-4 w-4" />
          </Button>
          <template #content>{{ t('settings.opencodeConfig.sections.providers.modelsEditor.actions.addModel') }}</template>
        </Tooltip>
      </div>
    </div>

    <div v-if="Object.keys(providerModels(providerId, false)).length === 0" class="text-xs text-muted-foreground">
      {{ t('settings.opencodeConfig.sections.providers.modelsEditor.empty.noModels') }}
    </div>
    <div
      v-for="(modelConfig, modelId) in providerModels(providerId, false)"
      :key="modelId"
      class="rounded-md border border-border p-3 space-y-4"
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1 min-w-0">
          <Tooltip>
            <Button
              size="icon"
              variant="ghost"
              class="h-8 w-8"
              :title="
                isModelExpanded(providerId, modelId as string)
                  ? t('settings.opencodeConfig.sections.common.collapse')
                  : t('settings.opencodeConfig.sections.common.expand')
              "
              :aria-label="
                isModelExpanded(providerId, modelId as string)
                  ? t('settings.opencodeConfig.sections.providers.modelsEditor.actions.collapseModelAria')
                  : t('settings.opencodeConfig.sections.providers.modelsEditor.actions.expandModelAria')
              "
              @click="toggleModelExpanded(providerId, modelId as string)"
            >
              <RiArrowUpSLine v-if="isModelExpanded(providerId, modelId as string)" class="h-4 w-4" />
              <RiArrowDownSLine v-else class="h-4 w-4" />
            </Button>
            <template #content>{{
              isModelExpanded(providerId, modelId as string)
                ? t('settings.opencodeConfig.sections.common.collapse')
                : t('settings.opencodeConfig.sections.common.expand')
            }}</template>
          </Tooltip>
          <div class="font-mono text-sm break-all">{{ modelId }}</div>
        </div>
        <Tooltip>
          <Button
            size="icon"
            variant="ghost-destructive"
            class="h-8 w-8"
            :title="t('common.remove')"
            :aria-label="t('settings.opencodeConfig.sections.providers.modelsEditor.actions.removeModelAria')"
            @click="removeProviderModel(providerId, modelId as string)"
          >
            <RiDeleteBinLine class="h-4 w-4" />
          </Button>
          <template #content>{{ t('common.remove') }}</template>
        </Tooltip>
      </div>

      <div v-if="isModelExpanded(providerId, modelId as string)" class="space-y-4">
        <div class="grid gap-4 lg:grid-cols-3">
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.modelsEditor.fields.modelIdOverride') }}</span>
            <Input
              :model-value="modelConfig.id || ''"
              @update:model-value="(v) => setModelField(providerId, modelId as string, 'id', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.modelsEditor.fields.displayName') }}</span>
            <Input
              :model-value="modelConfig.name || ''"
              @update:model-value="(v) => setModelField(providerId, modelId as string, 'name', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.modelsEditor.fields.family') }}</span>
            <Input
              :model-value="modelConfig.family || ''"
              @update:model-value="(v) => setModelField(providerId, modelId as string, 'family', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.modelsEditor.fields.releaseDate') }}</span>
            <Input
              :model-value="modelConfig.release_date || ''"
              @update:model-value="(v) => setModelField(providerId, modelId as string, 'release_date', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.modelsEditor.fields.status') }}</span>
            <OptionPicker
              :model-value="modelConfig.status || 'default'"
              @update:model-value="
                (v) =>
                  setModelField(
                    providerId,
                    modelId as string,
                    'status',
                    String(v || '') === 'default' ? null : String(v || ''),
                  )
              "
              :options="modelStatusPickerOptions"
              :title="t('settings.opencodeConfig.sections.providers.modelsEditor.fields.status')"
              :search-placeholder="t('settings.opencodeConfig.sections.providers.modelsEditor.search.searchStatuses')"
              :include-empty="false"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.modelsEditor.fields.interleaved') }}</span>
            <OptionPicker
              :model-value="getModelInterleaved(providerId, modelId as string)"
              @update:model-value="(v) => setModelInterleaved(providerId, modelId as string, String(v || ''))"
              :options="modelInterleavedPickerOptions"
              :title="t('settings.opencodeConfig.sections.providers.modelsEditor.fields.interleaved')"
              :search-placeholder="t('settings.opencodeConfig.sections.providers.modelsEditor.search.searchModes')"
              :include-empty="false"
            />
          </label>
        </div>

        <div class="grid gap-2">
          <div class="flex flex-wrap gap-4">
            <label class="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                :checked="modelConfig.attachment === true"
                @change="
                  (e) =>
                    setModelField(providerId, modelId as string, 'attachment', (e.target as HTMLInputElement).checked)
                "
              />
              {{ t('settings.opencodeConfig.sections.providers.modelsEditor.capabilities.attachment') }}
            </label>
            <label class="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                :checked="modelConfig.reasoning === true"
                @change="
                  (e) =>
                    setModelField(providerId, modelId as string, 'reasoning', (e.target as HTMLInputElement).checked)
                "
              />
              {{ t('settings.opencodeConfig.sections.providers.modelsEditor.capabilities.reasoning') }}
            </label>
            <label class="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                :checked="modelConfig.temperature === true"
                @change="
                  (e) =>
                    setModelField(providerId, modelId as string, 'temperature', (e.target as HTMLInputElement).checked)
                "
              />
              {{ t('settings.opencodeConfig.sections.providers.modelsEditor.capabilities.temperature') }}
            </label>
            <label class="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                :checked="modelConfig.tool_call === true"
                @change="
                  (e) =>
                    setModelField(providerId, modelId as string, 'tool_call', (e.target as HTMLInputElement).checked)
                "
              />
              {{ t('settings.opencodeConfig.sections.providers.modelsEditor.capabilities.toolCall') }}
            </label>
            <label class="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                :checked="modelConfig.experimental === true"
                @change="
                  (e) =>
                    setModelField(providerId, modelId as string, 'experimental', (e.target as HTMLInputElement).checked)
                "
              />
              {{ t('settings.opencodeConfig.sections.providers.modelsEditor.capabilities.experimental') }}
            </label>
          </div>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <div class="grid gap-2">
            <div class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.modelsEditor.cost.title') }}</div>
            <div class="grid gap-2 lg:grid-cols-2">
              <input
                :value="modelConfig.cost?.input ?? ''"
                @input="
                  (e) => updateModelCost(providerId, modelId as string, 'input', (e.target as HTMLInputElement).value)
                "
                type="number"
                step="0.000001"
                class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                :placeholder="t('settings.opencodeConfig.sections.providers.modelsEditor.placeholders.input')"
              />
              <input
                :value="modelConfig.cost?.output ?? ''"
                @input="
                  (e) => updateModelCost(providerId, modelId as string, 'output', (e.target as HTMLInputElement).value)
                "
                type="number"
                step="0.000001"
                class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                :placeholder="t('settings.opencodeConfig.sections.providers.modelsEditor.placeholders.output')"
              />
              <input
                :value="modelConfig.cost?.cache_read ?? ''"
                @input="
                  (e) =>
                    updateModelCost(providerId, modelId as string, 'cache_read', (e.target as HTMLInputElement).value)
                "
                type="number"
                step="0.000001"
                class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                :placeholder="t('settings.opencodeConfig.sections.providers.modelsEditor.placeholders.cacheRead')"
              />
              <input
                :value="modelConfig.cost?.cache_write ?? ''"
                @input="
                  (e) =>
                    updateModelCost(providerId, modelId as string, 'cache_write', (e.target as HTMLInputElement).value)
                "
                type="number"
                step="0.000001"
                class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                :placeholder="t('settings.opencodeConfig.sections.providers.modelsEditor.placeholders.cacheWrite')"
              />
            </div>
            <div class="grid gap-2 pt-2">
              <div class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.modelsEditor.cost.over200k') }}</div>
              <div class="grid gap-2 lg:grid-cols-2">
                <input
                  :value="modelConfig.cost?.context_over_200k?.input ?? ''"
                  @input="
                    (e) =>
                      updateModelCostOver(providerId, modelId as string, 'input', (e.target as HTMLInputElement).value)
                  "
                  type="number"
                  step="0.000001"
                  class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  :placeholder="t('settings.opencodeConfig.sections.providers.modelsEditor.placeholders.input')"
                />
                <input
                  :value="modelConfig.cost?.context_over_200k?.output ?? ''"
                  @input="
                    (e) =>
                      updateModelCostOver(providerId, modelId as string, 'output', (e.target as HTMLInputElement).value)
                  "
                  type="number"
                  step="0.000001"
                  class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  :placeholder="t('settings.opencodeConfig.sections.providers.modelsEditor.placeholders.output')"
                />
                <input
                  :value="modelConfig.cost?.context_over_200k?.cache_read ?? ''"
                  @input="
                    (e) =>
                      updateModelCostOver(
                        providerId,
                        modelId as string,
                        'cache_read',
                        (e.target as HTMLInputElement).value,
                      )
                  "
                  type="number"
                  step="0.000001"
                  class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  :placeholder="t('settings.opencodeConfig.sections.providers.modelsEditor.placeholders.cacheRead')"
                />
                <input
                  :value="modelConfig.cost?.context_over_200k?.cache_write ?? ''"
                  @input="
                    (e) =>
                      updateModelCostOver(
                        providerId,
                        modelId as string,
                        'cache_write',
                        (e.target as HTMLInputElement).value,
                      )
                  "
                  type="number"
                  step="0.000001"
                  class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  :placeholder="t('settings.opencodeConfig.sections.providers.modelsEditor.placeholders.cacheWrite')"
                />
              </div>
            </div>
          </div>
          <div class="grid gap-2">
            <div class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.modelsEditor.limits.title') }}</div>
            <div class="grid gap-2 lg:grid-cols-3">
              <input
                :value="modelConfig.limit?.context ?? ''"
                @input="
                  (e) =>
                    updateModelLimit(providerId, modelId as string, 'context', (e.target as HTMLInputElement).value)
                "
                type="number"
                step="1"
                class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                :placeholder="t('settings.opencodeConfig.sections.providers.modelsEditor.placeholders.context')"
              />
              <input
                :value="modelConfig.limit?.input ?? ''"
                @input="
                  (e) => updateModelLimit(providerId, modelId as string, 'input', (e.target as HTMLInputElement).value)
                "
                type="number"
                step="1"
                class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                :placeholder="t('settings.opencodeConfig.sections.providers.modelsEditor.placeholders.input')"
              />
              <input
                :value="modelConfig.limit?.output ?? ''"
                @input="
                  (e) => updateModelLimit(providerId, modelId as string, 'output', (e.target as HTMLInputElement).value)
                "
                type="number"
                step="1"
                class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                :placeholder="t('settings.opencodeConfig.sections.providers.modelsEditor.placeholders.output')"
              />
            </div>
          </div>
        </div>

        <div class="grid gap-2">
          <div class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.modelsEditor.modalities.title') }}</div>
          <div class="grid gap-3 lg:grid-cols-2">
            <div class="grid gap-2">
              <div class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.modelsEditor.modalities.input') }}</div>
              <div class="flex flex-wrap gap-3">
                <label
                  v-for="modality in modalities"
                  :key="`in-${providerId}-${modelId}-${modality}`"
                  class="inline-flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    :checked="modelModalities(providerId, modelId as string, 'input').includes(modality)"
                    @change="() => toggleModelModality(providerId, modelId as string, 'input', modality)"
                  />
                  {{ modality }}
                </label>
              </div>
            </div>
            <div class="grid gap-2">
              <div class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.modelsEditor.modalities.output') }}</div>
              <div class="flex flex-wrap gap-3">
                <label
                  v-for="modality in modalities"
                  :key="`out-${providerId}-${modelId}-${modality}`"
                  class="inline-flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    :checked="modelModalities(providerId, modelId as string, 'output').includes(modality)"
                    @change="() => toggleModelModality(providerId, modelId as string, 'output', modality)"
                  />
                  {{ modality }}
                </label>
              </div>
            </div>
          </div>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <div class="grid gap-2">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.modelsEditor.json.modelOptions') }}</span>
            <textarea
              v-model="
                ensureJsonBuffer(
                  `model:${providerId}:${modelId}:options`,
                  () => modelConfig.options,
                  (val: JsonValue) => setModelField(providerId, modelId as string, 'options', val),
                  {},
                ).text
              "
              rows="6"
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
                  @click="applyJsonBuffer(`model:${providerId}:${modelId}:options`)"
                >
                  <RiCheckLine class="h-4 w-4" />
                </Button>
                <template #content>{{ t('common.apply') }}</template>
              </Tooltip>
              <span
                v-if="
                  ensureJsonBuffer(
                    `model:${providerId}:${modelId}:options`,
                    () => modelConfig.options,
                    (val: JsonValue) => setModelField(providerId, modelId as string, 'options', val),
                    {},
                  ).error
                "
                class="text-xs text-destructive"
              >
                {{
                  ensureJsonBuffer(
                    `model:${providerId}:${modelId}:options`,
                    () => modelConfig.options,
                    (val: JsonValue) => setModelField(providerId, modelId as string, 'options', val),
                    {},
                  ).error
                }}
              </span>
            </div>
          </div>
          <div class="grid gap-2">
            <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.modelsEditor.json.modelHeaders') }}</span>
            <textarea
              v-model="
                ensureJsonBuffer(
                  `model:${providerId}:${modelId}:headers`,
                  () => modelConfig.headers,
                  (val: JsonValue) => setModelField(providerId, modelId as string, 'headers', val),
                  {},
                ).text
              "
              rows="6"
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
                  @click="applyJsonBuffer(`model:${providerId}:${modelId}:headers`)"
                >
                  <RiCheckLine class="h-4 w-4" />
                </Button>
                <template #content>{{ t('common.apply') }}</template>
              </Tooltip>
              <span
                v-if="
                  ensureJsonBuffer(
                    `model:${providerId}:${modelId}:headers`,
                    () => modelConfig.headers,
                    (val: JsonValue) => setModelField(providerId, modelId as string, 'headers', val),
                    {},
                  ).error
                "
                class="text-xs text-destructive"
              >
                {{
                  ensureJsonBuffer(
                    `model:${providerId}:${modelId}:headers`,
                    () => modelConfig.headers,
                    (val: JsonValue) => setModelField(providerId, modelId as string, 'headers', val),
                    {},
                  ).error
                }}
              </span>
            </div>
          </div>
        </div>

        <div class="grid gap-2">
          <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.modelsEditor.fields.providerOverrideNpm') }}</span>
          <Input
            :model-value="modelConfig.provider?.npm || ''"
            @update:model-value="(v) => setModelField(providerId, modelId as string, 'provider', v ? { npm: v } : null)"
          />
        </div>

        <div class="grid gap-3">
          <div class="flex items-center justify-between">
            <div class="text-sm font-semibold">{{ t('settings.opencodeConfig.sections.providers.modelsEditor.variants.title') }}</div>
            <div class="flex items-center gap-2">
              <Input
                :model-value="getNewVariantName(providerId, modelId as string)"
                @update:model-value="(v) => setNewVariantName(providerId, modelId as string, String(v))"
                :placeholder="t('settings.opencodeConfig.sections.providers.modelsEditor.variants.placeholders.variantId')"
                class="max-w-xs"
              />
              <Tooltip>
                <Button
                  size="icon"
                  variant="outline"
                  class="h-9 w-9"
                  :title="t('settings.opencodeConfig.sections.providers.modelsEditor.variants.actions.addVariant')"
                  :aria-label="t('settings.opencodeConfig.sections.providers.modelsEditor.variants.actions.addVariant')"
                  @click="addVariant(providerId, modelId as string)"
                >
                  <RiAddLine class="h-4 w-4" />
                </Button>
                <template #content>{{ t('settings.opencodeConfig.sections.providers.modelsEditor.variants.actions.addVariant') }}</template>
              </Tooltip>
            </div>
          </div>
          <div
            v-if="Object.keys(modelVariants(providerId, modelId as string)).length === 0"
            class="text-xs text-muted-foreground"
          >
            {{ t('settings.opencodeConfig.sections.providers.modelsEditor.variants.empty') }}
          </div>
          <div
            v-for="(variantConfig, variantId) in modelVariants(providerId, modelId as string)"
            :key="variantId"
            class="rounded-md border border-border p-3 space-y-3"
          >
            <div class="flex items-center justify-between">
              <div class="font-mono text-sm break-all">{{ variantId }}</div>
              <Tooltip>
                <Button
                  size="icon"
                  variant="ghost-destructive"
                  class="h-8 w-8"
                  :title="t('common.remove')"
                  :aria-label="t('settings.opencodeConfig.sections.providers.modelsEditor.variants.actions.removeVariantAria')"
                  @click="removeVariant(providerId, modelId as string, variantId as string)"
                >
                  <RiDeleteBinLine class="h-4 w-4" />
                </Button>
                <template #content>{{ t('common.remove') }}</template>
              </Tooltip>
            </div>
            <label class="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                :checked="variantConfig.disabled === true"
                @change="
                  (e) =>
                    setModelField(providerId, modelId as string, 'variants', {
                      ...modelVariants(providerId, modelId as string),
                      [variantId]: {
                        ...variantConfig,
                        disabled: (e.target as HTMLInputElement).checked,
                      },
                    })
                "
              />
              {{ t('settings.opencodeConfig.sections.common.disabled') }}
            </label>
            <div class="grid gap-2">
              <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.providers.modelsEditor.json.variantExtra') }}</span>
              <textarea
                v-model="
                  ensureJsonBuffer(
                    `variant:${providerId}:${modelId}:${variantId}:extra`,
                    () => variantExtra(providerId, modelId as string, variantId as string),
                    (val: JsonValue) => setVariantExtra(providerId, modelId as string, variantId as string, val),
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
                    @click="applyJsonBuffer(`variant:${providerId}:${modelId}:${variantId}:extra`)"
                  >
                    <RiCheckLine class="h-4 w-4" />
                  </Button>
                  <template #content>{{ t('common.apply') }}</template>
                </Tooltip>
                <span
                  v-if="
                    ensureJsonBuffer(
                      `variant:${providerId}:${modelId}:${variantId}:extra`,
                      () => variantExtra(providerId, modelId as string, variantId as string),
                      (val: JsonValue) => setVariantExtra(providerId, modelId as string, variantId as string, val),
                      {},
                    ).error
                  "
                  class="text-xs text-destructive"
                >
                  {{
                    ensureJsonBuffer(
                      `variant:${providerId}:${modelId}:${variantId}:extra`,
                      () => variantExtra(providerId, modelId as string, variantId as string),
                      (val: JsonValue) => setVariantExtra(providerId, modelId as string, variantId as string, val),
                      {},
                    ).error
                  }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

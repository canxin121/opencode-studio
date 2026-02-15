<script setup lang="ts">
import { RiAddLine, RiArrowDownSLine, RiArrowUpSLine, RiCheckLine, RiDeleteBinLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Tooltip from '@/components/ui/Tooltip.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

const props = defineProps<{ providerId: string }>()

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
      <div class="text-sm font-semibold">Models</div>
      <div class="flex items-center gap-2">
        <Input v-model="newProviderModelName[providerId]" placeholder="Model id" class="max-w-xs" />
        <Tooltip>
          <Button
            size="icon"
            variant="outline"
            class="h-9 w-9"
            title="Add model"
            aria-label="Add model"
            @click="addProviderModel(providerId)"
          >
            <RiAddLine class="h-4 w-4" />
          </Button>
          <template #content>Add model</template>
        </Tooltip>
      </div>
    </div>

    <div v-if="Object.keys(providerModels(providerId, false)).length === 0" class="text-xs text-muted-foreground">
      No models configured.
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
              :title="isModelExpanded(providerId, modelId as string) ? 'Collapse' : 'Expand'"
              :aria-label="isModelExpanded(providerId, modelId as string) ? 'Collapse model' : 'Expand model'"
              @click="toggleModelExpanded(providerId, modelId as string)"
            >
              <RiArrowUpSLine v-if="isModelExpanded(providerId, modelId as string)" class="h-4 w-4" />
              <RiArrowDownSLine v-else class="h-4 w-4" />
            </Button>
            <template #content>{{ isModelExpanded(providerId, modelId as string) ? 'Collapse' : 'Expand' }}</template>
          </Tooltip>
          <div class="font-mono text-sm break-all">{{ modelId }}</div>
        </div>
        <Tooltip>
          <Button
            size="icon"
            variant="ghost-destructive"
            class="h-8 w-8"
            title="Remove"
            aria-label="Remove model"
            @click="removeProviderModel(providerId, modelId as string)"
          >
            <RiDeleteBinLine class="h-4 w-4" />
          </Button>
          <template #content>Remove</template>
        </Tooltip>
      </div>

      <div v-if="isModelExpanded(providerId, modelId as string)" class="space-y-4">
        <div class="grid gap-4 lg:grid-cols-3">
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Model ID override</span>
            <Input
              :model-value="modelConfig.id || ''"
              @update:model-value="(v) => setModelField(providerId, modelId as string, 'id', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Display name</span>
            <Input
              :model-value="modelConfig.name || ''"
              @update:model-value="(v) => setModelField(providerId, modelId as string, 'name', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Family</span>
            <Input
              :model-value="modelConfig.family || ''"
              @update:model-value="(v) => setModelField(providerId, modelId as string, 'family', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Release date</span>
            <Input
              :model-value="modelConfig.release_date || ''"
              @update:model-value="(v) => setModelField(providerId, modelId as string, 'release_date', v)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Status</span>
            <select
              :value="modelConfig.status || 'default'"
              @change="
                (e) =>
                  setModelField(
                    providerId,
                    modelId as string,
                    'status',
                    (e.target as HTMLSelectElement).value === 'default' ? null : (e.target as HTMLSelectElement).value,
                  )
              "
              class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="default">default</option>
              <option value="alpha">alpha</option>
              <option value="beta">beta</option>
              <option value="deprecated">deprecated</option>
            </select>
          </label>
          <label class="grid gap-1">
            <span class="text-xs text-muted-foreground">Interleaved</span>
            <select
              :value="getModelInterleaved(providerId, modelId as string)"
              @change="(e) => setModelInterleaved(providerId, modelId as string, (e.target as HTMLSelectElement).value)"
              class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="default">default</option>
              <option value="true">true</option>
              <option value="reasoning_content">reasoning_content</option>
              <option value="reasoning_details">reasoning_details</option>
            </select>
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
              Attachment
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
              Reasoning
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
              Temperature
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
              Tool call
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
              Experimental
            </label>
          </div>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <div class="grid gap-2">
            <div class="text-xs text-muted-foreground">Cost</div>
            <div class="grid gap-2 lg:grid-cols-2">
              <input
                :value="modelConfig.cost?.input ?? ''"
                @input="
                  (e) => updateModelCost(providerId, modelId as string, 'input', (e.target as HTMLInputElement).value)
                "
                type="number"
                step="0.000001"
                class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                placeholder="input"
              />
              <input
                :value="modelConfig.cost?.output ?? ''"
                @input="
                  (e) => updateModelCost(providerId, modelId as string, 'output', (e.target as HTMLInputElement).value)
                "
                type="number"
                step="0.000001"
                class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                placeholder="output"
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
                placeholder="cache read"
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
                placeholder="cache write"
              />
            </div>
            <div class="grid gap-2 pt-2">
              <div class="text-xs text-muted-foreground">Over 200k</div>
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
                  placeholder="input"
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
                  placeholder="output"
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
                  placeholder="cache read"
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
                  placeholder="cache write"
                />
              </div>
            </div>
          </div>
          <div class="grid gap-2">
            <div class="text-xs text-muted-foreground">Limits</div>
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
                placeholder="context"
              />
              <input
                :value="modelConfig.limit?.input ?? ''"
                @input="
                  (e) => updateModelLimit(providerId, modelId as string, 'input', (e.target as HTMLInputElement).value)
                "
                type="number"
                step="1"
                class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                placeholder="input"
              />
              <input
                :value="modelConfig.limit?.output ?? ''"
                @input="
                  (e) => updateModelLimit(providerId, modelId as string, 'output', (e.target as HTMLInputElement).value)
                "
                type="number"
                step="1"
                class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                placeholder="output"
              />
            </div>
          </div>
        </div>

        <div class="grid gap-2">
          <div class="text-xs text-muted-foreground">Modalities</div>
          <div class="grid gap-3 lg:grid-cols-2">
            <div class="grid gap-2">
              <div class="text-xs text-muted-foreground">Input</div>
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
              <div class="text-xs text-muted-foreground">Output</div>
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
            <span class="text-xs text-muted-foreground">Model options (JSON)</span>
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
                  title="Apply"
                  aria-label="Apply JSON"
                  @click="applyJsonBuffer(`model:${providerId}:${modelId}:options`)"
                >
                  <RiCheckLine class="h-4 w-4" />
                </Button>
                <template #content>Apply</template>
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
            <span class="text-xs text-muted-foreground">Model headers (JSON)</span>
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
                  title="Apply"
                  aria-label="Apply JSON"
                  @click="applyJsonBuffer(`model:${providerId}:${modelId}:headers`)"
                >
                  <RiCheckLine class="h-4 w-4" />
                </Button>
                <template #content>Apply</template>
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
          <span class="text-xs text-muted-foreground">Provider override (npm)</span>
          <Input
            :model-value="modelConfig.provider?.npm || ''"
            @update:model-value="(v) => setModelField(providerId, modelId as string, 'provider', v ? { npm: v } : null)"
          />
        </div>

        <div class="grid gap-3">
          <div class="flex items-center justify-between">
            <div class="text-sm font-semibold">Variants</div>
            <div class="flex items-center gap-2">
              <Input
                :model-value="getNewVariantName(providerId, modelId as string)"
                @update:model-value="(v) => setNewVariantName(providerId, modelId as string, String(v))"
                placeholder="Variant id"
                class="max-w-xs"
              />
              <Tooltip>
                <Button
                  size="icon"
                  variant="outline"
                  class="h-9 w-9"
                  title="Add variant"
                  aria-label="Add variant"
                  @click="addVariant(providerId, modelId as string)"
                >
                  <RiAddLine class="h-4 w-4" />
                </Button>
                <template #content>Add variant</template>
              </Tooltip>
            </div>
          </div>
          <div
            v-if="Object.keys(modelVariants(providerId, modelId as string)).length === 0"
            class="text-xs text-muted-foreground"
          >
            No variants configured.
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
                  title="Remove"
                  aria-label="Remove variant"
                  @click="removeVariant(providerId, modelId as string, variantId as string)"
                >
                  <RiDeleteBinLine class="h-4 w-4" />
                </Button>
                <template #content>Remove</template>
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
              Disabled
            </label>
            <div class="grid gap-2">
              <span class="text-xs text-muted-foreground">Variant extra (JSON)</span>
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
                    title="Apply"
                    aria-label="Apply JSON"
                    @click="applyJsonBuffer(`variant:${providerId}:${modelId}:${variantId}:extra`)"
                  >
                    <RiCheckLine class="h-4 w-4" />
                  </Button>
                  <template #content>Apply</template>
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

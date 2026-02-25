<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import OptionPicker from '@/components/ui/OptionPicker.vue'
import { usePluginSettingsPanel } from '@/components/settings/pluginSettings/usePluginSettingsPanel'

const props = withDefaults(
  defineProps<{
    pluginId?: string | null
    hidePluginSelector?: boolean
  }>(),
  {
    pluginId: '',
    hidePluginSelector: false,
  },
)

const {
  additionalPrimitiveProp,
  addArrayRow,
  addMapRow,
  arrayError,
  arrayItemEnum,
  arrayItemProp,
  arrayItemType,
  booleanValue,
  clearArrayRows,
  clearMapRows,
  commitJsonText,
  dirty,
  enumCurrentToken,
  enumPickerOptions,
  ensureArrayRows,
  ensureMapRows,
  error,
  getDescription,
  getLabel,
  hidePluginSelector,
  isArrayWithPrimitiveItems,
  jsonError,
  jsonTextValue,
  loadPluginConfig,
  loading,
  mapError,
  mapValueEnum,
  mapValueType,
  numberValue,
  onArrayRowInput,
  onArrayRowSelect,
  onBooleanInput,
  onEnumSelect,
  onJsonTextInput,
  onMapKeyInput,
  onMapValueInput,
  onMapValueSelect,
  onNumberInput,
  onStringInput,
  pluginPickerOptions,
  pluginsWithSchema,
  removeArrayRow,
  removeMapRow,
  savePluginConfig,
  saving,
  schemaEntries,
  selectedPluginId,
  selectedPluginLabel,
  stringValue,
  t,
} = usePluginSettingsPanel(props)
</script>

<template>
  <section class="rounded-lg border border-border bg-muted/10 p-4 space-y-4 min-w-0">
    <div class="flex flex-wrap items-center gap-2 min-w-0">
      <div class="text-sm font-medium">{{ t('settings.pluginSettings.title') }}</div>
      <div class="ml-auto text-xs text-muted-foreground">{{ t('settings.pluginSettings.subtitle') }}</div>
    </div>

    <div v-if="pluginsWithSchema.length === 0" class="text-xs text-muted-foreground">
      {{ t('settings.pluginSettings.noSchemaPublished') }}
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <div v-if="!hidePluginSelector" class="min-w-[220px] flex-1 max-w-[420px]">
          <OptionPicker
            v-model="selectedPluginId"
            :options="pluginPickerOptions"
            :title="t('settings.pluginSettings.fields.plugin')"
            :search-placeholder="t('settings.pluginSettings.searchPlugins')"
            :include-empty="false"
            :disabled="loading || saving"
          />
        </div>

        <div
          v-else
          class="h-9 inline-flex items-center rounded-md border border-input bg-transparent px-3 text-sm max-w-full min-w-0"
        >
          <span class="truncate">{{ selectedPluginLabel }}</span>
        </div>

        <Button variant="outline" size="sm" :disabled="loading || saving" @click="loadPluginConfig">{{
          t('common.reload')
        }}</Button>
        <Button size="sm" :disabled="loading || saving || !dirty" @click="savePluginConfig">
          {{ saving ? t('common.saving') : t('common.save') }}
        </Button>
      </div>

      <div
        v-if="error"
        class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive break-words"
      >
        {{ error }}
      </div>

      <div v-if="loading" class="text-xs text-muted-foreground">{{ t('settings.pluginSettings.loadingConfig') }}</div>

      <div v-else class="grid gap-3">
        <div v-if="schemaEntries.length === 0" class="text-xs text-muted-foreground">
          {{ t('settings.pluginSettings.noFieldsDeclared') }}
        </div>

        <div
          v-for="entry in schemaEntries"
          :key="entry.path.join('.')"
          class="grid gap-1 min-w-0"
          :style="{ paddingLeft: `${Math.max(0, (entry.depth - 1) * 12)}px` }"
        >
          <template v-if="entry.kind === 'group'">
            <div class="pt-2 text-xs font-semibold text-muted-foreground break-words">
              {{ getLabel(entry.key, entry.prop) }}
            </div>
            <div v-if="getDescription(entry.prop)" class="text-xs text-muted-foreground break-words">
              {{ getDescription(entry.prop) }}
            </div>
          </template>

          <template v-else>
            <label class="text-sm font-medium leading-none break-words">{{ getLabel(entry.key, entry.prop) }}</label>
            <div v-if="getDescription(entry.prop)" class="text-xs text-muted-foreground break-words">
              {{ getDescription(entry.prop) }}
            </div>

            <OptionPicker
              v-if="Array.isArray(entry.prop.enum) && entry.prop.enum.length > 0"
              :model-value="enumCurrentToken(entry.path, entry.prop)"
              @update:model-value="(v) => onEnumSelect(entry.path, String(v || ''))"
              :options="enumPickerOptions(entry.prop.enum)"
              :title="t('common.select')"
              :search-placeholder="t('common.searchOptions')"
              :empty-label="`(${t('common.default')})`"
            />

            <input
              v-else-if="entry.prop.type === 'string'"
              type="text"
              :value="stringValue(entry.path, entry.prop)"
              class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              @input="onStringInput(entry.path, $event)"
            />

            <input
              v-else-if="entry.prop.type === 'number' || entry.prop.type === 'integer'"
              type="number"
              :step="entry.prop.type === 'integer' ? '1' : 'any'"
              :min="typeof entry.prop.minimum === 'number' ? entry.prop.minimum : undefined"
              :value="numberValue(entry.path, entry.prop)"
              class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              @input="onNumberInput(entry.path, entry.prop, $event)"
            />

            <label v-else-if="entry.prop.type === 'boolean'" class="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                :checked="booleanValue(entry.path, entry.prop)"
                @change="onBooleanInput(entry.path, $event)"
              />
              <span class="text-muted-foreground">{{ t('common.on') }}</span>
            </label>

            <div v-else-if="entry.prop.type === 'array' && isArrayWithPrimitiveItems(entry.prop)" class="grid gap-2">
              <div class="rounded-md border border-input bg-transparent p-2 grid gap-2">
                <div
                  v-for="(row, rowIdx) in ensureArrayRows(entry.path, entry.prop)"
                  :key="`arr:${entry.path.join('.')}:${rowIdx}`"
                  class="flex flex-col gap-2 sm:flex-row sm:items-center min-w-0"
                >
                  <div v-if="arrayItemEnum(entry.prop).length > 0" class="w-full sm:flex-1 sm:min-w-0">
                    <OptionPicker
                      :model-value="row"
                      @update:model-value="(v) => onArrayRowSelect(entry.path, entry.prop, rowIdx, String(v || ''))"
                      :options="enumPickerOptions(arrayItemEnum(entry.prop))"
                      :title="t('common.select')"
                      :search-placeholder="t('common.searchOptions')"
                      :empty-label="`(${t('common.empty')})`"
                    />
                  </div>

                  <div v-else-if="arrayItemProp(entry.prop).type === 'boolean'" class="w-full sm:flex-1 sm:min-w-0">
                    <OptionPicker
                      :model-value="row"
                      @update:model-value="(v) => onArrayRowSelect(entry.path, entry.prop, rowIdx, String(v || ''))"
                      :options="[
                        { value: 'true', label: t('common.true') },
                        { value: 'false', label: t('common.false') },
                      ]"
                      :title="t('common.select')"
                      :search-placeholder="t('common.searchOptions')"
                      :empty-label="`(${t('common.empty')})`"
                    />
                  </div>

                  <input
                    v-else
                    type="text"
                    :inputmode="
                      arrayItemType(entry.prop) === 'integer'
                        ? 'numeric'
                        : arrayItemType(entry.prop) === 'number'
                          ? 'decimal'
                          : 'text'
                    "
                    :placeholder="
                      arrayItemType(entry.prop) === 'integer'
                        ? String(t('common.integer'))
                        : arrayItemType(entry.prop) === 'number'
                          ? String(t('common.number'))
                          : String(t('common.value'))
                    "
                    :value="row"
                    class="h-9 w-full sm:flex-1 sm:min-w-0 rounded-md border border-input bg-transparent px-3 text-sm"
                    @input="onArrayRowInput(entry.path, entry.prop, rowIdx, $event)"
                  />

                  <Button
                    variant="outline"
                    size="sm"
                    class="w-full sm:w-auto"
                    @click="removeArrayRow(entry.path, entry.prop, rowIdx)"
                  >
                    {{ t('common.remove') }}
                  </Button>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" @click="addArrayRow(entry.path, entry.prop)">{{
                    t('common.add')
                  }}</Button>
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="ensureArrayRows(entry.path, entry.prop).length === 0"
                    @click="clearArrayRows(entry.path, entry.prop)"
                  >
                    {{ t('common.clear') }}
                  </Button>
                </div>
              </div>

              <div v-if="arrayError(entry.path)" class="text-xs text-destructive">{{ arrayError(entry.path) }}</div>
            </div>

            <div v-else-if="entry.prop.type === 'object' && additionalPrimitiveProp(entry.prop)" class="grid gap-2">
              <div class="rounded-md border border-input bg-transparent p-2 grid gap-2">
                <div
                  v-for="(row, rowIdx) in ensureMapRows(entry.path, entry.prop)"
                  :key="`map:${entry.path.join('.')}:${rowIdx}`"
                  class="flex flex-col gap-2 sm:flex-row sm:items-center min-w-0"
                >
                  <input
                    type="text"
                    :placeholder="t('common.key')"
                    :value="row.key"
                    class="h-9 w-full sm:w-[40%] sm:min-w-[160px] sm:max-w-[320px] rounded-md border border-input bg-transparent px-3 text-sm"
                    @input="onMapKeyInput(entry.path, entry.prop, rowIdx, $event)"
                  />

                  <div v-if="mapValueEnum(entry.prop).length > 0" class="w-full sm:flex-1 sm:min-w-0">
                    <OptionPicker
                      :model-value="row.value"
                      @update:model-value="(v) => onMapValueSelect(entry.path, entry.prop, rowIdx, String(v || ''))"
                      :options="enumPickerOptions(mapValueEnum(entry.prop))"
                      :title="t('common.select')"
                      :search-placeholder="t('common.searchOptions')"
                      :empty-label="`(${t('common.empty')})`"
                    />
                  </div>

                  <div v-else-if="mapValueType(entry.prop) === 'boolean'" class="w-full sm:flex-1 sm:min-w-0">
                    <OptionPicker
                      :model-value="row.value"
                      @update:model-value="(v) => onMapValueSelect(entry.path, entry.prop, rowIdx, String(v || ''))"
                      :options="[
                        { value: 'true', label: t('common.true') },
                        { value: 'false', label: t('common.false') },
                      ]"
                      :title="t('common.select')"
                      :search-placeholder="t('common.searchOptions')"
                      :empty-label="`(${t('common.empty')})`"
                    />
                  </div>

                  <input
                    v-else
                    type="text"
                    :inputmode="
                      mapValueType(entry.prop) === 'integer'
                        ? 'numeric'
                        : mapValueType(entry.prop) === 'number'
                          ? 'decimal'
                          : 'text'
                    "
                    :placeholder="
                      mapValueType(entry.prop) === 'integer'
                        ? String(t('common.integer'))
                        : mapValueType(entry.prop) === 'number'
                          ? String(t('common.number'))
                          : String(t('common.value'))
                    "
                    :value="row.value"
                    class="h-9 w-full sm:flex-1 sm:min-w-0 rounded-md border border-input bg-transparent px-3 text-sm"
                    @input="onMapValueInput(entry.path, entry.prop, rowIdx, $event)"
                  />

                  <Button
                    variant="outline"
                    size="sm"
                    class="w-full sm:w-auto"
                    @click="removeMapRow(entry.path, entry.prop, rowIdx)"
                  >
                    {{ t('common.remove') }}
                  </Button>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" @click="addMapRow(entry.path, entry.prop)">{{
                    t('common.add')
                  }}</Button>
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="ensureMapRows(entry.path, entry.prop).length === 0"
                    @click="clearMapRows(entry.path, entry.prop)"
                  >
                    {{ t('common.clear') }}
                  </Button>
                </div>
              </div>

              <div v-if="mapError(entry.path)" class="text-xs text-destructive">{{ mapError(entry.path) }}</div>
            </div>

            <textarea
              v-else
              :value="jsonTextValue(entry.path, entry.prop)"
              class="min-h-[120px] w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
              spellcheck="false"
              @input="onJsonTextInput(entry.path, $event)"
              @blur="commitJsonText(entry.path, entry.prop)"
            />

            <div v-if="jsonError(entry.path)" class="text-xs text-destructive">{{ jsonError(entry.path) }}</div>
            <div
              v-else-if="entry.prop.type === 'object' || entry.prop.type === 'array'"
              class="text-xs text-muted-foreground"
            >
              {{ t('settings.pluginSettings.editAsJson') }}
            </div>
          </template>
        </div>
      </div>
    </template>
  </section>
</template>

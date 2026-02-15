<script setup lang="ts">
import { RiAddLine, RiCheckLine, RiDeleteBinLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Tooltip from '@/components/ui/Tooltip.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

const props = defineProps<{ providerId: string }>()
type JsonBuffer = { text: string; error: string | null }
type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue } | undefined
type JsonObject = Record<string, JsonValue>
type ProviderMapsContext = {
  showProviderOptionsJson: Record<string, boolean>
  toggleProviderOptionsJson: (providerId: string) => void
  isPlainObject: (value: JsonValue) => value is JsonObject
  getProviderOption: (providerId: string, key: string) => JsonValue
  setProviderOption: (providerId: string, key: string, value: JsonValue) => void
  getProviderOptionsExtra: (providerId: string) => JsonObject
  setProviderOptionsExtra: (providerId: string, value: JsonValue) => void
  providerHeadersEntries: (providerId: string) => Array<{ k: string; v: JsonValue }>
  updateProviderHeaderKey: (providerId: string, oldKey: string, nextKey: string) => void
  updateProviderHeaderValue: (providerId: string, key: string, nextValue: string) => void
  removeProviderHeader: (providerId: string, key: string) => void
  providerHeaderNewKey: Record<string, string>
  providerHeaderNewVal: Record<string, string>
  addProviderHeader: (providerId: string) => void
  providerFeatureFlagEntries: (providerId: string) => Array<{ k: string; v: JsonValue }>
  updateProviderFlagKey: (providerId: string, oldKey: string, nextKey: string) => void
  updateProviderFlagValue: (providerId: string, key: string, raw: string) => void
  removeProviderFlag: (providerId: string, key: string) => void
  providerFlagNewKey: Record<string, string>
  providerFlagNewVal: Record<string, string>
  addProviderFlag: (providerId: string) => void
  providerExtraEntries: (providerId: string) => Array<{ k: string; v: JsonValue }>
  updateProviderExtraKey: (providerId: string, oldKey: string, nextKey: string) => void
  updateProviderExtraValue: (providerId: string, key: string, raw: string) => void
  removeProviderExtra: (providerId: string, key: string) => void
  providerExtraNewKey: Record<string, string>
  providerExtraNewVal: Record<string, string>
  addProviderExtra: (providerId: string) => void
  ensureJsonBuffer: (
    id: string,
    get: () => JsonValue,
    set: (value: JsonValue) => void,
    fallback: JsonValue,
  ) => JsonBuffer
  applyJsonBuffer: (id: string) => void
}
const ctx = useOpencodeConfigPanelContext<ProviderMapsContext>()

const {
  showProviderOptionsJson,
  toggleProviderOptionsJson,
  isPlainObject,
  getProviderOption,
  setProviderOption,
  getProviderOptionsExtra,
  setProviderOptionsExtra,
  providerHeadersEntries,
  updateProviderHeaderKey,
  updateProviderHeaderValue,
  removeProviderHeader,
  providerHeaderNewKey,
  providerHeaderNewVal,
  addProviderHeader,
  providerFeatureFlagEntries,
  updateProviderFlagKey,
  updateProviderFlagValue,
  removeProviderFlag,
  providerFlagNewKey,
  providerFlagNewVal,
  addProviderFlag,
  providerExtraEntries,
  updateProviderExtraKey,
  updateProviderExtraValue,
  removeProviderExtra,
  providerExtraNewKey,
  providerExtraNewVal,
  addProviderExtra,
  ensureJsonBuffer,
  applyJsonBuffer,
} = ctx

const providerId = props.providerId
</script>

<template>
  <div class="grid gap-4">
    <div class="flex items-center justify-between">
      <div class="text-sm font-semibold">Maps</div>
      <button
        type="button"
        class="text-[11px] text-muted-foreground hover:text-foreground"
        @click="toggleProviderOptionsJson(providerId)"
      >
        {{ showProviderOptionsJson[providerId] ? 'Hide JSON' : 'Show JSON' }}
      </button>
    </div>

    <div class="grid gap-2">
      <span class="text-xs text-muted-foreground">Headers</span>
      <div
        v-if="getProviderOption(providerId, 'headers') && !isPlainObject(getProviderOption(providerId, 'headers'))"
        class="text-xs text-amber-600"
      >
        Current headers value is not an object; table editing will overwrite it.
      </div>
      <div class="grid gap-2">
        <div
          v-for="row in providerHeadersEntries(providerId)"
          :key="`hdr:${providerId}:${row.k}`"
          class="grid gap-2 lg:grid-cols-[1fr_1fr_auto] items-center"
        >
          <Input
            :model-value="row.k"
            @update:model-value="(v) => updateProviderHeaderKey(providerId, row.k, String(v))"
            placeholder="Header"
            class="font-mono"
          />
          <Input
            :model-value="String(row.v ?? '')"
            @update:model-value="(v) => updateProviderHeaderValue(providerId, row.k, String(v))"
            placeholder="Value"
            class="font-mono"
          />
          <Tooltip>
            <Button
              size="icon"
              variant="ghost-destructive"
              class="h-8 w-8"
              title="Remove"
              aria-label="Remove header"
              @click="removeProviderHeader(providerId, row.k)"
            >
              <RiDeleteBinLine class="h-4 w-4" />
            </Button>
            <template #content>Remove</template>
          </Tooltip>
        </div>
        <div class="grid gap-2 lg:grid-cols-[1fr_1fr_auto] items-center">
          <Input v-model="providerHeaderNewKey[providerId]" placeholder="New header" class="font-mono" />
          <Input v-model="providerHeaderNewVal[providerId]" placeholder="Value" class="font-mono" />
          <Tooltip>
            <Button
              size="icon"
              variant="outline"
              class="h-9 w-9"
              title="Add"
              aria-label="Add header"
              @click="addProviderHeader(providerId)"
            >
              <RiAddLine class="h-4 w-4" />
            </Button>
            <template #content>Add</template>
          </Tooltip>
        </div>
      </div>
    </div>

    <div class="grid gap-2">
      <span class="text-xs text-muted-foreground">Feature flags</span>
      <div
        v-if="
          getProviderOption(providerId, 'featureFlags') && !isPlainObject(getProviderOption(providerId, 'featureFlags'))
        "
        class="text-xs text-amber-600"
      >
        Current featureFlags value is not an object; table editing will overwrite it.
      </div>
      <div class="grid gap-2">
        <div
          v-for="row in providerFeatureFlagEntries(providerId)"
          :key="`ff:${providerId}:${row.k}`"
          class="grid gap-2 lg:grid-cols-[1fr_1fr_auto] items-center"
        >
          <Input
            :model-value="row.k"
            @update:model-value="(v) => updateProviderFlagKey(providerId, row.k, String(v))"
            placeholder="Flag"
            class="font-mono"
          />
          <Input
            :model-value="JSON.stringify(row.v)"
            @update:model-value="(v) => updateProviderFlagValue(providerId, row.k, String(v))"
            placeholder='true/false/"value"'
            class="font-mono"
          />
          <Tooltip>
            <Button
              size="icon"
              variant="ghost-destructive"
              class="h-8 w-8"
              title="Remove"
              aria-label="Remove flag"
              @click="removeProviderFlag(providerId, row.k)"
            >
              <RiDeleteBinLine class="h-4 w-4" />
            </Button>
            <template #content>Remove</template>
          </Tooltip>
        </div>
        <div class="grid gap-2 lg:grid-cols-[1fr_1fr_auto] items-center">
          <Input v-model="providerFlagNewKey[providerId]" placeholder="New flag" class="font-mono" />
          <Input v-model="providerFlagNewVal[providerId]" placeholder="true" class="font-mono" />
          <Tooltip>
            <Button
              size="icon"
              variant="outline"
              class="h-9 w-9"
              title="Add"
              aria-label="Add flag"
              @click="addProviderFlag(providerId)"
            >
              <RiAddLine class="h-4 w-4" />
            </Button>
            <template #content>Add</template>
          </Tooltip>
        </div>
      </div>
    </div>

    <div class="grid gap-2">
      <span class="text-xs text-muted-foreground">Options (extra)</span>
      <div class="text-[11px] text-muted-foreground">
        Key/value pairs in provider.options not covered by known fields.
      </div>
      <div class="grid gap-2">
        <div
          v-for="row in providerExtraEntries(providerId)"
          :key="`extra:${providerId}:${row.k}`"
          class="grid gap-2 lg:grid-cols-[1fr_1fr_auto] items-center"
        >
          <Input
            :model-value="row.k"
            @update:model-value="(v) => updateProviderExtraKey(providerId, row.k, String(v))"
            placeholder="Key"
            class="font-mono"
          />
          <Input
            :model-value="JSON.stringify(row.v)"
            @update:model-value="(v) => updateProviderExtraValue(providerId, row.k, String(v))"
            placeholder='"value"'
            class="font-mono"
          />
          <Tooltip>
            <Button
              size="icon"
              variant="ghost-destructive"
              class="h-8 w-8"
              title="Remove"
              aria-label="Remove entry"
              @click="removeProviderExtra(providerId, row.k)"
            >
              <RiDeleteBinLine class="h-4 w-4" />
            </Button>
            <template #content>Remove</template>
          </Tooltip>
        </div>
        <div class="grid gap-2 lg:grid-cols-[1fr_1fr_auto] items-center">
          <Input v-model="providerExtraNewKey[providerId]" placeholder="New key" class="font-mono" />
          <Input v-model="providerExtraNewVal[providerId]" placeholder='"value"' class="font-mono" />
          <Tooltip>
            <Button
              size="icon"
              variant="outline"
              class="h-9 w-9"
              title="Add"
              aria-label="Add entry"
              @click="addProviderExtra(providerId)"
            >
              <RiAddLine class="h-4 w-4" />
            </Button>
            <template #content>Add</template>
          </Tooltip>
        </div>
      </div>
    </div>

    <div v-if="showProviderOptionsJson[providerId]" class="grid gap-4">
      <div class="grid gap-2">
        <span class="text-xs text-muted-foreground">Headers (JSON)</span>
        <textarea
          v-model="
            ensureJsonBuffer(
              `provider:${providerId}:headers`,
              () => getProviderOption(providerId, 'headers'),
              (val: JsonValue) => setProviderOption(providerId, 'headers', val),
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
              @click="applyJsonBuffer(`provider:${providerId}:headers`)"
            >
              <RiCheckLine class="h-4 w-4" />
            </Button>
            <template #content>Apply</template>
          </Tooltip>
          <span
            v-if="
              ensureJsonBuffer(
                `provider:${providerId}:headers`,
                () => getProviderOption(providerId, 'headers'),
                (val: JsonValue) => setProviderOption(providerId, 'headers', val),
                {},
              ).error
            "
            class="text-xs text-destructive"
          >
            {{
              ensureJsonBuffer(
                `provider:${providerId}:headers`,
                () => getProviderOption(providerId, 'headers'),
                (val: JsonValue) => setProviderOption(providerId, 'headers', val),
                {},
              ).error
            }}
          </span>
        </div>
      </div>

      <div class="grid gap-2">
        <span class="text-xs text-muted-foreground">Feature flags (JSON)</span>
        <textarea
          v-model="
            ensureJsonBuffer(
              `provider:${providerId}:featureFlags`,
              () => getProviderOption(providerId, 'featureFlags'),
              (val: JsonValue) => setProviderOption(providerId, 'featureFlags', val),
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
              @click="applyJsonBuffer(`provider:${providerId}:featureFlags`)"
            >
              <RiCheckLine class="h-4 w-4" />
            </Button>
            <template #content>Apply</template>
          </Tooltip>
          <span
            v-if="
              ensureJsonBuffer(
                `provider:${providerId}:featureFlags`,
                () => getProviderOption(providerId, 'featureFlags'),
                (val: JsonValue) => setProviderOption(providerId, 'featureFlags', val),
                {},
              ).error
            "
            class="text-xs text-destructive"
          >
            {{
              ensureJsonBuffer(
                `provider:${providerId}:featureFlags`,
                () => getProviderOption(providerId, 'featureFlags'),
                (val: JsonValue) => setProviderOption(providerId, 'featureFlags', val),
                {},
              ).error
            }}
          </span>
        </div>
      </div>

      <div class="grid gap-2">
        <span class="text-xs text-muted-foreground">Options JSON (extra)</span>
        <textarea
          v-model="
            ensureJsonBuffer(
              `provider:${providerId}:optionsExtra`,
              () => getProviderOptionsExtra(providerId),
              (val: JsonValue) => setProviderOptionsExtra(providerId, val),
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
              @click="applyJsonBuffer(`provider:${providerId}:optionsExtra`)"
            >
              <RiCheckLine class="h-4 w-4" />
            </Button>
            <template #content>Apply</template>
          </Tooltip>
          <span
            v-if="
              ensureJsonBuffer(
                `provider:${providerId}:optionsExtra`,
                () => getProviderOptionsExtra(providerId),
                (val: JsonValue) => setProviderOptionsExtra(providerId, val),
                {},
              ).error
            "
            class="text-xs text-destructive"
          >
            {{
              ensureJsonBuffer(
                `provider:${providerId}:optionsExtra`,
                () => getProviderOptionsExtra(providerId),
                (val: JsonValue) => setProviderOptionsExtra(providerId, val),
                {},
              ).error
            }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

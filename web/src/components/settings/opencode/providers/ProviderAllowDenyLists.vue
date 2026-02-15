<script setup lang="ts">
import { computed } from 'vue'
import { RiCloseLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import InlineSearchAdd, { type PickerOption } from '@/components/ui/InlineSearchAdd.vue'
import Tooltip from '@/components/ui/Tooltip.vue'
import VirtualList from '@/components/ui/VirtualList.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'
import { asStringArray } from '../utils'

const ctx = useOpencodeConfigPanelContext()

const {
  showProviderBrowse,
  showAdvancedProviderLists,
  enabledProvidersArr,
  disabledProvidersArr,
  enabledProviders,
  disabledProviders,
  providerFilter,
  filteredProviderIdOptions,
  providerListConflict,
  isKnownProviderId,
  removeFromList,
  addEnabledProviderTags,
  addDisabledProviderTags,
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
      <div class="text-xs text-muted-foreground">Provider allow/deny lists</div>
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="text-[11px] text-muted-foreground hover:text-foreground"
          @click="showProviderBrowse = !showProviderBrowse"
        >
          {{ showProviderBrowse ? 'Hide browse list' : 'Browse list' }}
        </button>
        <button
          type="button"
          class="text-[11px] text-muted-foreground hover:text-foreground"
          @click="showAdvancedProviderLists = !showAdvancedProviderLists"
        >
          {{ showAdvancedProviderLists ? 'Hide advanced text' : 'Show advanced text' }}
        </button>
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <div class="rounded-md border border-border p-3 space-y-2">
        <div class="flex items-center justify-between">
          <div class="text-sm font-semibold">Enabled</div>
          <Tooltip>
            <Button
              size="icon"
              variant="ghost"
              class="h-8 w-8"
              title="Clear"
              aria-label="Clear enabled providers"
              @click="enabledProvidersArr = []"
            >
              <RiCloseLine class="h-4 w-4" />
            </Button>
            <template #content>Clear</template>
          </Tooltip>
        </div>
        <div class="text-[11px] text-muted-foreground">If non-empty, only these providers are used.</div>

        <div class="flex flex-wrap gap-2">
          <span
            v-for="id in enabledProvidersArr"
            :key="`enabled-chip:${id}`"
            class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/20 px-2 py-1 text-xs"
          >
            <span class="font-mono break-all" :class="isKnownProviderId(id) ? '' : 'text-amber-600'">{{ id }}</span>
            <button
              type="button"
              class="text-muted-foreground hover:text-foreground"
              @click="enabledProvidersArr = removeFromList(enabledProvidersArr, id)"
            >
              ×
            </button>
          </span>
          <span v-if="enabledProvidersArr.length === 0" class="text-xs text-muted-foreground">None</span>
        </div>

        <div class="flex items-center gap-2">
          <InlineSearchAdd
            :options="providerPickerOptions"
            panel-title="Providers"
            placeholder="Add provider id"
            monospace
            :selected-values="enabledProvidersArr"
            @add="addEnabledProviderTags"
            @remove="(v: string) => (enabledProvidersArr = removeFromList(enabledProvidersArr, v))"
            @backspace-empty="
              () => {
                if (enabledProvidersArr.length) enabledProvidersArr = enabledProvidersArr.slice(0, -1)
              }
            "
          />
        </div>
      </div>

      <div class="rounded-md border border-border p-3 space-y-2">
        <div class="flex items-center justify-between">
          <div class="text-sm font-semibold">Disabled</div>
          <Tooltip>
            <Button
              size="icon"
              variant="ghost"
              class="h-8 w-8"
              title="Clear"
              aria-label="Clear disabled providers"
              @click="disabledProvidersArr = []"
            >
              <RiCloseLine class="h-4 w-4" />
            </Button>
            <template #content>Clear</template>
          </Tooltip>
        </div>
        <div class="text-[11px] text-muted-foreground">These providers will be excluded.</div>

        <div class="flex flex-wrap gap-2">
          <span
            v-for="id in disabledProvidersArr"
            :key="`disabled-chip:${id}`"
            class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/20 px-2 py-1 text-xs"
          >
            <span class="font-mono break-all" :class="isKnownProviderId(id) ? '' : 'text-amber-600'">{{ id }}</span>
            <button
              type="button"
              class="text-muted-foreground hover:text-foreground"
              @click="disabledProvidersArr = removeFromList(disabledProvidersArr, id)"
            >
              ×
            </button>
          </span>
          <span v-if="disabledProvidersArr.length === 0" class="text-xs text-muted-foreground">None</span>
        </div>

        <div class="flex items-center gap-2">
          <InlineSearchAdd
            :options="providerPickerOptions"
            panel-title="Providers"
            placeholder="Add provider id"
            monospace
            :selected-values="disabledProvidersArr"
            @add="addDisabledProviderTags"
            @remove="(v: string) => (disabledProvidersArr = removeFromList(disabledProvidersArr, v))"
            @backspace-empty="
              () => {
                if (disabledProvidersArr.length) disabledProvidersArr = disabledProvidersArr.slice(0, -1)
              }
            "
          />
        </div>
      </div>
    </div>

    <div v-if="showProviderBrowse" class="grid gap-2">
      <Input v-model="providerFilter" placeholder="Filter providers (e.g. openai)" class="max-w-sm" />
      <div class="grid gap-4 lg:grid-cols-2">
        <div class="rounded-md border border-border p-3">
          <div class="text-xs text-muted-foreground">Toggle enabled providers</div>
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
          <div v-else class="mt-2 text-xs text-muted-foreground">No matching providers.</div>
        </div>

        <div class="rounded-md border border-border p-3">
          <div class="text-xs text-muted-foreground">Toggle disabled providers</div>
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
          <div v-else class="mt-2 text-xs text-muted-foreground">No matching providers.</div>
        </div>
      </div>
    </div>

    <div v-if="providerListConflict.length > 0" class="text-xs text-destructive">
      Conflicts: {{ providerListConflict.join(', ') }} (cannot be both enabled and disabled)
    </div>

    <div v-if="showAdvancedProviderLists" class="grid gap-4 lg:grid-cols-2">
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Enabled providers (advanced)</span>
        <textarea
          v-model="enabledProviders"
          rows="4"
          class="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
          placeholder="anthropic\nopenai"
        />
      </label>
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Disabled providers (advanced)</span>
        <textarea
          v-model="disabledProviders"
          rows="4"
          class="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
          placeholder="openrouter"
        />
      </label>
    </div>
  </div>
</template>

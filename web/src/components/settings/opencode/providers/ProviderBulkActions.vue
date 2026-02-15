<script setup lang="ts">
import { computed } from 'vue'
import { RiCloseLine, RiListCheck3 } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import InlineSearchAdd, { type PickerOption } from '@/components/ui/InlineSearchAdd.vue'
import Tooltip from '@/components/ui/Tooltip.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'
import { asStringArray } from '../utils'

const ctx = useOpencodeConfigPanelContext()

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
</script>

<template>
  <div class="rounded-md border border-border p-3 space-y-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="text-sm font-semibold">Bulk actions</div>
      <div class="text-[11px] text-muted-foreground">Use selection to set allow/deny lists quickly.</div>
    </div>
    <div class="grid gap-3 lg:grid-cols-2">
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Conflict policy</span>
        <select v-model="providerConflictPolicy" class="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
          <option value="last-change-wins">last-change-wins</option>
          <option value="enabled-wins">enabled-wins</option>
          <option value="disabled-wins">disabled-wins</option>
          <option value="keep-conflict">keep-conflict</option>
        </select>
      </label>
      <div class="lg:col-span-2 grid gap-1">
        <span class="text-xs text-muted-foreground">Selection</span>
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
          <span v-if="bulkProviderSelection.length === 0" class="text-xs text-muted-foreground">None</span>
        </div>
        <div class="flex items-center gap-2">
          <InlineSearchAdd
            :options="providerPickerOptions"
            panel-title="Providers"
            placeholder="Add provider ids (paste supported)"
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
              title="Select all"
              aria-label="Select all"
              @click="bulkProviderSelection = providerIdOptions"
            >
              <RiListCheck3 class="h-4 w-4" />
            </Button>
            <template #content>All</template>
          </Tooltip>
          <Tooltip>
            <Button
              size="icon"
              variant="ghost"
              class="h-9 w-9"
              title="Clear"
              aria-label="Clear selection"
              @click="bulkProviderSelection = []"
              :disabled="bulkProviderSelection.length === 0"
            >
              <RiCloseLine class="h-4 w-4" />
            </Button>
            <template #content>Clear</template>
          </Tooltip>
        </div>
      </div>
    </div>
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <Button size="sm" variant="outline" @click="applyBulkEnableOnly" :disabled="bulkProviderSelection.length === 0">
      Enable only selection
    </Button>
    <Button
      size="sm"
      variant="outline"
      @click="applyBulkDisableAllExcept"
      :disabled="bulkProviderSelection.length === 0"
    >
      Disable all except selection
    </Button>
    <span v-if="providerEnvError" class="text-xs text-amber-600 break-all">Env check: {{ providerEnvError }}</span>
  </div>
</template>

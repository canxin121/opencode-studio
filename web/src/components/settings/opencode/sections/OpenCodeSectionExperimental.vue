<script lang="ts">
import { defineComponent, ref } from 'vue'
import { RiArrowDownSLine, RiArrowUpSLine, RiRestartLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import OptionPicker, { type PickerOption } from '@/components/ui/OptionPicker.vue'
import Tooltip from '@/components/ui/Tooltip.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

export default defineComponent({
  components: {
    Button,
    Input,
    OptionPicker,
    Tooltip,
    RiArrowDownSLine,
    RiArrowUpSLine,
    RiRestartLine,
  },
  setup() {
    const ctx = useOpencodeConfigPanelContext()
    const showAdvancedPrimaryTools = ref(false)

    const triStatePickerOptions: PickerOption[] = [
      { value: 'default', label: 'default' },
      { value: 'true', label: 'true' },
      { value: 'false', label: 'false' },
    ]

    return Object.assign(ctx, { showAdvancedPrimaryTools, triStatePickerOptions })
  },
})
</script>

<template>
  <section id="experimental" class="scroll-mt-24 rounded-lg border border-border bg-background p-4 space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-base font-semibold leading-snug">Unstable settings.</div>
      </div>
      <div class="flex items-center gap-2">
        <Tooltip>
          <Button size="icon" variant="ghost" class="h-8 w-8" title="Reset section" @click="resetSection('experimental')">
            <RiRestartLine class="h-4 w-4" />
          </Button>
          <template #content>Reset section</template>
        </Tooltip>
        <Tooltip>
          <Button
            size="icon"
            variant="outline"
            class="h-8 w-8"
            :title="isSectionOpen('experimental') ? 'Collapse' : 'Expand'"
            @click="toggleSection('experimental')"
          >
            <RiArrowUpSLine v-if="isSectionOpen('experimental')" class="h-4 w-4" />
            <RiArrowDownSLine v-else class="h-4 w-4" />
          </Button>
          <template #content>{{ isSectionOpen('experimental') ? 'Collapse' : 'Expand' }}</template>
        </Tooltip>
      </div>
    </div>

    <div v-if="isSectionOpen('experimental')" class="space-y-4">
      <div class="grid gap-4 lg:grid-cols-3">
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">Disable paste summary</span>
          <OptionPicker
            v-model="experimentalDisablePasteSummary"
            :options="triStatePickerOptions"
            title="Disable paste summary"
            search-placeholder="Search"
            :include-empty="false"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">Batch tool</span>
          <OptionPicker
            v-model="experimentalBatchTool"
            :options="triStatePickerOptions"
            title="Batch tool"
            search-placeholder="Search"
            :include-empty="false"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">OpenTelemetry</span>
          <OptionPicker
            v-model="experimentalOpenTelemetry"
            :options="triStatePickerOptions"
            title="OpenTelemetry"
            search-placeholder="Search"
            :include-empty="false"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">Continue loop on deny</span>
          <OptionPicker
            v-model="experimentalContinueLoop"
            :options="triStatePickerOptions"
            title="Continue loop on deny"
            search-placeholder="Search"
            :include-empty="false"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-xs text-muted-foreground">MCP timeout (ms)</span>
          <input
            v-model="experimentalMcpTimeout"
            type="number"
            min="0"
            class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          />
        </label>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <div class="grid gap-2">
          <div class="flex items-center justify-between">
            <span class="text-xs text-muted-foreground">Primary tools</span>
            <button
              type="button"
              class="text-[11px] text-muted-foreground hover:text-foreground"
              @click="showAdvancedPrimaryTools = !showAdvancedPrimaryTools"
            >
              {{ showAdvancedPrimaryTools ? 'Hide advanced text' : 'Show advanced text' }}
            </button>
          </div>
          <Input v-model="toolFilter" placeholder="Filter tools (e.g. bash)" class="max-w-sm" />
          <div class="rounded-md border border-border p-3">
            <div class="grid gap-2 max-h-44 overflow-auto pr-1">
              <label v-for="id in filteredToolIdOptions" :key="`primary:${id}`" class="flex items-center gap-2 text-sm">
                <input type="checkbox" v-model="experimentalPrimaryToolsArr" :value="id" />
                <span class="font-mono text-xs break-all">{{ id }}</span>
              </label>
              <div v-if="filteredToolIdOptions.length === 0" class="text-xs text-muted-foreground">
                No matching tools.
              </div>
            </div>
          </div>
          <div class="text-[11px] text-muted-foreground">If set, OpenCode prefers these tools when planning.</div>
          <div v-if="toolIdsError" class="text-[11px] text-muted-foreground break-all">Tool IDs unavailable: {{ toolIdsError }}</div>
          <textarea
            v-if="showAdvancedPrimaryTools"
            v-model="experimentalPrimaryTools"
            rows="4"
            class="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
            placeholder="bash\nread"
          />
        </div>
      </div>
    </div>
  </section>
</template>

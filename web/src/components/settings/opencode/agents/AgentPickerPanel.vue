<script lang="ts">
import { defineComponent } from 'vue'
import { RiCloseLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Tooltip from '@/components/ui/Tooltip.vue'
import VirtualList from '@/components/ui/VirtualList.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

export default defineComponent({
  components: {
    Button,
    Tooltip,
    VirtualList,
    RiCloseLine,
  },
  setup() {
    const ctx = useOpencodeConfigPanelContext()
    return ctx
  },
})
</script>

<template>
  <div class="rounded-md border border-border bg-muted/10 p-3 space-y-2">
    <div class="flex items-center justify-between gap-2">
      <div class="text-[11px] text-muted-foreground">{{ filteredAgentsList.length }} agents</div>
      <Tooltip>
        <Button
          size="icon"
          variant="ghost"
          class="h-8 w-8"
          title="Clear selection"
          aria-label="Clear selection"
          @click="selectedAgentId = null"
          :disabled="!selectedAgentId"
        >
          <RiCloseLine class="h-4 w-4" />
        </Button>
        <template #content>Clear</template>
      </Tooltip>
    </div>

    <div v-if="filteredAgentsList.length === 0" class="text-xs text-muted-foreground">No agents configured.</div>

    <VirtualList
      v-else
      :items="filteredAgentsList"
      :get-key="(row) => `agent-row:${row[0]}`"
      :get-height="() => 44"
      class="max-h-[420px] pr-1"
    >
      <template #default="{ item: row }">
        <button
          type="button"
          class="w-full h-11 px-2 rounded-md flex items-center justify-between gap-2 text-left border border-transparent hover:bg-muted/40"
          :class="row[0] === selectedAgentId ? 'bg-muted/70 text-foreground border-border' : ''"
          @click="selectedAgentId = row[0]"
        >
          <div class="min-w-0">
            <div class="font-mono text-xs truncate">@{{ row[0] }}</div>
            <div class="text-[11px] text-muted-foreground truncate">
              {{ row[1]?.description || row[1]?.model || row[1]?.mode || '' }}
            </div>
          </div>
          <div class="flex items-center gap-1 flex-shrink-0">
            <span
              v-if="row[1]?.disable === true"
              class="text-[10px] rounded-full border border-border bg-background/40 px-2 py-0.5"
              >disabled</span
            >
            <span
              v-if="row[1]?.hidden === true"
              class="text-[10px] rounded-full border border-border bg-background/40 px-2 py-0.5"
              >hidden</span
            >
          </div>
        </button>
      </template>
    </VirtualList>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { RiCloseLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Tooltip from '@/components/ui/Tooltip.vue'
import VirtualList from '@/components/ui/VirtualList.vue'

import { i18n } from '@/i18n'

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

    const tt = computed(() => {
      const t = ctx.t
      return typeof t === 'function' ? t : i18n.global.t
    })

    return Object.assign(ctx, { tt })
  },
})
</script>

<template>
  <div class="rounded-md border border-border bg-muted/10 p-3 lg:p-4 space-y-3 min-h-[360px]">
    <div class="flex items-center justify-between gap-2">
      <div class="text-[11px] text-muted-foreground">
        {{ tt('settings.opencodeConfig.sections.agents.picker.count', { count: filteredAgentsList.length }) }}
      </div>
      <Tooltip>
        <Button
          size="icon"
          variant="ghost"
          class="h-8 w-8"
          :title="tt('common.clear')"
          :aria-label="tt('common.clear')"
          @click="selectAgent(null)"
          :disabled="filteredAgentsList.length === 0"
        >
          <RiCloseLine class="h-4 w-4" />
        </Button>
        <template #content>{{ tt('common.clear') }}</template>
      </Tooltip>
    </div>

    <div v-if="optionsLoading" class="text-[11px] text-muted-foreground">
      {{ tt('common.loading') }}
    </div>
    <div v-else-if="optionsError" class="text-[11px] text-amber-700 break-words">
      {{ String(optionsError) }}
    </div>

    <div v-if="filteredAgentsList.length === 0" class="text-xs text-muted-foreground">
      {{ tt('settings.opencodeConfig.sections.agents.picker.empty') }}
    </div>

    <VirtualList
      v-else
      :items="filteredAgentsList"
      :get-key="(row) => `agent-row:${row[0]}`"
      :get-height="() => 44"
      class="max-h-[60vh] min-h-[280px] pr-1"
    >
      <template #default="{ item: row }">
        <button
          type="button"
          class="w-full min-h-14 px-2.5 py-2 rounded-md flex items-center justify-between gap-2 text-left border border-transparent hover:bg-muted/40"
          :class="row[0] === effectiveSelectedAgentId ? 'bg-background text-foreground border-border shadow-sm' : ''"
          @click="selectAgent(row[0])"
        >
          <div class="min-w-0 space-y-1">
            <div class="font-mono text-xs truncate">@{{ row[0] }}</div>
            <div class="text-[11px] text-muted-foreground line-clamp-2 break-words">
              {{ row[1]?.description || row[1]?.mode || '' }}
            </div>
          </div>
          <div class="flex items-center gap-1 flex-shrink-0">
            <span
              v-if="row[1]?.disable === true"
              class="text-[10px] rounded-full border border-border bg-background/40 px-2 py-0.5"
              >{{ tt('settings.opencodeConfig.sections.agents.picker.badges.disabled') }}</span
            >
            <span
              v-if="row[1]?.hidden === true"
              class="text-[10px] rounded-full border border-border bg-background/40 px-2 py-0.5"
              >{{ tt('settings.opencodeConfig.sections.agents.picker.badges.hidden') }}</span
            >
          </div>
        </button>
      </template>
    </VirtualList>
  </div>
</template>

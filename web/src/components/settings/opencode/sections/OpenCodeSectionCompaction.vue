<script lang="ts">
import { defineComponent } from 'vue'
import { RiArrowDownSLine, RiArrowUpSLine, RiRestartLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Tooltip from '@/components/ui/Tooltip.vue'
import VirtualList from '@/components/ui/VirtualList.vue'
import CodeMirrorEditor from '@/components/CodeMirrorEditor.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

export default defineComponent({
  components: {
    Button,
    Input,
    Tooltip,
    VirtualList,
    CodeMirrorEditor,
    RiArrowDownSLine,
    RiArrowUpSLine,
    RiRestartLine,
  },
  setup() {
    return useOpencodeConfigPanelContext()
  },
})
</script>

<template>
  <section id="compaction" class="scroll-mt-24 rounded-lg border border-border bg-background p-4 space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-base font-semibold leading-snug">Context compaction defaults.</div>
      </div>
      <div class="flex items-center gap-2">
        <Tooltip>
          <Button size="icon" variant="ghost" class="h-8 w-8" title="Reset section" @click="resetSection('compaction')">
            <RiRestartLine class="h-4 w-4" />
          </Button>
          <template #content>Reset section</template>
        </Tooltip>
        <Tooltip>
          <Button
            size="icon"
            variant="outline"
            class="h-8 w-8"
            :title="isSectionOpen('compaction') ? 'Collapse' : 'Expand'"
            @click="toggleSection('compaction')"
          >
            <RiArrowUpSLine v-if="isSectionOpen('compaction')" class="h-4 w-4" />
            <RiArrowDownSLine v-else class="h-4 w-4" />
          </Button>
          <template #content>{{ isSectionOpen('compaction') ? 'Collapse' : 'Expand' }}</template>
        </Tooltip>
      </div>
    </div>

    <div v-if="isSectionOpen('compaction')" class="grid gap-4 lg:grid-cols-2">
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Auto-compact</span>
        <select v-model="compactionAuto" class="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
          <option value="default">default</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      </label>
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Prune tool output</span>
        <select v-model="compactionPrune" class="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
          <option value="default">default</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      </label>
    </div>
  </section>
</template>

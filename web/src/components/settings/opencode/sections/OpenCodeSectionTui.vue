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
  <section id="tui" class="scroll-mt-24 rounded-lg border border-border bg-background p-4 space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-base font-semibold leading-snug">Scroll behavior and diff rendering.</div>
      </div>
      <div class="flex items-center gap-2">
        <Tooltip>
          <Button size="icon" variant="ghost" class="h-8 w-8" title="Reset section" @click="resetSection('tui')">
            <RiRestartLine class="h-4 w-4" />
          </Button>
          <template #content>Reset section</template>
        </Tooltip>
        <Tooltip>
          <Button
            size="icon"
            variant="outline"
            class="h-8 w-8"
            :title="isSectionOpen('tui') ? 'Collapse' : 'Expand'"
            @click="toggleSection('tui')"
          >
            <RiArrowUpSLine v-if="isSectionOpen('tui')" class="h-4 w-4" />
            <RiArrowDownSLine v-else class="h-4 w-4" />
          </Button>
          <template #content>{{ isSectionOpen('tui') ? 'Collapse' : 'Expand' }}</template>
        </Tooltip>
      </div>
    </div>

    <div v-if="isSectionOpen('tui')" class="grid gap-4 lg:grid-cols-3">
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Scroll speed</span>
        <input
          v-model="tuiScrollSpeed"
          type="number"
          step="0.001"
          min="0"
          class="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        />
      </label>
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Scroll acceleration</span>
        <select v-model="tuiScrollAcceleration" class="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
          <option value="default">default</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      </label>
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Diff style</span>
        <select v-model="tuiDiffStyle" class="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
          <option value="default">default</option>
          <option value="auto">auto</option>
          <option value="stacked">stacked</option>
        </select>
      </label>
    </div>
  </section>
</template>

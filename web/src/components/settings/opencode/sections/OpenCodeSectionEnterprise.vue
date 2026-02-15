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
  <section id="enterprise" class="scroll-mt-24 rounded-lg border border-border bg-background p-4 space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-base font-semibold leading-snug">Enterprise URL overrides.</div>
      </div>
      <div class="flex items-center gap-2">
        <Tooltip>
          <Button size="icon" variant="ghost" class="h-8 w-8" title="Reset section" @click="resetSection('enterprise')">
            <RiRestartLine class="h-4 w-4" />
          </Button>
          <template #content>Reset section</template>
        </Tooltip>
        <Tooltip>
          <Button
            size="icon"
            variant="outline"
            class="h-8 w-8"
            :title="isSectionOpen('enterprise') ? 'Collapse' : 'Expand'"
            @click="toggleSection('enterprise')"
          >
            <RiArrowUpSLine v-if="isSectionOpen('enterprise')" class="h-4 w-4" />
            <RiArrowDownSLine v-else class="h-4 w-4" />
          </Button>
          <template #content>{{ isSectionOpen('enterprise') ? 'Collapse' : 'Expand' }}</template>
        </Tooltip>
      </div>
    </div>
    <div v-if="isSectionOpen('enterprise')" class="grid gap-3">
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Enterprise URL</span>
        <Input v-model="enterpriseUrl" placeholder="https://github.example.com" />
      </label>
    </div>
  </section>
</template>

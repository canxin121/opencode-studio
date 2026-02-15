<script lang="ts">
import { defineComponent } from 'vue'
import { RiCheckLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import Tooltip from '@/components/ui/Tooltip.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

export default defineComponent({
  components: {
    Button,
    Tooltip,
    RiCheckLine,
  },
  setup() {
    return useOpencodeConfigPanelContext()
  },
})
</script>

<template>
  <div class="rounded-md border border-border p-3 space-y-3">
    <div class="text-sm font-semibold">Presets</div>
    <div class="grid gap-3 lg:grid-cols-3">
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Preset</span>
        <select v-model="permissionPreset" class="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
          <option value="">(none)</option>
          <option value="safe">Safe default</option>
          <option value="power">Power user</option>
          <option value="readonly">Read-only</option>
        </select>
      </label>
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Apply mode</span>
        <select v-model="permissionPresetMode" class="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
          <option value="merge">merge</option>
          <option value="replace">replace</option>
        </select>
      </label>
    </div>
    <div class="flex items-center gap-2">
      <Tooltip>
        <Button
          size="icon"
          variant="outline"
          class="h-8 w-8"
          title="Apply preset"
          aria-label="Apply preset"
          @click="applyPermissionPreset"
          :disabled="!permissionPreset"
        >
          <RiCheckLine class="h-4 w-4" />
        </Button>
        <template #content>Apply preset</template>
      </Tooltip>
      <span class="text-[11px] text-muted-foreground">Tip: use merge to keep existing custom rules.</span>
    </div>
  </div>
</template>

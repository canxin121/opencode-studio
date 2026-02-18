<script lang="ts">
import { defineComponent } from 'vue'
import { RiCheckLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import OptionPicker, { type PickerOption } from '@/components/ui/OptionPicker.vue'
import Tooltip from '@/components/ui/Tooltip.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

export default defineComponent({
  components: {
    Button,
    OptionPicker,
    Tooltip,
    RiCheckLine,
  },
  setup() {
    const ctx = useOpencodeConfigPanelContext()

    const permissionPresetPickerOptions: PickerOption[] = [
      { value: 'safe', label: 'Safe default' },
      { value: 'power', label: 'Power user' },
      { value: 'readonly', label: 'Read-only' },
    ]

    const permissionPresetModePickerOptions: PickerOption[] = [
      { value: 'merge', label: 'merge' },
      { value: 'replace', label: 'replace' },
    ]

    return Object.assign(ctx, { permissionPresetPickerOptions, permissionPresetModePickerOptions })
  },
})
</script>

<template>
  <div class="rounded-md border border-border p-3 space-y-3">
    <div class="text-sm font-semibold">Presets</div>
    <div class="grid gap-3 lg:grid-cols-3">
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Preset</span>
        <OptionPicker
          v-model="permissionPreset"
          :options="permissionPresetPickerOptions"
          title="Preset"
          search-placeholder="Search presets"
          empty-label="(none)"
        />
      </label>
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Apply mode</span>
        <OptionPicker
          v-model="permissionPresetMode"
          :options="permissionPresetModePickerOptions"
          title="Apply mode"
          search-placeholder="Search modes"
          :include-empty="false"
        />
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

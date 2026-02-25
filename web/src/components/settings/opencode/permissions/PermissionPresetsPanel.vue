<script lang="ts">
import { computed, defineComponent } from 'vue'
import { RiCheckLine } from '@remixicon/vue'

import Button from '@/components/ui/Button.vue'
import OptionPicker from '@/components/ui/OptionPicker.vue'
import type { PickerOption } from '@/components/ui/pickerOption.types'
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

    const t = ctx.t as unknown as (key: string, params?: Record<string, unknown>) => string

    const permissionPresetPickerOptions = computed<PickerOption[]>(() => [
      { value: 'safe', label: t('settings.opencodeConfig.sections.permissions.presets.options.safeDefault') },
      { value: 'power', label: t('settings.opencodeConfig.sections.permissions.presets.options.powerUser') },
      { value: 'readonly', label: t('settings.opencodeConfig.sections.permissions.presets.options.readOnly') },
    ])

    const permissionPresetModePickerOptions = computed<PickerOption[]>(() => [
      { value: 'merge', label: t('settings.opencodeConfig.sections.permissions.presets.options.merge') },
      { value: 'replace', label: t('settings.opencodeConfig.sections.permissions.presets.options.replace') },
    ])

    return Object.assign(ctx, {
      permissionPresetPickerOptions,
      permissionPresetModePickerOptions,
    })
  },
})
</script>

<template>
  <div class="rounded-md border border-border p-3 space-y-3">
    <div class="text-sm font-semibold">{{ t('settings.opencodeConfig.sections.permissions.presets.title') }}</div>
    <div class="grid gap-3 lg:grid-cols-3">
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">{{
          t('settings.opencodeConfig.sections.permissions.presets.fields.preset')
        }}</span>
        <OptionPicker
          v-model="permissionPreset"
          :options="permissionPresetPickerOptions"
          :title="t('settings.opencodeConfig.sections.permissions.presets.fields.preset')"
          :search-placeholder="t('settings.opencodeConfig.sections.permissions.presets.search.searchPresets')"
          :empty-label="t('settings.opencodeConfig.sections.common.none')"
        />
      </label>
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">{{
          t('settings.opencodeConfig.sections.permissions.presets.fields.applyMode')
        }}</span>
        <OptionPicker
          v-model="permissionPresetMode"
          :options="permissionPresetModePickerOptions"
          :title="t('settings.opencodeConfig.sections.permissions.presets.fields.applyMode')"
          :search-placeholder="t('settings.opencodeConfig.sections.permissions.presets.search.searchModes')"
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
          :title="t('settings.opencodeConfig.sections.permissions.presets.actions.applyPreset')"
          :aria-label="t('settings.opencodeConfig.sections.permissions.presets.actions.applyPreset')"
          @click="applyPermissionPreset"
          :disabled="!permissionPreset"
        >
          <RiCheckLine class="h-4 w-4" />
        </Button>
        <template #content>{{
          t('settings.opencodeConfig.sections.permissions.presets.actions.applyPreset')
        }}</template>
      </Tooltip>
      <span class="text-[11px] text-muted-foreground">{{
        t('settings.opencodeConfig.sections.permissions.presets.tip')
      }}</span>
    </div>
  </div>
</template>

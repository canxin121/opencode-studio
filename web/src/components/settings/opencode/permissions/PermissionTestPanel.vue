<script lang="ts">
import { computed, defineComponent } from 'vue'

import Input from '@/components/ui/Input.vue'
import OptionPicker, { type PickerOption } from '@/components/ui/OptionPicker.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

export default defineComponent({
  components: {
    Input,
    OptionPicker,
  },
  setup() {
    const ctx = useOpencodeConfigPanelContext()

    const permissionTestToolPickerOptions = computed<PickerOption[]>(() => {
      const list = Array.isArray(ctx.permissionTestToolOptions) ? ctx.permissionTestToolOptions : []
      return list.map((id: string) => ({ value: id, label: id }))
    })

    return Object.assign(ctx, { permissionTestToolPickerOptions })
  },
})
</script>

<template>
  <div class="rounded-md border border-border p-3 space-y-3">
    <div class="text-sm font-semibold">{{ t('settings.opencodeConfig.sections.permissions.test.title') }}</div>
    <div class="grid gap-3 lg:grid-cols-3">
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.permissions.test.fields.tool') }}</span>
        <OptionPicker
          v-model="permissionTestTool"
          :options="permissionTestToolPickerOptions"
          :title="t('settings.opencodeConfig.sections.permissions.test.fields.tool')"
          :search-placeholder="t('settings.opencodeConfig.sections.permissions.test.search.searchTools')"
          :include-empty="false"
          monospace
        />
      </label>
      <label class="grid gap-1 lg:col-span-2">
        <span class="text-xs text-muted-foreground">{{ t('settings.opencodeConfig.sections.permissions.test.fields.input') }}</span>
        <Input v-model="permissionTestInput" :placeholder="t('settings.opencodeConfig.sections.permissions.test.placeholders.input')" />
      </label>
    </div>
    <div class="grid gap-1 text-xs text-muted-foreground">
      <div>
        <span class="font-semibold">{{ t('settings.opencodeConfig.sections.permissions.test.result.label') }}</span>
        {{
          t('settings.opencodeConfig.sections.permissions.test.result.summary', {
            action: permissionTestResult.action,
            source: permissionTestResult.source,
            matched: permissionTestResult.matched,
          })
        }}
      </div>
      <div v-for="(s, idx) in permissionTestResult.steps" :key="`pts:${idx}`">
        <span class="font-mono">{{ s.key }}</span
        >:
        <span v-if="s.kind === 'absent'">{{ t('settings.opencodeConfig.sections.permissions.test.steps.noRule') }}</span>
        <span v-else>{{
          t('settings.opencodeConfig.sections.permissions.test.steps.stepLine', {
            kind: s.kind,
            matchedText: s.matched ? ` ${t('settings.opencodeConfig.sections.permissions.test.steps.matchWord')} ${String(s.matched)}` : '',
            action: s.action || t('settings.opencodeConfig.sections.permissions.test.steps.noneAction'),
          })
        }}</span>
      </div>
      <div class="text-[11px]">{{ permissionTestResult.note }}</div>
    </div>
  </div>
</template>

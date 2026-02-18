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
    <div class="text-sm font-semibold">Test permission</div>
    <div class="grid gap-3 lg:grid-cols-3">
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Tool</span>
        <OptionPicker
          v-model="permissionTestTool"
          :options="permissionTestToolPickerOptions"
          title="Tool"
          search-placeholder="Search tools"
          :include-empty="false"
          monospace
        />
      </label>
      <label class="grid gap-1 lg:col-span-2">
        <span class="text-xs text-muted-foreground">Input (path/command)</span>
        <Input v-model="permissionTestInput" placeholder="src/app.ts or curl https://…" />
      </label>
    </div>
    <div class="grid gap-1 text-xs text-muted-foreground">
      <div>
        <span class="font-semibold">Result:</span> {{ permissionTestResult.action }} (source:
        {{ permissionTestResult.source }}, matched: {{ permissionTestResult.matched }})
      </div>
      <div v-for="(s, idx) in permissionTestResult.steps" :key="`pts:${idx}`">
        <span class="font-mono">{{ s.key }}</span
        >:
        <span v-if="s.kind === 'absent'">(no rule)</span>
        <span v-else>{{ s.kind }}{{ s.matched ? ' match ' + s.matched : '' }} -> {{ s.action || '(none)' }}</span>
      </div>
      <div class="text-[11px]">{{ permissionTestResult.note }}</div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'

import Input from '@/components/ui/Input.vue'

import { useOpencodeConfigPanelContext } from '../opencodeConfigContext'

export default defineComponent({
  components: {
    Input,
  },
  setup() {
    return useOpencodeConfigPanelContext()
  },
})
</script>

<template>
  <div class="rounded-md border border-border p-3 space-y-3">
    <div class="text-sm font-semibold">Test permission</div>
    <div class="grid gap-3 lg:grid-cols-3">
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Tool</span>
        <select v-model="permissionTestTool" class="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
          <option v-for="id in permissionTestToolOptions" :key="`pt:${id}`" :value="id">{{ id }}</option>
        </select>
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

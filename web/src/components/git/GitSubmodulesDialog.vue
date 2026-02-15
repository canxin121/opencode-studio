<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'
import ScrollArea from '@/components/ui/ScrollArea.vue'

import type { GitSubmoduleInfo } from '@/types/git'

const props = defineProps<{
  open: boolean
  loading: boolean
  error: string | null
  submodules: GitSubmoduleInfo[]
  newUrl: string
  newPath: string
  newBranch: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:newUrl', value: string): void
  (e: 'update:newPath', value: string): void
  (e: 'update:newBranch', value: string): void
  (e: 'refresh'): void
  (e: 'add'): void
  (e: 'init', path: string): void
  (e: 'update', payload: { path: string; recursive: boolean; init: boolean }): void
}>()

function onUpdateOpen(v: boolean) {
  emit('update:open', v)
}

function onUpdateText(key: 'newUrl' | 'newPath' | 'newBranch', v: string | number) {
  const s = String(v)
  if (key === 'newUrl') emit('update:newUrl', s)
  if (key === 'newPath') emit('update:newPath', s)
  if (key === 'newBranch') emit('update:newBranch', s)
}
</script>

<template>
  <FormDialog
    :open="open"
    title="Submodules"
    description="Manage git submodules"
    maxWidth="max-w-3xl"
    @update:open="onUpdateOpen"
  >
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <div class="text-xs font-medium text-muted-foreground">Add submodule</div>
        <Button variant="secondary" size="sm" :disabled="loading" @click="$emit('refresh')">Refresh</Button>
      </div>

      <div class="grid gap-2 lg:grid-cols-[1fr_1fr]">
        <Input
          :model-value="newUrl"
          class="h-9 font-mono text-xs"
          placeholder="https://github.com/org/repo.git"
          @update:model-value="(v) => onUpdateText('newUrl', v)"
        />
        <Input
          :model-value="newPath"
          class="h-9 font-mono text-xs"
          placeholder="path/to/submodule"
          @update:model-value="(v) => onUpdateText('newPath', v)"
        />
      </div>
      <div class="grid gap-2 lg:grid-cols-[1fr_auto]">
        <Input
          :model-value="newBranch"
          class="h-9 font-mono text-xs"
          placeholder="(optional) branch"
          @update:model-value="(v) => onUpdateText('newBranch', v)"
        />
        <Button size="sm" :disabled="!newUrl.trim() || !newPath.trim()" @click="$emit('add')">Add</Button>
      </div>

      <div class="rounded-md border border-border/50 overflow-hidden">
        <div v-if="error" class="p-3 text-xs text-red-500">{{ error }}</div>
        <div v-else-if="loading" class="p-3 text-xs text-muted-foreground">Loading...</div>
        <ScrollArea v-else class="h-64">
          <div v-if="!submodules.length" class="p-3 text-xs text-muted-foreground">No submodules</div>
          <div v-else class="divide-y divide-border/40">
            <div v-for="s in submodules" :key="s.path" class="p-3 space-y-2">
              <div class="text-xs font-mono">{{ s.path }}</div>
              <div class="text-[11px] text-muted-foreground font-mono break-all">{{ s.url }}</div>
              <div v-if="s.branch" class="text-[11px] text-muted-foreground">Branch: {{ s.branch }}</div>
              <div class="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" class="h-7" @click="$emit('init', s.path)">Init</Button>
                <Button
                  variant="secondary"
                  size="sm"
                  class="h-7"
                  @click="$emit('update', { path: s.path, recursive: false, init: false })"
                >
                  Update
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  class="h-7"
                  @click="$emit('update', { path: s.path, recursive: true, init: true })"
                >
                  Update (init+recursive)
                </Button>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  </FormDialog>
</template>

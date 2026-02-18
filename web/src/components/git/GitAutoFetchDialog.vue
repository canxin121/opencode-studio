<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'
import OptionPicker, { type PickerOption } from '@/components/ui/OptionPicker.vue'

const props = defineProps<{
  open: boolean
  autoFetchEnabled: boolean
  autoFetchInterval: number
  autoSyncEnabled: boolean
  autoSyncInterval: number
  postCommitCommand: 'none' | 'push' | 'sync'
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:autoFetchEnabled', value: boolean): void
  (e: 'update:autoFetchInterval', value: number): void
  (e: 'update:autoSyncEnabled', value: boolean): void
  (e: 'update:autoSyncInterval', value: number): void
  (e: 'update:postCommitCommand', value: 'none' | 'push' | 'sync'): void
}>()

function onUpdateOpen(v: boolean) {
  emit('update:open', v)
}

function onToggleFetch(ev: Event) {
  const el = ev.target as HTMLInputElement | null
  emit('update:autoFetchEnabled', Boolean(el?.checked))
}

function onToggleSync(ev: Event) {
  const el = ev.target as HTMLInputElement | null
  emit('update:autoSyncEnabled', Boolean(el?.checked))
}

function onUpdateInterval(key: 'fetch' | 'sync', v: string | number) {
  const n = Math.max(1, Number(v) || 0)
  if (key === 'fetch') emit('update:autoFetchInterval', n)
  if (key === 'sync') emit('update:autoSyncInterval', n)
}

const postCommitCommandPickerOptions: PickerOption[] = [
  { value: 'none', label: 'Prompt' },
  { value: 'push', label: 'Push' },
  { value: 'sync', label: 'Sync' },
]

function onUpdatePostCommitCommand(value: string | number) {
  const v = String(value || '').trim()
  if (v === 'push' || v === 'sync') {
    emit('update:postCommitCommand', v)
    return
  }
  emit('update:postCommitCommand', 'none')
}
</script>

<template>
  <FormDialog
    :open="open"
    title="Auto Fetch / Sync"
    description="Background git updates"
    maxWidth="max-w-md"
    @update:open="onUpdateOpen"
  >
    <div class="space-y-4">
      <div class="space-y-2">
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" class="accent-primary" :checked="autoFetchEnabled" @change="onToggleFetch" />
          Auto fetch
        </label>
        <div class="grid gap-1">
          <div class="text-xs text-muted-foreground">Fetch interval (minutes)</div>
          <Input
            type="number"
            class="h-9 font-mono text-xs"
            :model-value="autoFetchInterval"
            @update:model-value="(v) => onUpdateInterval('fetch', v)"
          />
        </div>
      </div>

      <div class="space-y-2">
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" class="accent-primary" :checked="autoSyncEnabled" @change="onToggleSync" />
          Auto sync (pull + push)
        </label>
        <div class="text-[11px] text-muted-foreground">
          Use with care — sync can fail if you have local changes or conflicts.
        </div>
        <div class="grid gap-1">
          <div class="text-xs text-muted-foreground">Sync interval (minutes)</div>
          <Input
            type="number"
            class="h-9 font-mono text-xs"
            :model-value="autoSyncInterval"
            @update:model-value="(v) => onUpdateInterval('sync', v)"
          />
        </div>
      </div>

      <div class="space-y-2">
        <div class="text-sm">Post-commit action</div>
        <div class="text-[11px] text-muted-foreground">
          After commit, run an action when the branch has an upstream and is ahead.
        </div>
        <OptionPicker
          :model-value="postCommitCommand"
          :options="postCommitCommandPickerOptions"
          title="Post-commit action"
          search-placeholder="Search actions"
          :include-empty="false"
          trigger-class="bg-background px-2 text-xs"
          @update:model-value="onUpdatePostCommitCommand"
        />
      </div>

      <div class="flex justify-end">
        <Button variant="secondary" size="sm" @click="$emit('update:open', false)">Close</Button>
      </div>
    </div>
  </FormDialog>
</template>

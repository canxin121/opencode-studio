<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/Button.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'
import OptionPicker, { type PickerOption } from '@/components/ui/OptionPicker.vue'

const { t } = useI18n()

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

const postCommitCommandPickerOptions = computed<PickerOption[]>(() => [
  { value: 'none', label: t('git.ui.postCommit.prompt') },
  { value: 'push', label: t('git.actions.push') },
  { value: 'sync', label: t('git.actions.sync') },
])

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
    :title="t('git.ui.dialogs.autoFetchSync.title')"
    :description="t('git.ui.dialogs.autoFetchSync.description')"
    maxWidth="max-w-md"
    @update:open="onUpdateOpen"
  >
    <div class="space-y-4">
      <div class="space-y-2">
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" class="accent-primary" :checked="autoFetchEnabled" @change="onToggleFetch" />
          {{ t('git.ui.dialogs.autoFetchSync.autoFetch') }}
        </label>
        <div class="grid gap-1">
          <div class="text-xs text-muted-foreground">{{ t('git.ui.dialogs.autoFetchSync.fetchIntervalMinutes') }}</div>
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
          {{ t('git.ui.dialogs.autoFetchSync.autoSync') }}
        </label>
        <div class="text-[11px] text-muted-foreground">
          {{ t('git.ui.dialogs.autoFetchSync.syncWarning') }}
        </div>
        <div class="grid gap-1">
          <div class="text-xs text-muted-foreground">{{ t('git.ui.dialogs.autoFetchSync.syncIntervalMinutes') }}</div>
          <Input
            type="number"
            class="h-9 font-mono text-xs"
            :model-value="autoSyncInterval"
            @update:model-value="(v) => onUpdateInterval('sync', v)"
          />
        </div>
      </div>

      <div class="space-y-2">
        <div class="text-sm">{{ t('git.ui.dialogs.autoFetchSync.postCommitAction') }}</div>
        <div class="text-[11px] text-muted-foreground">
          {{ t('git.ui.dialogs.autoFetchSync.postCommitHint') }}
        </div>
        <OptionPicker
          :model-value="postCommitCommand"
          :options="postCommitCommandPickerOptions"
          :title="t('git.ui.dialogs.autoFetchSync.postCommitAction')"
          :search-placeholder="t('common.searchActions')"
          :include-empty="false"
          trigger-class="bg-background px-2 text-xs"
          @update:model-value="onUpdatePostCommitCommand"
        />
      </div>

      <div class="flex justify-end">
        <Button variant="secondary" size="sm" @click="$emit('update:open', false)">{{ t('common.close') }}</Button>
      </div>
    </div>
  </FormDialog>
</template>

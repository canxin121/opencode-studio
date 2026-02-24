<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/Button.vue'
import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'
import OptionPicker, { type PickerOption } from '@/components/ui/OptionPicker.vue'
import ScrollArea from '@/components/ui/ScrollArea.vue'

import type { GitRemoteInfo } from '@/types/git'

const { t } = useI18n()

const props = defineProps<{
  open: boolean
  remotesLoading: boolean
  remotesError: string | null
  remotes: GitRemoteInfo[]
  newRemoteName: string
  newRemoteUrl: string
  selectedRemote: string
  renameRemoteTo: string
  setRemoteUrl: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:newRemoteName', value: string): void
  (e: 'update:newRemoteUrl', value: string): void
  (e: 'update:selectedRemote', value: string): void
  (e: 'update:renameRemoteTo', value: string): void
  (e: 'update:setRemoteUrl', value: string): void
  (e: 'refresh'): void
  (e: 'add'): void
  (e: 'rename'): void
  (e: 'setUrl'): void
  (e: 'remove', name: string): void
  (e: 'copyUrl', url: string): void
}>()

function onUpdateOpen(v: boolean) {
  emit('update:open', v)
}

function onUpdateText(key: 'newRemoteName' | 'newRemoteUrl' | 'renameRemoteTo' | 'setRemoteUrl', v: string | number) {
  const s = String(v)
  if (key === 'newRemoteName') emit('update:newRemoteName', s)
  if (key === 'newRemoteUrl') emit('update:newRemoteUrl', s)
  if (key === 'renameRemoteTo') emit('update:renameRemoteTo', s)
  if (key === 'setRemoteUrl') emit('update:setRemoteUrl', s)
}

function onSelectRemote(value: string | number) {
  emit('update:selectedRemote', String(value || ''))
}

const remotePickerOptions = computed<PickerOption[]>(() => {
  const list = Array.isArray(props.remotes) ? props.remotes : []
  return list.map((r) => ({ value: r.name, label: r.name }))
})

const selectedInfo = computed(() => props.remotes.find((r) => r.name === props.selectedRemote) || null)
</script>

<template>
  <FormDialog
    :open="open"
    :title="t('git.ui.dialogs.remotes.title')"
    :description="t('git.ui.dialogs.remotes.description')"
    maxWidth="max-w-2xl"
    @update:open="onUpdateOpen"
  >
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <div class="text-xs font-medium text-muted-foreground">{{ t('git.ui.dialogs.remotes.sections.addRemote') }}</div>
        <Button variant="secondary" size="sm" :disabled="remotesLoading" @click="$emit('refresh')">{{ t('common.refresh') }}</Button>
      </div>

      <div class="grid gap-2 lg:grid-cols-[140px_1fr_auto]">
        <Input
          :model-value="newRemoteName"
          class="h-9 font-mono text-xs"
          placeholder="origin"
          @update:model-value="(v) => onUpdateText('newRemoteName', v)"
        />
        <Input
          :model-value="newRemoteUrl"
          class="h-9 font-mono text-xs"
          placeholder="https://github.com/org/repo.git"
          @update:model-value="(v) => onUpdateText('newRemoteUrl', v)"
        />
        <Button size="sm" :disabled="!newRemoteName.trim() || !newRemoteUrl.trim()" @click="$emit('add')">{{ t('common.add') }}</Button>
      </div>

      <div class="grid gap-2">
        <div class="text-xs font-medium text-muted-foreground">{{ t('git.ui.dialogs.remotes.sections.manageRemote') }}</div>
        <OptionPicker
          :model-value="selectedRemote"
          :options="remotePickerOptions"
          :title="t('git.fields.remote')"
          :search-placeholder="t('git.ui.searchRemotes')"
          :empty-label="t('git.ui.dialogs.remotes.selectRemote')"
          :empty-disabled="true"
          trigger-class="rounded border bg-background text-xs px-2"
          @update:model-value="onSelectRemote"
        />
        <div v-if="selectedInfo" class="text-[11px] text-muted-foreground font-mono break-all">
          {{ selectedInfo.url }}
        </div>

        <div class="grid gap-2 lg:grid-cols-[1fr_auto]">
          <Input
            :model-value="renameRemoteTo"
            class="h-9 font-mono text-xs"
            :placeholder="t('git.ui.dialogs.remotes.placeholders.newRemoteName')"
            @update:model-value="(v) => onUpdateText('renameRemoteTo', v)"
          />
          <Button size="sm" :disabled="!selectedRemote.trim() || !renameRemoteTo.trim()" @click="$emit('rename')"
            >{{ t('common.rename') }}</Button
          >
        </div>

        <div class="grid gap-2 lg:grid-cols-[1fr_auto]">
          <Input
            :model-value="setRemoteUrl"
            class="h-9 font-mono text-xs"
            :placeholder="t('git.ui.dialogs.remotes.placeholders.newRemoteUrl')"
            @update:model-value="(v) => onUpdateText('setRemoteUrl', v)"
          />
          <Button size="sm" :disabled="!selectedRemote.trim() || !setRemoteUrl.trim()" @click="$emit('setUrl')"
            >{{ t('git.ui.dialogs.remotes.actions.setUrl') }}</Button
          >
        </div>

        <div class="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            :disabled="!selectedInfo?.url"
            @click="selectedInfo?.url && $emit('copyUrl', selectedInfo.url)"
          >
            {{ t('git.ui.dialogs.remotes.actions.copyUrl') }}
          </Button>
          <ConfirmPopover
            :title="t('git.ui.dialogs.remotes.confirmRemove.title')"
            :description="t('git.ui.dialogs.remotes.confirmRemove.description')"
            :confirm-text="t('common.remove')"
            :cancel-text="t('common.cancel')"
            variant="destructive"
            @confirm="selectedRemote && $emit('remove', selectedRemote)"
          >
            <Button variant="secondary" size="sm" :disabled="!selectedRemote.trim()" @click="() => {}">
              {{ t('common.remove') }}
            </Button>
          </ConfirmPopover>
        </div>
      </div>

      <div class="rounded-md border border-border/50 overflow-hidden">
        <div v-if="remotesError" class="p-3 text-xs text-red-500">{{ remotesError }}</div>
        <div v-else-if="remotesLoading" class="p-3 text-xs text-muted-foreground">{{ t('common.loading') }}</div>
        <ScrollArea v-else class="h-40">
          <div v-if="!remotes.length" class="p-3 text-xs text-muted-foreground">{{ t('git.ui.dialogs.remotes.empty') }}</div>
          <div v-else class="divide-y divide-border/40">
            <button
              v-for="r in remotes"
              :key="`${r.name}:${r.url}`"
              type="button"
              class="w-full text-left p-3 hover:bg-muted/40"
              :class="selectedRemote === r.name ? 'bg-muted/50' : ''"
              @click="$emit('update:selectedRemote', r.name)"
            >
              <div class="text-xs font-medium font-mono">{{ r.name }}</div>
              <div class="text-[11px] text-muted-foreground font-mono break-all">{{ r.url }}</div>
            </button>
          </div>
        </ScrollArea>
      </div>
    </div>
  </FormDialog>
</template>

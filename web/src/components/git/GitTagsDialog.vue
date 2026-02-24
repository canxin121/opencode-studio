<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/Button.vue'
import ConfirmPopover from '@/components/ui/ConfirmPopover.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'
import OptionPicker from '@/components/ui/OptionPicker.vue'

import type { GitTagInfo } from '@/types/git'

const { t } = useI18n()

const props = defineProps<{
  open: boolean
  tagsLoading: boolean
  tagsList: GitTagInfo[]
  remoteNames: string[]
  newTagName: string
  newTagRef: string
  newTagMessage: string
  tagRemote: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:newTagName', value: string): void
  (e: 'update:newTagRef', value: string): void
  (e: 'update:newTagMessage', value: string): void
  (e: 'update:tagRemote', value: string): void
  (e: 'createTag'): void
  (e: 'refresh'): void
  (e: 'deleteLocal', name: string): void
  (e: 'deleteRemote', name: string): void
}>()

function onUpdateOpen(v: boolean) {
  emit('update:open', v)
}

function onUpdateText(key: 'newTagName' | 'newTagRef' | 'newTagMessage', v: string | number) {
  const s = String(v)
  if (key === 'newTagName') emit('update:newTagName', s)
  if (key === 'newTagRef') emit('update:newTagRef', s)
  if (key === 'newTagMessage') emit('update:newTagMessage', s)
}

const remotePickerOptions = computed(() => props.remoteNames.map((r) => ({ value: r, label: r })))

function onUpdateRemote(v: string | number) {
  emit('update:tagRemote', String(v || ''))
}
</script>

<template>
  <FormDialog
    :open="open"
    :title="t('git.ui.dialogs.tags.title')"
    :description="t('git.ui.dialogs.tags.description')"
    maxWidth="max-w-2xl"
    @update:open="onUpdateOpen"
  >
    <div class="space-y-4">
      <div class="grid gap-3">
        <div class="grid gap-1">
          <div class="text-xs font-medium text-muted-foreground">{{ t('git.ui.dialogs.tags.sections.createTag') }}</div>
          <div class="grid gap-2 lg:grid-cols-[160px_1fr]">
            <Input
              :model-value="newTagName"
              class="h-9 font-mono text-xs"
              placeholder="v1.2.3"
              @update:model-value="(v) => onUpdateText('newTagName', v)"
            />
            <Input
              :model-value="newTagRef"
              class="h-9 font-mono text-xs"
              placeholder="HEAD"
              @update:model-value="(v) => onUpdateText('newTagRef', v)"
            />
          </div>
          <Input
            :model-value="newTagMessage"
            class="h-9 font-mono text-xs"
            :placeholder="t('git.ui.dialogs.tags.placeholders.annotatedMessageOptional')"
            @update:model-value="(v) => onUpdateText('newTagMessage', v)"
          />
          <div class="flex justify-end">
            <Button size="sm" :disabled="!newTagName.trim()" @click="$emit('createTag')">{{ t('common.create') }}</Button>
          </div>
        </div>

        <div class="grid gap-1">
          <div class="text-xs font-medium text-muted-foreground">{{ t('git.ui.dialogs.tags.sections.remoteForDeletingTags') }}</div>
          <OptionPicker
            :model-value="tagRemote"
            :options="remotePickerOptions"
            :title="t('git.fields.remote')"
            :search-placeholder="t('git.ui.searchRemotes')"
            :include-empty="false"
            trigger-class="rounded border bg-background text-xs px-2"
            @update:model-value="onUpdateRemote"
          />
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="text-xs font-medium text-muted-foreground">{{ t('git.ui.dialogs.tags.sections.existingTags') }}</div>
        <Button variant="secondary" size="sm" :disabled="tagsLoading" @click="$emit('refresh')">{{ t('common.refresh') }}</Button>
      </div>

      <div class="rounded-md border border-border/50 overflow-hidden">
        <div v-if="tagsLoading" class="p-3 text-xs text-muted-foreground">{{ t('common.loading') }}</div>
        <div v-else-if="!tagsList.length" class="p-3 text-xs text-muted-foreground">{{ t('git.ui.dialogs.tags.empty') }}</div>
        <div v-else class="divide-y divide-border/40">
          <div
            v-for="tag in tagsList"
            :key="tag.name"
            class="p-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3"
          >
            <div class="min-w-0 flex-1">
              <div class="font-mono text-xs">{{ tag.name }}</div>
              <div class="text-[11px] text-muted-foreground font-mono">
                {{ tag.object.slice(0, 8) }}{{ tag.creatorDate ? ` · ${tag.creatorDate}` : '' }}
              </div>
              <div v-if="tag.subject" class="text-[11px] text-muted-foreground mt-1">{{ tag.subject }}</div>
            </div>
            <div class="flex flex-wrap items-center gap-2 sm:justify-end">
              <ConfirmPopover
                :title="t('git.ui.dialogs.tags.confirmDeleteLocal.title')"
                :description="t('git.ui.dialogs.tags.confirmDeleteLocal.description')"
                :confirm-text="t('common.delete')"
                :cancel-text="t('common.cancel')"
                variant="destructive"
                @confirm="$emit('deleteLocal', tag.name)"
              >
                <Button variant="secondary" size="sm" class="h-8" @click="() => {}">{{ t('common.delete') }}</Button>
              </ConfirmPopover>
              <ConfirmPopover
                :title="t('git.ui.dialogs.tags.confirmDeleteRemote.title')"
                :description="t('git.ui.dialogs.tags.confirmDeleteRemote.description')"
                :confirm-text="t('common.delete')"
                :cancel-text="t('common.cancel')"
                variant="destructive"
                @confirm="$emit('deleteRemote', tag.name)"
              >
                <Button variant="secondary" size="sm" class="h-8" @click="() => {}">
                  {{ t('git.ui.dialogs.tags.actions.deleteRemote') }}
                </Button>
              </ConfirmPopover>
            </div>
          </div>
        </div>
      </div>

      <div class="flex justify-end">
        <Button variant="secondary" size="sm" @click="$emit('update:open', false)">{{ t('common.close') }}</Button>
      </div>
    </div>
  </FormDialog>
</template>

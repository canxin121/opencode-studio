<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/Button.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'

const { t } = useI18n()

const props = defineProps<{
  open: boolean
  projectRoot: string
  path: string
  defaultBranch: string
  busy: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:path', value: string): void
  (e: 'update:defaultBranch', value: string): void
  (e: 'initialize'): void
}>()

function onUpdateOpen(v: boolean) {
  emit('update:open', v)
}

function onUpdatePath(v: string | number) {
  emit('update:path', String(v))
}

function onUpdateDefaultBranch(v: string | number) {
  emit('update:defaultBranch', String(v))
}
</script>

<template>
  <FormDialog
    :open="open"
    :title="t('git.ui.dialogs.initRepo.title')"
    :description="t('git.ui.dialogs.initRepo.description')"
    maxWidth="max-w-md"
    @update:open="onUpdateOpen"
  >
    <div class="space-y-3">
      <div class="space-y-1">
        <div class="text-xs font-medium text-muted-foreground">{{ t('git.ui.dialogs.initRepo.fields.path') }}</div>
        <Input
          :model-value="path"
          class="h-9 font-mono text-xs"
          :placeholder="t('git.ui.dialogs.initRepo.placeholders.path')"
          @update:model-value="onUpdatePath"
        />
        <div class="text-[11px] text-muted-foreground">{{ t('git.ui.dialogs.initRepo.hints.pathExamples') }}</div>
      </div>

      <div class="space-y-1">
        <div class="text-xs font-medium text-muted-foreground">
          {{ t('git.ui.dialogs.initRepo.fields.defaultBranchOptional') }}
        </div>
        <Input
          :model-value="defaultBranch"
          class="h-9 font-mono text-xs"
          placeholder="main"
          @update:model-value="onUpdateDefaultBranch"
        />
        <div class="text-[11px] text-muted-foreground">{{ t('git.ui.dialogs.initRepo.hints.initialBranchFlag') }}</div>
      </div>

      <div class="flex justify-end gap-2">
        <Button variant="secondary" size="sm" @click="$emit('update:open', false)" :disabled="busy">{{
          t('common.cancel')
        }}</Button>
        <Button size="sm" @click="$emit('initialize')" :disabled="busy || !projectRoot">{{
          t('git.ui.dialogs.initRepo.actions.initialize')
        }}</Button>
      </div>
    </div>
  </FormDialog>
</template>

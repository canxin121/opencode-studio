<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/Button.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'

const { t } = useI18n()

const props = defineProps<{
  open: boolean
  projectRoot: string
  url: string
  path: string
  cloneRef: string
  recursive: boolean
  busy: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:url', value: string): void
  (e: 'update:path', value: string): void
  (e: 'update:cloneRef', value: string): void
  (e: 'update:recursive', value: boolean): void
  (e: 'clone'): void
}>()

function onUpdateOpen(v: boolean) {
  emit('update:open', v)
}

function onUpdateUrl(v: string | number) {
  emit('update:url', String(v))
}

function onUpdatePath(v: string | number) {
  emit('update:path', String(v))
}

function onUpdateCloneRef(v: string | number) {
  emit('update:cloneRef', String(v))
}

function onUpdateRecursive(ev: Event) {
  const el = ev.target as HTMLInputElement | null
  emit('update:recursive', Boolean(el?.checked))
}
</script>

<template>
  <FormDialog
    :open="open"
    :title="t('git.ui.dialogs.clone.title')"
    :description="t('git.ui.dialogs.clone.description')"
    maxWidth="max-w-md"
    @update:open="onUpdateOpen"
  >
    <div class="space-y-3">
      <div class="space-y-1">
        <div class="text-xs font-medium text-muted-foreground">
          {{ t('git.ui.dialogs.clone.fields.repositoryUrl') }}
        </div>
        <Input
          :model-value="url"
          class="h-9 font-mono text-xs"
          :placeholder="t('git.ui.dialogs.clone.placeholders.repositoryUrl')"
          @update:model-value="onUpdateUrl"
        />
      </div>

      <div class="space-y-1">
        <div class="text-xs font-medium text-muted-foreground">{{ t('git.ui.dialogs.clone.fields.targetPath') }}</div>
        <Input
          :model-value="path"
          class="h-9 font-mono text-xs"
          :placeholder="t('git.ui.dialogs.clone.placeholders.targetPath')"
          @update:model-value="onUpdatePath"
        />
        <div class="text-[11px] text-muted-foreground">
          {{ t('git.ui.dialogs.clone.hints.targetPathExample') }}
        </div>
      </div>

      <div class="space-y-1">
        <div class="text-xs font-medium text-muted-foreground">
          {{ t('git.ui.dialogs.clone.fields.checkoutRefOptional') }}
        </div>
        <Input
          :model-value="cloneRef"
          class="h-9 font-mono text-xs"
          placeholder="main"
          @update:model-value="onUpdateCloneRef"
        />
      </div>

      <label class="inline-flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" class="accent-primary" :checked="recursive" @change="onUpdateRecursive" />
        <span>{{ t('git.ui.dialogs.clone.cloneSubmodulesRecursively') }}</span>
      </label>

      <div class="flex justify-end gap-2">
        <Button variant="secondary" size="sm" @click="$emit('update:open', false)" :disabled="busy">{{
          t('common.cancel')
        }}</Button>
        <Button size="sm" @click="$emit('clone')" :disabled="busy || !projectRoot || !url.trim()">{{
          t('git.ui.dialogs.clone.actions.clone')
        }}</Button>
      </div>
    </div>
  </FormDialog>
</template>

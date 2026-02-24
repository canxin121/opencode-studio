<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  open: boolean
  draft: string
  busy: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:draft', value: string): void
  (e: 'save'): void
}>()

const { t } = useI18n()

function onUpdateDraft(v: string | number) {
  emit('update:draft', String(v))
}
</script>

<template>
  <FormDialog
    :open="open"
    :title="t('chat.renameSessionDialog.title')"
    :description="t('chat.renameSessionDialog.description')"
    @update:open="$emit('update:open', $event)"
  >
    <div class="space-y-3">
      <Input
        :model-value="draft"
        :placeholder="t('chat.sidebar.sessionRow.placeholders.sessionTitle')"
        class="h-9"
        @update:model-value="onUpdateDraft"
      />
      <div class="flex items-center justify-end gap-2">
        <Button variant="ghost" @click="$emit('update:open', false)">{{ t('common.cancel') }}</Button>
        <Button @click="$emit('save')" :disabled="busy || !draft.trim()">{{
          busy ? t('common.saving') : t('common.save')
        }}</Button>
      </div>
    </div>
  </FormDialog>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/Button.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'

const { t } = useI18n()

const props = defineProps<{
  open: boolean
  detachedRef: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:detachedRef', value: string): void
  (e: 'checkout'): void
}>()

function onUpdateOpen(v: boolean) {
  emit('update:open', v)
}

function onUpdateRef(v: string | number) {
  emit('update:detachedRef', String(v))
}
</script>

<template>
  <FormDialog
    :open="open"
    :title="t('git.ui.dialogs.checkoutDetached.title')"
    :description="t('git.ui.dialogs.checkoutDetached.description')"
    maxWidth="max-w-md"
    @update:open="onUpdateOpen"
  >
    <div class="space-y-3">
      <Input
        :model-value="detachedRef"
        class="h-9 font-mono text-xs"
        :placeholder="t('git.ui.dialogs.checkoutDetached.placeholders.ref')"
        @update:model-value="onUpdateRef"
      />
      <div class="flex justify-end gap-2">
        <Button variant="secondary" size="sm" @click="$emit('update:open', false)">{{ t('common.cancel') }}</Button>
        <Button size="sm" :disabled="!detachedRef.trim()" @click="$emit('checkout')">{{ t('common.checkout') }}</Button>
      </div>
    </div>
  </FormDialog>
</template>

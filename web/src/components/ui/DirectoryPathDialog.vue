<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/Button.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import PathPicker from '@/components/ui/PathPicker.vue'

const { t } = useI18n()

const props = defineProps<{
  open: boolean
  path: string
  title: string
  description?: string
  placeholder?: string
  confirmLabel: string
  confirmDisabled?: boolean
  basePath?: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:path', value: string): void
  (e: 'confirm'): void
}>()

const pathModel = computed({
  get: () => props.path,
  set: (value: string) => emit('update:path', value),
})

const confirmButtonDisabled = computed(() => {
  if (props.confirmDisabled !== undefined) return props.confirmDisabled
  return !pathModel.value.trim()
})
</script>

<template>
  <FormDialog
    :open="open"
    :title="title"
    :description="description"
    @update:open="(value) => emit('update:open', value)"
  >
    <div class="flex min-h-0 flex-col gap-3">
      <PathPicker
        v-model="pathModel"
        :placeholder="placeholder"
        view="browser"
        mode="directory"
        :resolve-to-absolute="true"
        :base-path="basePath || ''"
        :show-options="true"
        :show-gitignored="true"
        :allow-create-directory="true"
        input-class="h-9 font-mono"
        browser-class="flex h-[min(56vh,34rem)] min-h-[14rem] min-h-0 flex-col overflow-hidden"
      />
      <div class="flex flex-none items-center justify-end gap-2">
        <Button variant="ghost" @click="emit('update:open', false)">
          {{ t('common.cancel') }}
        </Button>
        <Button :disabled="confirmButtonDisabled" @click="emit('confirm')">
          {{ confirmLabel }}
        </Button>
      </div>
    </div>
  </FormDialog>
</template>

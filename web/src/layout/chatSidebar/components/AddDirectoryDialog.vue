<script setup lang="ts">
import { computed } from 'vue'
import { RiCloseLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/Button.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import PathPicker from '@/components/ui/PathPicker.vue'

const { t } = useI18n()

const props = defineProps<{
  open: boolean
  path: string
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'update:path', v: string): void
  (e: 'add'): void
}>()

const pathModel = computed({
  get: () => props.path,
  set: (v: string) => emit('update:path', v),
})
</script>

<template>
  <FormDialog
    :open="open"
    :title="String(t('chat.sidebar.addDirectoryDialog.title'))"
    :description="String(t('chat.sidebar.addDirectoryDialog.description'))"
    @update:open="(v) => emit('update:open', v)"
  >
    <div class="flex min-h-0 flex-col gap-3">
      <PathPicker
        v-model="pathModel"
        :placeholder="String(t('chat.sidebar.addDirectoryDialog.placeholders.path'))"
        view="browser"
        mode="directory"
        :resolve-to-absolute="true"
        :show-options="true"
        :show-gitignored="true"
        input-class="h-9 font-mono"
        browser-class="flex h-[min(56vh,34rem)] min-h-[14rem] flex-col"
      />
      <div class="flex items-center justify-end gap-2 flex-none">
        <Button variant="ghost" @click="emit('update:open', false)">
          <RiCloseLine class="h-4 w-4" />
          {{ t('common.cancel') }}
        </Button>
        <Button @click="emit('add')" :disabled="!pathModel.trim()">{{ t('common.add') }}</Button>
      </div>
    </div>
  </FormDialog>
</template>

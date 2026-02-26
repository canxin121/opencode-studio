<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import DirectoryPathDialog from '@/components/ui/DirectoryPathDialog.vue'

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
</script>

<template>
  <DirectoryPathDialog
    :open="open"
    :path="path"
    :title="String(t('chat.sidebar.addDirectoryDialog.title'))"
    :description="String(t('chat.sidebar.addDirectoryDialog.description'))"
    :placeholder="String(t('chat.sidebar.addDirectoryDialog.placeholders.path'))"
    :confirm-label="String(t('common.add'))"
    :allow-create-directory="true"
    @update:open="(v) => emit('update:open', v)"
    @update:path="(v) => emit('update:path', v)"
    @confirm="emit('add')"
  />
</template>

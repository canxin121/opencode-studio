<script setup lang="ts">
import { ref } from 'vue'
import { RiArrowLeftRightLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/Button.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import Input from '@/components/ui/Input.vue'
import DiffViewer from '@/components/DiffViewer.vue'

const { t } = useI18n()
const wrapLines = ref(true)

const props = defineProps<{
  open: boolean
  base: string
  head: string
  path: string
  diff: string
  loading: boolean
  error: string | null
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:base', value: string): void
  (e: 'update:head', value: string): void
  (e: 'update:path', value: string): void
  (e: 'swap'): void
  (e: 'compare'): void
}>()

function onUpdateOpen(v: boolean) {
  emit('update:open', v)
}

function onUpdateText(key: 'base' | 'head' | 'path', v: string | number) {
  const s = String(v)
  if (key === 'base') emit('update:base', s)
  if (key === 'head') emit('update:head', s)
  if (key === 'path') emit('update:path', s)
}
</script>

<template>
  <FormDialog
    :open="open"
    :title="t('git.ui.dialogs.compare.title')"
    :description="t('git.ui.dialogs.compare.description')"
    maxWidth="max-w-5xl"
    @update:open="onUpdateOpen"
  >
    <div class="space-y-3">
      <div class="grid gap-2 lg:grid-cols-[1fr_1fr_auto_auto]">
        <Input
          :model-value="base"
          class="h-9 font-mono text-xs"
          :placeholder="t('git.ui.dialogs.compare.placeholders.base')"
          @update:model-value="(v) => onUpdateText('base', v)"
        />
        <Input
          :model-value="head"
          class="h-9 font-mono text-xs"
          :placeholder="t('git.ui.dialogs.compare.placeholders.head')"
          @update:model-value="(v) => onUpdateText('head', v)"
        />
        <Button
          variant="secondary"
          size="sm"
          :disabled="loading"
          :title="t('git.ui.dialogs.compare.actions.swapRefs')"
          @click="$emit('swap')"
        >
          <RiArrowLeftRightLine class="h-4 w-4" />
        </Button>
        <Button size="sm" :disabled="!base.trim() || !head.trim() || loading" @click="$emit('compare')">
          {{ t('git.ui.dialogs.compare.actions.compare') }}
        </Button>
      </div>

      <Input
        :model-value="path"
        class="h-9 font-mono text-xs"
        :placeholder="t('git.ui.dialogs.compare.placeholders.pathOptional')"
        @update:model-value="(v) => onUpdateText('path', v)"
      />

      <div class="rounded-md border border-border/50 bg-background/40 p-3 min-h-[20rem]">
        <div class="mb-2 flex justify-end">
          <Button variant="secondary" size="sm" class="h-7" @click="wrapLines = !wrapLines">{{
            wrapLines ? t('git.ui.dialogs.compare.wrap.disable') : t('git.ui.dialogs.compare.wrap.enable')
          }}</Button>
        </div>
        <div v-if="error" class="text-xs text-red-500">{{ error }}</div>
        <div v-else-if="loading" class="text-xs text-muted-foreground">{{ t('git.ui.diffViewer.loading') }}</div>
        <div v-else-if="!diff" class="text-xs text-muted-foreground">{{ t('git.ui.dialogs.compare.empty') }}</div>
        <div v-else class="h-[420px] min-h-0">
          <DiffViewer :diff="diff" :output-format="'side-by-side'" :draw-file-list="false" :wrap="wrapLines" />
        </div>
      </div>
    </div>
  </FormDialog>
</template>

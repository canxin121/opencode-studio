<script setup lang="ts">
import { computed, ref } from 'vue'
import { RiArrowLeftRightLine, RiTextWrap } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import Button from '@/components/ui/Button.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import IconButton from '@/components/ui/IconButton.vue'
import Input from '@/components/ui/Input.vue'
import MonacoDiffEditor from '@/components/MonacoDiffEditor.vue'
import { buildUnifiedMonacoDiffModel } from '@/features/git/diff/unifiedDiff'

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

const compareDiffModel = computed(() => buildUnifiedMonacoDiffModel(props.diff || ''))
const compareModelId = computed(() => `git-compare:${compareDiffModel.value.path}`)

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
          <IconButton
            variant="outline"
            size="sm"
            class="h-7 w-7 transition-colors"
            :class="
              wrapLines
                ? 'bg-secondary/70 text-foreground shadow-inner'
                : 'text-muted-foreground hover:bg-secondary/40 hover:text-foreground'
            "
            :title="wrapLines ? t('git.ui.dialogs.compare.wrap.disable') : t('git.ui.dialogs.compare.wrap.enable')"
            :aria-label="wrapLines ? t('git.ui.dialogs.compare.wrap.disable') : t('git.ui.dialogs.compare.wrap.enable')"
            :aria-pressed="wrapLines"
            @click="wrapLines = !wrapLines"
          >
            <RiTextWrap class="h-4 w-4" />
          </IconButton>
        </div>
        <div v-if="error" class="text-xs text-red-500">{{ error }}</div>
        <div v-else-if="loading" class="text-xs text-muted-foreground">{{ t('git.ui.diffViewer.loading') }}</div>
        <div v-else-if="!diff" class="text-xs text-muted-foreground">{{ t('git.ui.dialogs.compare.empty') }}</div>
        <div v-else class="h-[420px] min-h-0">
          <MonacoDiffEditor
            :original-value="compareDiffModel.original"
            :modified-value="compareDiffModel.modified"
            :path="compareDiffModel.path"
            :language-path="compareDiffModel.path"
            :model-id="compareModelId"
            :original-model-id="`${compareModelId}:base`"
            :use-files-theme="true"
            :read-only="true"
            :wrap="wrapLines"
          />
        </div>
      </div>
    </div>
  </FormDialog>
</template>

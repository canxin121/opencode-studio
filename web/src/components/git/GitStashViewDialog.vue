<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import Dialog from '@/components/ui/Dialog.vue'
import MonacoDiffEditor from '@/components/MonacoDiffEditor.vue'
import { buildUnifiedMonacoDiffModel } from '@/features/git/diff/unifiedDiff'

const { t } = useI18n()

const props = defineProps<{
  open: boolean
  title: string
  diff: string
  loading: boolean
  error: string | null
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

function onUpdateOpen(v: boolean) {
  emit('update:open', v)
}

const dialogTitle = computed(() =>
  props.title ? t('git.ui.dialogs.stashDiff.titleWithRef', { ref: props.title }) : t('git.ui.dialogs.stashDiff.title'),
)

const stashDiffModel = computed(() => buildUnifiedMonacoDiffModel(props.diff || ''))
const stashModelId = computed(() => `git-stash:${stashDiffModel.value.path}`)
</script>

<template>
  <Dialog
    :open="open"
    :title="dialogTitle"
    :description="t('git.ui.dialogs.stashDiff.description')"
    maxWidth="max-w-5xl"
    @update:open="onUpdateOpen"
  >
    <div class="space-y-2">
      <div v-if="loading" class="text-xs text-muted-foreground">{{ t('git.ui.dialogs.stashDiff.loading') }}</div>
      <div
        v-else-if="error"
        class="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
      >
        {{ error }}
      </div>
      <div v-else-if="diff.trim()" class="h-[70vh] min-h-[20rem]">
        <MonacoDiffEditor
          :original-value="stashDiffModel.original"
          :modified-value="stashDiffModel.modified"
          :path="stashDiffModel.path"
          :language-path="stashDiffModel.path"
          :model-id="stashModelId"
          :original-model-id="`${stashModelId}:base`"
          :use-files-theme="true"
          :read-only="true"
          :wrap="false"
        />
      </div>
      <div v-else class="text-xs text-muted-foreground">{{ t('git.ui.dialogs.stashDiff.empty') }}</div>
    </div>
  </Dialog>
</template>

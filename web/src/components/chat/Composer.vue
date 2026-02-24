<script setup lang="ts">
import { ref } from 'vue'
import { RiArrowDownLine, RiEditLine } from '@remixicon/vue'
import { useI18n } from 'vue-i18n'

import AttachmentPicker from '@/components/chat/AttachmentPicker.vue'

const props = defineProps<{
  draft: string
  fullscreen: boolean
}>()

const emit = defineEmits<{
  (e: 'update:draft', value: string): void
  (e: 'toggleFullscreen'): void
  (e: 'drop', ev: DragEvent): void
  (e: 'paste', ev: ClipboardEvent): void
  (e: 'draftInput'): void
  (e: 'draftKeydown', ev: KeyboardEvent): void
  (e: 'filesSelected', files: FileList): void
}>()

const shellEl = ref<HTMLDivElement | null>(null)
const textareaEl = ref<HTMLTextAreaElement | null>(null)
const attachmentPickerRef = ref<InstanceType<typeof AttachmentPicker> | null>(null)

const { t } = useI18n()

function updateDraft(ev: Event) {
  const el = ev.target as HTMLTextAreaElement | null
  emit('update:draft', el?.value ?? '')
}

function openFilePicker() {
  attachmentPickerRef.value?.openFilePicker()
}

defineExpose({ shellEl, textareaEl, openFilePicker })
</script>

<template>
  <div
    ref="shellEl"
    class="composer-shell relative rounded-xl border border-input bg-background/70 shadow-sm overflow-visible flex flex-col"
    :class="fullscreen ? 'composer-fullscreen' : ''"
    data-oc-keyboard-tap="keep"
    @dragover.prevent
    @drop.prevent="$emit('drop', $event)"
  >
    <div class="absolute top-1 right-1 z-10 flex items-center gap-1">
      <button
        type="button"
        :data-oc-keyboard-tap="fullscreen ? 'blur' : 'keep'"
        class="h-6 w-6 rounded-md text-muted-foreground/80 hover:text-foreground hover:bg-secondary/60 flex items-center justify-center backdrop-blur bg-background/40 shadow-sm"
        :title="fullscreen ? t('chat.composer.editor.collapse') : t('chat.composer.editor.open')"
        :aria-label="fullscreen ? t('chat.composer.editor.collapse') : t('chat.composer.editor.open')"
        @pointerdown.prevent
        @click="$emit('toggleFullscreen')"
      >
        <component :is="fullscreen ? RiArrowDownLine : RiEditLine" class="h-4 w-4" />
      </button>
    </div>

    <textarea
      ref="textareaEl"
      :value="draft ?? ''"
      data-chat-input="true"
      class="w-full min-h-[84px] resize-none border-0 bg-transparent px-3 py-2 text-sm shadow-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0 flex-1 min-h-0"
      :class="fullscreen ? 'composer-textarea-full' : 'max-h-none'"
      :placeholder="t('chat.composer.input.placeholder')"
      spellcheck="false"
      @input="
        (ev) => {
          updateDraft(ev)
          $emit('draftInput')
        }
      "
      @click="$emit('draftInput')"
      @keyup="$emit('draftInput')"
      @paste="$emit('paste', $event)"
      @keydown="$emit('draftKeydown', $event)"
    />

    <AttachmentPicker ref="attachmentPickerRef" @filesSelected="$emit('filesSelected', $event)" />

    <slot name="controls" />
  </div>
</template>

<style scoped>
.composer-shell.composer-fullscreen {
  background-color: oklch(var(--background));
  height: 100%;
  flex: 1;
  min-height: 0;
}

.composer-textarea-full {
  flex: 1;
  min-height: 0;
  max-height: none;
}
</style>

<script setup lang="ts">
import { ref } from 'vue'
import { RiCloseLine } from '@remixicon/vue'

import IconButton from '@/components/ui/IconButton.vue'
import TextActionButton from '@/components/ui/TextActionButton.vue'

type AttachedFile = {
  id: string
  filename: string
  size: number
  mime: string
  url?: string
  serverPath?: string
}

const props = defineProps<{
  attachedFiles: AttachedFile[]
  formatBytes: (bytes: number) => string
}>()

const emit = defineEmits<{
  (e: 'filesSelected', files: FileList): void
  (e: 'remove', id: string): void
  (e: 'clear'): void
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)

function openFilePicker() {
  fileInputRef.value?.click()
}

function onChange(e: Event) {
  const input = e.target as HTMLInputElement | null
  const files = input?.files
  if (files && files.length) emit('filesSelected', files)
  if (input) input.value = ''
}

defineExpose({ openFilePicker })
</script>

<template>
  <input ref="fileInputRef" type="file" multiple class="hidden" accept="*/*" @change="onChange" />

  <div v-if="attachedFiles.length" class="px-2 pb-2">
    <div class="flex flex-wrap items-center gap-2 rounded-lg border border-border/40 bg-background/60 px-2 py-2">
      <span class="text-[11px] text-muted-foreground font-medium">Attached</span>
      <div
        v-for="f in attachedFiles"
        :key="f.id"
        class="inline-flex items-center gap-2 rounded-full border border-border/50 bg-muted/20 px-2 py-1 text-[11px] min-w-0"
      >
        <span class="font-mono truncate max-w-[180px]" :title="f.filename">{{ f.filename }}</span>
        <span class="text-muted-foreground/70 flex-shrink-0">
          <template v-if="f.size > 0">{{ formatBytes(f.size) }}</template>
          <template v-else-if="f.serverPath">server</template>
          <template v-else>0 B</template>
        </span>
        <IconButton
          size="xs"
          class="h-5 w-5 text-muted-foreground hover:text-foreground"
          title="Remove"
          aria-label="Remove attachment"
          @pointerdown.prevent
          @click="$emit('remove', f.id)"
        >
          <RiCloseLine class="h-4 w-4" />
        </IconButton>
      </div>
      <TextActionButton class="ml-auto" @pointerdown.prevent @click="$emit('clear')"> Clear </TextActionButton>
    </div>
  </div>
</template>

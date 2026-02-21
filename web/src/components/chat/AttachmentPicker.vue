<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{
  (e: 'filesSelected', files: FileList): void
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
</template>

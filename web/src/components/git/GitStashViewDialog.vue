<script setup lang="ts">
import Dialog from '@/components/ui/Dialog.vue'
import DiffViewer from '@/components/DiffViewer.vue'

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
</script>

<template>
  <Dialog
    :open="open"
    :title="title ? `Stash Diff: ${title}` : 'Stash Diff'"
    description="Inspect stash patch content"
    maxWidth="max-w-5xl"
    @update:open="onUpdateOpen"
  >
    <div class="space-y-2">
      <div v-if="loading" class="text-xs text-muted-foreground">Loading stash diff...</div>
      <div
        v-else-if="error"
        class="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
      >
        {{ error }}
      </div>
      <div v-else-if="diff.trim()" class="max-h-[70vh] overflow-auto">
        <DiffViewer :diff="diff" output-format="line-by-line" :draw-file-list="false" />
      </div>
      <div v-else class="text-xs text-muted-foreground">No diff output.</div>
    </div>
  </Dialog>
</template>

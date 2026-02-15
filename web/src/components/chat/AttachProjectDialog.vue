<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import FormDialog from '@/components/ui/FormDialog.vue'
import PathPicker from '@/components/ui/PathPicker.vue'

const props = defineProps<{
  open: boolean
  path: string
  basePath: string
  attachedCount: number
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:path', value: string): void
  (e: 'add'): void
}>()

function onUpdatePath(v: string | number) {
  emit('update:path', String(v))
}
</script>

<template>
  <FormDialog
    :open="open"
    title="Attach project file"
    description="Pick a file from the current project to attach"
    @update:open="$emit('update:open', $event)"
  >
    <div class="space-y-3">
      <PathPicker
        :model-value="path"
        view="browser"
        mode="file"
        :base-path="basePath"
        :resolve-to-absolute="true"
        :show-options="true"
        placeholder="Select a file"
        input-class="h-9 font-mono"
        @update:model-value="onUpdatePath"
      />
      <div class="flex items-center justify-end gap-2">
        <Button variant="ghost" @click="$emit('update:open', false)">Close</Button>
        <Button @click="$emit('add')" :disabled="!path.trim()">Add</Button>
      </div>
      <div v-if="attachedCount" class="text-xs text-muted-foreground">Attached: {{ attachedCount }} file(s)</div>
    </div>
  </FormDialog>
</template>
